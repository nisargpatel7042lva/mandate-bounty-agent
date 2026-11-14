// Kurier (Horizen Labs' REST relayer for zkVerify): register a verification key once, submit
// proofs, and poll their status. Shapes follow the zkVerify docs' Kurier tutorial.
import type { Groth16Proof } from "./types.ts";

export type JobStatus =
  | "Queued"
  | "Valid"
  | "Submitted"
  | "IncludedInBlock"
  | "Finalized"
  | "Failed"
  | "AggregationPending"
  | "Aggregated"
  | "AggregationPublished";

/** Rank of each status, so "wait until at least Finalized" also accepts later aggregation states. */
const RANK: Record<JobStatus, number> = {
  Queued: 0,
  Valid: 1,
  Submitted: 2,
  IncludedInBlock: 3,
  Finalized: 4,
  AggregationPending: 5,
  Aggregated: 6,
  AggregationPublished: 7,
  Failed: -1,
};
export const reached = (status: JobStatus, target: JobStatus) => status !== "Failed" && RANK[status] >= RANK[target];

export interface AggregationDetails {
  receipt: string;
  receiptBlockHash: string;
  root: string;
  leaf: string;
  leafIndex: number;
  numberOfLeaves: number;
  merkleProof: string[];
}

export interface JobState {
  jobId: string;
  status: JobStatus;
  chainId: number | null;
  txHash?: string;
  blockHash?: string;
  aggregationId?: number;
  statement?: string;
  aggregationDetails?: AggregationDetails;
  error?: string;
}

export class KurierError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.retryable = status === 0 || status === 429 || status >= 500;
  }
}

export interface KurierClient {
  /** Registers the Groth16 verification key (idempotent) and returns its zkVerify vkHash. */
  registerVk(vkey: unknown): Promise<string>;
  /** Submits a proof; with chainId, Kurier also aggregates it to that chain's zkVerify contract. */
  submitProof(input: { proof: Groth16Proof; publicSignals: string[]; vkHash: string; chainId?: number }): Promise<{ jobId: string; optimisticVerify: string }>;
  jobStatus(jobId: string): Promise<JobState>;
  /** Polls until the job reaches `target` (or a later state), fails, or times out. */
  waitFor(jobId: string, target: JobStatus, opts?: { timeoutMs?: number; intervalMs?: number }): Promise<JobState>;
}

export interface KurierOptions {
  apiUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const PROOF_OPTIONS = { library: "snarkjs", curve: "bn128" } as const;

export function createKurierClient(opts: KurierOptions): KurierClient {
  const base = opts.apiUrl.replace(/\/$/, "");
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  // The API key is part of the path (Kurier's scheme). Never log these URLs.
  const url = (path: string) => `${base}/${path}/${encodeURIComponent(opts.apiKey)}`;

  async function call<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: T }> {
    let res: Response;
    try {
      res = await doFetch(url(path), { ...init, headers: { "content-type": "application/json", ...init?.headers }, signal: AbortSignal.timeout(60_000) });
    } catch (err) {
      throw new KurierError(0, `Kurier unreachable: ${(err as Error).message}`);
    }
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // keep text
    }
    return { ok: res.ok, status: res.status, body: body as T };
  }

  const describe = (body: unknown) => (typeof body === "string" ? body : JSON.stringify(body)).slice(0, 300);

  const client: KurierClient = {
    async registerVk(vkey) {
      const r = await call<{ vkHash?: string; meta?: { vkHash?: string } }>("register-vk", {
        method: "POST",
        body: JSON.stringify({ proofType: "groth16", proofOptions: PROOF_OPTIONS, vk: vkey }),
      });
      // An already-registered key comes back as an error that still carries meta.vkHash.
      const vkHash = r.body && typeof r.body === "object" ? (r.body.vkHash ?? r.body.meta?.vkHash) : undefined;
      if (vkHash) return vkHash;
      throw new KurierError(r.status, `register-vk failed: HTTP ${r.status} ${describe(r.body)}`);
    },

    async submitProof({ proof, publicSignals, vkHash, chainId }) {
      const r = await call<{ jobId?: string; optimisticVerify?: string }>("submit-proof", {
        method: "POST",
        body: JSON.stringify({
          proofType: "groth16",
          vkRegistered: true,
          ...(chainId ? { chainId } : {}),
          proofOptions: PROOF_OPTIONS,
          proofData: { proof, publicSignals, vk: vkHash },
        }),
      });
      if (!r.ok || typeof r.body !== "object" || !r.body.jobId) throw new KurierError(r.status, `submit-proof failed: HTTP ${r.status} ${describe(r.body)}`);
      if (r.body.optimisticVerify !== "success") throw new KurierError(400, `zkVerify optimistic verification rejected the proof: ${describe(r.body)}`);
      return { jobId: r.body.jobId, optimisticVerify: r.body.optimisticVerify };
    },

    async jobStatus(jobId) {
      // job-status puts the key before the job id: /job-status/{key}/{jobId}
      let res: Response;
      try {
        res = await doFetch(`${url("job-status")}/${encodeURIComponent(jobId)}`, { signal: AbortSignal.timeout(60_000) });
      } catch (err) {
        throw new KurierError(0, `Kurier unreachable: ${(err as Error).message}`);
      }
      const text = await res.text();
      if (!res.ok) throw new KurierError(res.status, `job-status failed: HTTP ${res.status} ${text.slice(0, 300)}`);
      return JSON.parse(text) as JobState;
    },

    async waitFor(jobId, target, { timeoutMs = 10 * 60_000, intervalMs = 5_000 } = {}) {
      const deadline = now() + timeoutMs;
      for (;;) {
        let state: JobState | undefined;
        try {
          state = await client.jobStatus(jobId);
        } catch (err) {
          if (!(err instanceof KurierError) || !err.retryable) throw err;
        }
        if (state?.status === "Failed") throw new KurierError(422, `zkVerify job ${jobId} failed${state.error ? `: ${state.error}` : ""}`);
        if (state && reached(state.status, target)) return state;
        if (now() >= deadline) throw new KurierError(408, `zkVerify job ${jobId} did not reach ${target} within ${Math.round(timeoutMs / 1000)}s (last: ${state?.status ?? "unknown"})`);
        await sleep(intervalMs);
      }
    },
  };
  return client;
}

import type { ApiError, BountyDto, CreateBountyRequest } from "@mba/shared";

export class AgentApiError extends Error {
  readonly status: number;
  constructor(status: number, body: ApiError | null) {
    const detail = body?.issues?.map((i) => `${i.path}: ${i.message}`).join("; ");
    super(body ? `${body.error}${detail ? ` (${detail})` : ""}` : `agent returned HTTP ${status}`);
    this.status = status;
  }
}

async function call<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base.replace(/\/$/, "")}${path}`, { cache: "no-store", ...init });
  if (!res.ok) throw new AgentApiError(res.status, (await res.json().catch(() => null)) as ApiError | null);
  return (await res.json()) as T;
}

export const agentApi = (base: string) => ({
  list: () => call<BountyDto[]>(base, "/bounties"),
  get: (id: number) => call<BountyDto>(base, `/bounties/${id}`),
  register: (req: CreateBountyRequest) =>
    call<BountyDto>(base, "/bounties", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) }),
  commitment: (mandate: { perPayoutCap: string; totalBudget: string; expiry: number; allowedPayees: string[] }) =>
    call<{ commitment: `0x${string}` }>(base, "/mandates/commitment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(mandate) }),
  check: (id: number) => call<{ step: { action: string }; bounty: BountyDto }>(base, `/bounties/${id}/check`, { method: "POST" }),
});

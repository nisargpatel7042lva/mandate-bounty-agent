import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createKurierClient, KurierError, reached, type JobStatus } from "../src/kurier.ts";
import { pubsHash, scalarLE, statementLeaf } from "../src/leaf.ts";

const proof = { pi_a: ["1", "2", "1"], pi_b: [["1", "2"], ["3", "4"], ["1", "0"]], pi_c: ["5", "6", "1"], protocol: "groth16", curve: "bn128" };

type Call = { url: string; init: RequestInit | undefined };
function fake(responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error("no more fake responses");
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { fn, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const client = (f: ReturnType<typeof fake>, extra: { now?: () => number } = {}) =>
  createKurierClient({ apiUrl: "https://kurier.test/api/v1/", apiKey: "k3y", fetch: f.fn, sleep: async () => undefined, ...extra });

describe("Kurier client", () => {
  it("registers a verification key and returns its vkHash", async () => {
    const f = fake([json({ vkHash: "0xabc" })]);
    expect(await client(f).registerVk({ protocol: "groth16" })).toBe("0xabc");
    expect(f.calls[0]?.url).toBe("https://kurier.test/api/v1/register-vk/k3y");
    expect(JSON.parse(String(f.calls[0]?.init?.body))).toEqual({ proofType: "groth16", proofOptions: { library: "snarkjs", curve: "bn128" }, vk: { protocol: "groth16" } });
  });

  it("treats an already-registered key as success (hash comes back in meta)", async () => {
    const f = fake([json({ code: "REGISTER_VK_FAILED", message: "already registered", meta: { vkHash: "0xdef" } }, 400)]);
    expect(await client(f).registerVk({})).toBe("0xdef");
  });

  it("fails registration loudly when no hash comes back", async () => {
    await expect(client(fake([json({ message: "bad key" }, 401)])).registerVk({})).rejects.toThrow(/register-vk failed: HTTP 401/);
  });

  it("submits a proof for aggregation to the given chain", async () => {
    const f = fake([json({ jobId: "job-1", optimisticVerify: "success" })]);
    expect(await client(f).submitProof({ proof, publicSignals: ["1", "2"], vkHash: "0xabc", chainId: 11155111 })).toEqual({ jobId: "job-1", optimisticVerify: "success" });
    expect(f.calls[0]?.url).toBe("https://kurier.test/api/v1/submit-proof/k3y");
    expect(JSON.parse(String(f.calls[0]?.init?.body))).toEqual({
      proofType: "groth16",
      vkRegistered: true,
      chainId: 11155111,
      proofOptions: { library: "snarkjs", curve: "bn128" },
      proofData: { proof, publicSignals: ["1", "2"], vk: "0xabc" },
    });
  });

  it("rejects a proof that fails zkVerify's optimistic verification", async () => {
    const err = await client(fake([json({ jobId: "job-2", optimisticVerify: "failed" })]))
      .submitProof({ proof, publicSignals: [], vkHash: "0x1" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KurierError);
    expect((err as KurierError).retryable).toBe(false);
  });

  it("polls job status until the target state, accepting later states", async () => {
    const f = fake([
      json({ jobId: "j", status: "Queued", chainId: null }),
      new Response("busy", { status: 503 }),
      json({ jobId: "j", status: "IncludedInBlock", chainId: null }),
      json({ jobId: "j", status: "Aggregated", chainId: 11155111, txHash: "0xtx", aggregationId: 7 }),
    ]);
    const state = await client(f).waitFor("j", "Finalized");
    expect(state).toMatchObject({ status: "Aggregated", txHash: "0xtx", aggregationId: 7 });
    expect(f.calls.map((c) => c.url)).toEqual(Array(4).fill("https://kurier.test/api/v1/job-status/k3y/j"));
  });

  it("stops on a Failed job, a non-retryable error, or the timeout", async () => {
    await expect(client(fake([json({ jobId: "j", status: "Failed", error: "invalid proof" })])).waitFor("j", "Finalized")).rejects.toThrow(/failed: invalid proof/);
    await expect(client(fake([new Response("no", { status: 401 })])).waitFor("j", "Finalized")).rejects.toThrow(/HTTP 401/);

    let t = 0;
    const slow = fake(Array.from({ length: 10 }, () => json({ jobId: "j", status: "Queued", chainId: null })));
    await expect(client(slow, { now: () => (t += 60_000) }).waitFor("j", "Finalized", { timeoutMs: 120_000 })).rejects.toThrow(/did not reach Finalized/);
  });

  it("orders statuses for 'at least' checks", () => {
    const order: JobStatus[] = ["Queued", "Valid", "Submitted", "IncludedInBlock", "Finalized", "AggregationPending", "Aggregated", "AggregationPublished"];
    order.forEach((s, i) => expect(reached(s, "Finalized")).toBe(i >= 4));
    expect(reached("Failed", "Queued")).toBe(false);
  });
});

describe("statement leaf", () => {
  it("encodes scalars as 32 little-endian bytes", () => {
    const one = scalarLE(1n);
    expect(one.length).toBe(32);
    expect(one[0]).toBe(1);
    expect(one.slice(1).every((b) => b === 0)).toBe(true);
    expect(scalarLE("256")[1]).toBe(1);
  });

  it("matches the shared vector the Solidity vault is tested against", () => {
    const v = JSON.parse(readFileSync(new URL("../test-vectors/leaf.json", import.meta.url), "utf8")) as { vkHash: `0x${string}`; publicSignals: string[]; pubsHash: string; leaf: string };
    expect(pubsHash(v.publicSignals)).toBe(v.pubsHash);
    expect(statementLeaf(v.vkHash, v.publicSignals)).toBe(v.leaf);
  });
});

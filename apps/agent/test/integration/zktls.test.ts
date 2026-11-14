import { loadTrustedAttestors, proveMergedPr, verifyMergedPrProof, type ZkTlsProof } from "@mba/zktls";
import { ReclaimClient } from "@reclaimprotocol/zk-fetch";
import { beforeAll, describe, expect, it } from "vitest";
import { DEMO_PR, DEMO_REPO, githubToken } from "./real-services.ts";

// A real zkTLS proof via Reclaim's attestors, of mba-demo PR #3, bound to the Sepolia bounty for it.
const binding = { chainId: 11155111, vault: "0xbe34D63C55FbE509d5196857ed23B461eA314f79" as const, bountyId: 2 };
const expectation = { ...binding, repo: DEMO_REPO, prNumber: DEMO_PR, author: "nisargpatel7042lva" };

function reclaimCredentials(): { appId: string; secret: string } {
  const appId = process.env.RECLAIM_APP_ID;
  const secret = process.env.RECLAIM_APP_SECRET;
  if (!appId || !secret || /placeholder/i.test(appId) || /placeholder/i.test(secret)) {
    throw new Error("zkTLS integration tests need RECLAIM_APP_ID and RECLAIM_APP_SECRET in the root .env (dev.reclaimprotocol.org).");
  }
  return { appId, secret };
}

describe("Reclaim zkTLS proof of the real merged PR", () => {
  let proof: ZkTlsProof;
  let attestors: string[];
  const token = githubToken();

  beforeAll(async () => {
    const { appId, secret } = reclaimCredentials();
    attestors = await loadTrustedAttestors(process.env.RECLAIM_ATTESTORS);
    proof = await proveMergedPr(new ReclaimClient(appId, secret), { repo: DEMO_REPO, prNumber: DEMO_PR, githubToken: token, binding });
  }, 240_000);

  it("verifies against Reclaim's published attestors and attests the merge facts", () => {
    const r = verifyMergedPrProof(proof, attestors, expectation);
    expect(r.ok, r.ok ? "" : `${r.code}: ${r.reason}`).toBe(true);
    if (!r.ok) return;
    expect(r.claim).toMatchObject({ repo: DEMO_REPO, prNumber: DEMO_PR, merged: true, baseRef: "main", author: "nisargpatel7042lva" });
    expect(r.claim.mergedAt).toBe("2026-10-29T10:10:19Z");
    // The payee line in the PR description, set by the author.
    expect(r.claim.payee).toBe("0x1890d4b70874e92530faa5cf1599f4c2f01aefe2");
    expect([null, "nisargpatel7042lva"]).toContain(r.claim.lastEditor);
  });

  it("does not contain the GitHub token", () => {
    expect(JSON.stringify(proof)).not.toContain(token);
  });

  it("fails verification once tampered with, or checked against another bounty or author", () => {
    const tampered = structuredClone(proof);
    tampered.claimData.context = tampered.claimData.context.replace('"author":"nisargpatel7042lva"', '"author":"attacker"');
    expect(verifyMergedPrProof(tampered, attestors, expectation).ok).toBe(false);
    expect(verifyMergedPrProof(proof, attestors, { ...expectation, bountyId: 1 })).toMatchObject({ ok: false, code: "WRONG_BINDING" });
    expect(verifyMergedPrProof(proof, attestors, { ...expectation, author: "someone-else" })).toMatchObject({ ok: false, code: "WRONG_AUTHOR" });
  });
});

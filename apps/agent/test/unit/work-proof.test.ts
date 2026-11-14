import type { BountyDto } from "@mba/shared";
import { localAttestorAddress, signLocalClaim } from "@mba/zktls/testing";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { getBounty } from "../../src/bounties.ts";
import { applyVaultEvents } from "../../src/chain/events.ts";
import { openDb } from "../../src/db/client.ts";
import { bounties } from "../../src/db/schema.ts";
import type { GitHubClient } from "../../src/github/client.ts";
import type { Reviewer } from "../../src/review/reviewer.ts";
import { MAX_PROOF_ATTEMPTS, processBounty, type WorkProver } from "../../src/watcher.ts";
import { VAULT, createdEvent, fakeReader, fundedEvent } from "./fixtures.ts";
import { closedIssue, E2E_PAYEE, mergedPr, prFacts, SAMPLE_DIFF } from "./github-fixtures.ts";
import type { PrFacts } from "../../src/github/client.ts";

const NOW = 1_900_000_000;
const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // anvil dev key 1, test attestor
const reviewer: Reviewer = {
  review: async () => ({
    ok: true,
    model: "test",
    verdict: { recommendation: "approve", criteriaMet: [{ criterion: "wraps", met: true, evidence: "flex-wrap" }], summary: "ok", confidence: 0.9 },
  }),
};
const githubWith = (facts: PrFacts = prFacts()): GitHubClient => ({
  issueCloseInfo: async () => closedIssue(mergedPr()),
  pullDiff: async () => SAMPLE_DIFF,
  prFacts: async () => facts,
});

/** A prover whose "attestor" reports the given author / merged state for acme/widgets PR #7. */
function localProver(over: { author?: string; merged?: boolean; fail?: string } = {}): WorkProver {
  return {
    trustedAttestors: [localAttestorAddress(KEY)],
    prove: async ({ repo, prNumber, binding }) => {
      if (over.fail) throw new Error(over.fail);
      return signLocalClaim(KEY, {
        repo,
        prNumber,
        binding,
        extracted: {
          number: String(prNumber),
          merged: over.merged === false ? "false" : "true",
          mergedAt: over.merged === false ? "null" : '"2026-10-28T10:00:00Z"',
          baseRef: "main",
          author: over.author ?? "octocat",
          editor: "null",
          repo,
          payee: E2E_PAYEE,
        },
        timestampS: NOW,
      });
    },
  };
}

function setup(prover?: WorkProver, facts?: PrFacts) {
  const { db } = openDb(":memory:");
  applyVaultEvents(db, { chainId: 31337, vault: VAULT }, [createdEvent(1), fundedEvent(1, 300_000_000n, 300_000_000n, 1)]);
  db.update(bounties).set({ acceptanceCriteria: "Widgets wrap below 400px." }).run();
  return { db, deps: { github: githubWith(facts), reviewer, prover, now: () => NOW } };
}

describe("work proof step", () => {
  it("open -> ... -> work_proven in one pass, with the verified claim and raw proof exposed", async () => {
    const { db, deps } = setup(localProver());
    const step = await processBounty(db, deps, 1);
    expect(step.action).toBe("work_proven");

    const b = getBounty(db, 1) as BountyDto;
    expect(b.status).toBe("work_proven");
    expect(b.workProof).toMatchObject({
      state: "verified",
      claim: {
        repo: "acme/widgets",
        prNumber: 7,
        merged: true,
        mergedAt: "2026-10-28T10:00:00Z",
        baseRef: "main",
        author: "octocat",
        payee: E2E_PAYEE.toLowerCase(),
        lastEditor: null,
      },
      signers: [localAttestorAddress(KEY)],
      verifiedAt: NOW,
      attempts: 1,
      zkVerify: null,
    });
    expect(b.workProof?.identifier).toMatch(/^0x[0-9a-f]{64}$/);

    const app = createApp({ db, chain: fakeReader({}), corsOrigins: [] });
    const raw = await app.request("/bounties/1/proof");
    expect(raw.status).toBe(200);
    expect(((await raw.json()) as { identifier: string }).identifier).toBe(b.workProof?.identifier);
    expect((await app.request("/bounties/9/proof")).status).toBe(404);
  });

  it.each([
    ["the proof names a different author", { author: "mallory" }, "WRONG_AUTHOR"],
    ["GitHub reports the PR as not merged", { merged: false }, "NOT_MERGED"],
  ])("fails when %s, keeping the proof for inspection", async (_n, over, code) => {
    const { db, deps } = setup(localProver(over));
    expect(await processBounty(db, deps, 1)).toMatchObject({ action: "work_proof_failed", code });
    const b = getBounty(db, 1) as BountyDto;
    expect(b.status).toBe("work_proof_failed");
    expect(b.statusReason).toMatch(new RegExp(`^${code}:`));
    expect(b.workProof).toMatchObject({ state: "failed", failureCode: code, claim: null });
    expect(b.workProof?.identifier).toBeTruthy();
  });

  it("rejects a proof signed by an attestor the agent does not trust", async () => {
    const prover = { ...localProver(), trustedAttestors: ["0x000000000000000000000000000000000000dEaD"] };
    const { db, deps } = setup(prover);
    expect(await processBounty(db, deps, 1)).toMatchObject({ action: "work_proof_failed", code: "UNTRUSTED_ATTESTOR" });
  });

  it("retries proof generation failures, then gives up after the cap", async () => {
    const { db, deps } = setup(localProver({ fail: "attestor unreachable" }));
    expect((await processBounty(db, deps, 1)).action).toBe("proof_retry"); // first pass reviews then tries once
    expect(getBounty(db, 1)).toMatchObject({ status: "reviewed", statusReason: expect.stringMatching(/retry \(1\/3\)/) });
    for (let i = 2; i < MAX_PROOF_ATTEMPTS; i++) expect((await processBounty(db, deps, 1)).action).toBe("proof_retry");
    expect(await processBounty(db, deps, 1)).toMatchObject({ action: "work_proof_failed", code: "PROOF_GENERATION_FAILED" });
    expect(getBounty(db, 1)?.workProof).toMatchObject({ state: "failed", attempts: MAX_PROOF_ATTEMPTS });
  });

  it("without a prover, a reviewed bounty waits for its proof and proves once one is configured", async () => {
    const { db, deps } = setup(undefined);
    expect((await processBounty(db, deps, 1)).action).toBe("reviewed");
    expect(await processBounty(db, deps, 1)).toMatchObject({ action: "waiting", reason: expect.stringMatching(/Reclaim zkTLS is not configured/) });
    expect(getBounty(db, 1)?.workProof).toBeNull();

    expect((await processBounty(db, { ...deps, prover: localProver() }, 1)).action).toBe("work_proven");
  });

  it.each([
    ["no payee line", { body: "Closes #42" }, /add a line "mba-payee: 0x\.\.\." with their wallet/],
    ["two different payees", { body: "mba-payee: 0x1111111111111111111111111111111111111111\nmba-payee: 0x2222222222222222222222222222222222222222" }, /names 2 different payees/],
    ["a description last edited by a maintainer", { editor: { login: "maintainer" } }, /last edited by @maintainer, not the author/],
  ])("waits without spending proof attempts when the PR has %s", async (_n, over, reason) => {
    let proveCalls = 0;
    const base = localProver();
    const { db, deps } = setup({ ...base, prove: async (input) => (proveCalls++, base.prove(input)) }, prFacts(over));
    expect(await processBounty(db, deps, 1)).toMatchObject({ action: "waiting", reason: expect.stringMatching(reason) });
    expect(getBounty(db, 1)).toMatchObject({ status: "reviewed", workProof: null });
    expect(proveCalls).toBe(0);
  });

  it("accepts a description the author edited themselves", async () => {
    const { db, deps } = setup(localProver(), prFacts({ editor: { login: "octocat" } }));
    expect((await processBounty(db, deps, 1)).action).toBe("work_proven");
  });

  it("binds the proof to this chain, vault and bounty", async () => {
    let seen: unknown;
    const base = localProver();
    const { db, deps } = setup({ ...base, prove: async (input) => ((seen = input.binding), base.prove(input)) });
    await processBounty(db, deps, 1);
    expect(seen).toEqual({ chainId: 31337, vault: VAULT.toLowerCase(), bountyId: 1 });
  });
});

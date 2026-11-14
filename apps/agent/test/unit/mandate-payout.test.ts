import { mandateCommitmentHex, readPublicSignals, verifyMandateProof } from "@mba/circuits";
import type { BountyDto } from "@mba/shared";
import type { JobState } from "@mba/zkverify";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getBounty } from "../../src/bounties.ts";
import { applyVaultEvents } from "../../src/chain/events.ts";
import { openDb, type Db } from "../../src/db/client.ts";
import { bounties, claims, workProofs } from "../../src/db/schema.ts";
import { mandateStep, MAX_ZKVERIFY_ATTEMPTS, type ZkVerifier } from "../../src/mandate-step.ts";
import { payoutStep, type Payer, type ReleaseInput } from "../../src/payout-step.ts";
import { ALICE, VAULT, createdEvent, fundedEvent } from "./fixtures.ts";

const NOW = 1_900_000_000;
const CLAIM_ID = `0x${"1f".repeat(32)}`;
const MANDATE = { perPayoutCap: 500_000_000n, totalBudget: 1_000_000_000n, expiry: 2_000_000_000, allowedPayees: [ALICE.toLowerCase()] };

async function setup(opts: { payee?: string; verdict?: "approve" | "reject" | "needs_human"; commitment?: `0x${string}` | null; spent?: string; now?: number; repo?: string; id?: number; db?: Db } = {}) {
  const db = opts.db ?? openDb(":memory:").db;
  const id = opts.id ?? 1;
  const commitment = opts.commitment === undefined ? await mandateCommitmentHex(MANDATE) : opts.commitment;
  applyVaultEvents(db, { chainId: 31337, vault: VAULT }, [
    createdEvent(id, { mandate: { perPayoutCap: MANDATE.perPayoutCap, totalBudget: MANDATE.totalBudget, expiry: BigInt(MANDATE.expiry), commitment: commitment ?? `0x${"0".repeat(64)}` } }),
    fundedEvent(id, 400_000_000n, 400_000_000n, id * 10),
  ]);
  db.update(bounties).set({ status: "work_proven", mandateCommitment: commitment, spent: opts.spent ?? "0" }).where(eq(bounties.id, id)).run();
  db.insert(claims)
    .values({
      bountyId: id,
      repo: opts.repo ?? "acme/widgets",
      prNumber: 7,
      prUrl: "https://github.com/acme/widgets/pull/7",
      prTitle: "Wrap widgets",
      prBody: "Closes #42",
      author: "octocat",
      mergedAt: "2026-10-28T10:00:00Z",
      baseRef: "main",
      headSha: "a".repeat(40),
      closedAt: "2026-10-28T10:00:05Z",
      detectedAt: NOW,
      verdict: { recommendation: opts.verdict ?? "approve", criteriaMet: [{ criterion: "wraps", met: (opts.verdict ?? "approve") === "approve", evidence: "grid.css" }], summary: "s", confidence: 0.9 },
      reviewAttempts: 1,
    })
    .run();
  db.insert(workProofs)
    .values({
      bountyId: id,
      claim: { repo: "acme/widgets", prNumber: 7, merged: true, mergedAt: "2026-10-28T10:00:00Z", baseRef: "main", author: "octocat", payee: (opts.payee ?? ALICE).toLowerCase() as `0x${string}`, lastEditor: null },
      identifier: CLAIM_ID,
      signers: ["0xattestor"],
      verifiedAt: NOW,
      attempts: 1,
    })
    .run();
  return { db, id, now: opts.now ?? NOW };
}

function fakeZk(statuses: JobState["status"][], over: Partial<ZkVerifier> = {}) {
  const submitted: unknown[] = [];
  let i = 0;
  const zk: ZkVerifier = {
    target: "AggregationPublished",
    domainId: 0,
    submit: async (p) => (submitted.push(p), { jobId: `job-${submitted.length}` }),
    status: async (jobId) => {
      const status = statuses[Math.min(i++, statuses.length - 1)] ?? "Queued";
      return {
        jobId,
        status,
        chainId: 31337,
        txHash: "0xzktx",
        ...(status === "Aggregated" || status === "AggregationPublished"
          ? { aggregationId: 29537, statement: "0xleaf", aggregationDetails: { receipt: "0xr", receiptBlockHash: "0xb", root: "0xr", leaf: "0xleaf", leafIndex: 6, numberOfLeaves: 8, merkleProof: ["0x01", "0x02"] } }
          : {}),
      };
    },
    ...over,
  };
  return { zk, submitted };
}

function fakePayer(over: Partial<Payer> = {}) {
  const calls: ReleaseInput[] = [];
  let paid = false;
  const payer: Payer = {
    release: async (r) => (calls.push(r), (paid = true), `0x${"ab".repeat(32)}`),
    receipt: async () => "success",
    isPaid: async () => paid,
    ...over,
  };
  return { payer, calls, setPaid: (v: boolean) => (paid = v) };
}

const dto = (db: Db, id = 1) => getBounty(db, id) as BountyDto;

describe("mandate step", () => {
  it("proves the payout fits the mandate, verifies locally, and waits for zkVerify when it is not configured", async () => {
    const { db, id, now } = await setup();
    expect(await mandateStep(db, undefined, id, now)).toMatchObject({ action: "waiting", reason: expect.stringMatching(/Kurier is not configured/) });
    const b = dto(db);
    expect(b.status).toBe("work_proven");
    expect(b.mandateProof).toMatchObject({ state: "proved", reasons: [], checkedAt: now, commitment: await mandateCommitmentHex(MANDATE) });
    const pub = readPublicSignals(b.mandateProof?.publicSignals ?? []);
    expect(pub).toMatchObject({ bountyId: 1n, amount: 250_000_000n, payee: BigInt(ALICE), spent: 0n, now: BigInt(now) });
    expect((pub.claimHi << 128n) | pub.claimLo).toBe(BigInt(CLAIM_ID));
  }, 60_000);

  it("submits to zkVerify, polls without blocking, and becomes mandate_proven once aggregated", async () => {
    const { db, id, now } = await setup();
    const { zk, submitted } = fakeZk(["Queued", "Finalized", "AggregationPublished"]);
    expect(await mandateStep(db, zk, id, now)).toMatchObject({ action: "waiting", reason: "zkVerify: Queued (waiting for AggregationPublished)" });
    expect(await mandateStep(db, zk, id, now)).toMatchObject({ action: "waiting", reason: expect.stringMatching(/Finalized/) });
    expect(await mandateStep(db, zk, id, now)).toEqual({ action: "mandate_proven" });
    expect(submitted).toHaveLength(1);
    expect(await verifyMandateProof(submitted[0] as never)).toBe(true);
    expect(dto(db)).toMatchObject({
      status: "mandate_proven",
      mandateProof: { state: "verified", zkVerify: { jobId: "job-1", status: "AggregationPublished", txHash: "0xzktx", aggregationId: 29537, statement: "0xleaf" } },
    });
  }, 60_000);

  it("with an on-chain check, waits at Aggregated until the destination chain confirms the aggregation", async () => {
    const { db, id, now } = await setup();
    const seen: unknown[] = [];
    const answers: (boolean | Error)[] = [false, new Error("rpc down\nstack"), true];
    const { zk } = fakeZk(["Aggregated"], {
      target: "Aggregated",
      published: async (state, domainId) => {
        seen.push([state.aggregationId, domainId]);
        const a = answers.shift();
        if (a instanceof Error) throw a;
        return a as boolean;
      },
    });
    expect(await mandateStep(db, zk, id, now)).toMatchObject({ action: "waiting", reason: "zkVerify: Aggregated, waiting for aggregation #29537 to reach the destination chain" });
    expect(dto(db).status).toBe("work_proven");
    expect(await mandateStep(db, zk, id, now)).toMatchObject({ action: "waiting", reason: "zkVerify: aggregation check on the destination chain failed: rpc down" });
    expect(await mandateStep(db, zk, id, now)).toEqual({ action: "mandate_proven" });
    expect(seen).toEqual([[29537, 0], [29537, 0], [29537, 0]]);
    expect(dto(db)).toMatchObject({ status: "mandate_proven", mandateProof: { state: "verified", zkVerify: { status: "Aggregated", aggregationId: 29537 } } });
  }, 60_000);

  it.each([
    ["a payee off the allowlist", { payee: "0x000000000000000000000000000000000000dEaD" }, ["PAYEE_NOT_ALLOWED"]],
    ["an expired mandate", { now: 2_000_000_000 }, ["EXPIRED"]],
    ["spend that would exceed the budget", { spent: "900000000" }, ["OVER_BUDGET"]],
    ["no commitment (pre-v2 bounty)", { commitment: null }, ["MISSING_COMMITMENT"]],
    ["a commitment to another mandate", { commitment: `0x${"12".repeat(32)}` as `0x${string}` }, ["COMMITMENT_MISMATCH"]],
  ])("rejects %s with a reason code and no proof", async (_n, opts, reasons) => {
    const { db, id, now } = await setup(opts);
    const { zk, submitted } = fakeZk(["AggregationPublished"]);
    expect(await mandateStep(db, zk, id, now)).toEqual({ action: "mandate_rejected", reasons });
    expect(dto(db)).toMatchObject({ status: "mandate_rejected", mandateProof: { state: "rejected", reasons, publicSignals: [] } });
    expect(dto(db).statusReason).toMatch(new RegExp(`^${reasons[0]}`));
    expect(submitted).toHaveLength(0);
  }, 60_000);

  it("resubmits after zkVerify failures and gives up after the cap", async () => {
    const { db, id, now } = await setup();
    const { zk, submitted } = fakeZk(["Failed"]);
    for (let i = 1; i < MAX_ZKVERIFY_ATTEMPTS; i++) expect((await mandateStep(db, zk, id, now)).action).toBe("waiting");
    expect(await mandateStep(db, zk, id, now)).toEqual({ action: "mandate_rejected", reasons: ["ZKVERIFY_FAILED"] });
    expect(submitted).toHaveLength(MAX_ZKVERIFY_ATTEMPTS);
  }, 60_000);
});

async function proven(opts: Parameters<typeof setup>[0] = {}) {
  const s = await setup(opts);
  await mandateStep(s.db, fakeZk(["AggregationPublished"]).zk, s.id, s.now);
  return s;
}

describe("payout step", () => {
  it("releases exactly the proven payout through the vault and marks the bounty paid", async () => {
    const { db, id, now } = await proven();
    const { payer, calls } = fakePayer();
    expect(await payoutStep(db, payer, id, now)).toEqual({ action: "paid", txHash: `0x${"ab".repeat(32)}` });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      bountyId: 1n,
      payee: ALICE.toLowerCase(),
      amount: 250_000_000n,
      claimId: CLAIM_ID,
      prNumber: 7n,
      checkedAt: BigInt(now),
      agg: { domainId: 0n, aggregationId: 29537n, merklePath: ["0x01", "0x02"], leafCount: 8n, index: 6n },
    });
    expect(dto(db)).toMatchObject({ status: "paid", payout: { state: "paid", txHash: `0x${"ab".repeat(32)}`, paidAt: now } });
    // Further passes do nothing.
    expect((await payoutStep(db, payer, id, now)).action).toBe("paid");
    expect(calls).toHaveLength(1);
  }, 60_000);

  it.each(["reject", "needs_human"] as const)("holds for the funder when the review says %s, and pays once the funder approves", async (verdict) => {
    const { db, id, now } = await proven({ verdict });
    const { payer, calls } = fakePayer();
    expect(await payoutStep(db, payer, id, now)).toMatchObject({ action: "held", reason: expect.stringMatching(new RegExp(`recommended "${verdict}"`)) });
    expect(dto(db).status).toBe("held_for_funder");
    expect(calls).toHaveLength(0);

    db.update(bounties).set({ reviewOverride: true }).where(eq(bounties.id, id)).run(); // mirrored ReviewOverrideApproved
    expect((await payoutStep(db, payer, id, now)).action).toBe("paid");
    expect(calls).toHaveLength(1);
  }, 60_000);

  it("after a crash between broadcast and recording, trusts the vault and never sends a second payout", async () => {
    const { db, id, now } = await proven();
    const { payer, calls } = fakePayer({
      release: async (r) => {
        calls.push(r);
        paidOnChain = true; // the tx went out...
        throw new Error("process crashed before the hash was stored"); // ...but we never learned its hash
      },
    });
    let paidOnChain = false;
    payer.isPaid = async () => paidOnChain;
    expect((await payoutStep(db, payer, id, now)).action).toBe("waiting");
    expect(calls).toHaveLength(1);

    // Restarted agent: the vault says paid, so it reconciles instead of resending.
    expect(await payoutStep(db, payer, id, now)).toMatchObject({ action: "paid" });
    expect(calls).toHaveLength(1);
  }, 60_000);

  it("follows a pending payout tx instead of sending another", async () => {
    const { db, id, now } = await proven();
    let state: "pending" | "success" = "pending";
    const { payer, calls } = fakePayer({ receipt: async () => state });
    payer.isPaid = async () => false;
    expect((await payoutStep(db, payer, id, now)).action).toBe("waiting");
    expect(dto(db).payout).toMatchObject({ state: "sent" });
    state = "success";
    expect((await payoutStep(db, payer, id, now)).action).toBe("paid");
    expect(calls).toHaveLength(1);
  }, 60_000);

  it("refuses to pay the same PR twice across bounties", async () => {
    const first = await proven({ id: 1 });
    const { payer } = fakePayer();
    await payoutStep(first.db, payer, 1, first.now);
    const second = await proven({ id: 2, db: first.db });
    const p2 = fakePayer();
    expect(await payoutStep(second.db, p2.payer, 2, second.now)).toEqual({ action: "payout_failed", error: "PR #7 in acme/widgets was already paid by bounty #1" });
    expect(p2.calls).toHaveLength(0);
  }, 60_000);

  it("waits without a signer, and fails after repeated release errors", async () => {
    const { db, id, now } = await proven();
    expect(await payoutStep(db, undefined, id, now)).toMatchObject({ action: "waiting", reason: expect.stringMatching(/no agent signer/) });

    const { payer, calls } = fakePayer({ release: async (r) => (calls.push(r), Promise.reject(new Error("execution reverted: ProofNotVerified"))) });
    payer.isPaid = async () => false;
    expect((await payoutStep(db, payer, id, now)).action).toBe("waiting");
    expect((await payoutStep(db, payer, id, now)).action).toBe("waiting");
    expect(await payoutStep(db, payer, id, now)).toMatchObject({ action: "payout_failed", error: expect.stringMatching(/ProofNotVerified/) });
    expect(dto(db).status).toBe("payout_failed");
  }, 60_000);
});

import { readPublicSignals } from "@mba/circuits";
import type { AggregationDetails } from "@mba/zkverify";
import { and, eq, ne } from "drizzle-orm";
import type { Db } from "./db/client.ts";
import { bounties, claims, mandateProofs, payouts } from "./db/schema.ts";

export const MAX_PAYOUT_ATTEMPTS = 3;

export interface ReleaseInput {
  bountyId: bigint;
  payee: `0x${string}`;
  amount: bigint;
  claimId: `0x${string}`;
  prNumber: bigint;
  checkedAt: bigint;
  /** Direct mode: the zkVerify tx hash. Aggregation mode: ignored by the vault. */
  proofRef: `0x${string}`;
  agg: { domainId: bigint; aggregationId: bigint; merklePath: `0x${string}`[]; leafCount: bigint; index: bigint };
}

/** Sends vault payouts from the agent's signer (viem in production). */
export interface Payer {
  /** Sends BountyVault.release and returns the tx hash as soon as it is broadcast. */
  release(input: ReleaseInput): Promise<`0x${string}`>;
  receipt(txHash: `0x${string}`): Promise<"success" | "reverted" | "pending">;
  /** The vault's own record: true once the bounty has been paid (by any tx). */
  isPaid(bountyId: number): Promise<boolean>;
}

export type PayoutStepResult = { action: "paid"; txHash: string | null } | { action: "held"; reason: string } | { action: "payout_failed"; error: string } | { action: "waiting"; reason: string };

type Status = (typeof bounties.$inferSelect)["status"];
const ZERO32 = `0x${"0".repeat(64)}` as const;

/**
 * mandate_proven -> paid | held_for_funder | payout_failed. Never pays twice:
 *  - the payout row is written before the tx is sent, and its hash right after broadcast;
 *  - before any (re)send, the vault's own `paid` flag is checked and wins;
 *  - the vault itself rejects a second payout for the bounty, claim, PR or proof.
 */
export async function payoutStep(db: Db, payer: Payer | undefined, id: number, now: number): Promise<PayoutStepResult> {
  const bounty = db.select().from(bounties).where(eq(bounties.id, id)).get();
  const claim = db.select().from(claims).where(eq(claims.bountyId, id)).get();
  const mandate = db.select().from(mandateProofs).where(eq(mandateProofs.bountyId, id)).get();
  if (!bounty || !claim || mandate?.state !== "verified" || !mandate.publicSignals) return { action: "waiting", reason: "no verified mandate proof" };
  const setStatus = (status: Status, reason: string | null) =>
    db.update(bounties).set({ status, statusReason: reason, updatedAt: now }).where(eq(bounties.id, id)).run();
  const markPaid = (txHash: string | null): PayoutStepResult => {
    db.update(payouts).set({ state: "paid", paidAt: now, error: null, ...(txHash ? { txHash } : {}) }).where(eq(payouts.bountyId, id)).run();
    setStatus("paid", null);
    return { action: "paid", txHash };
  };

  // The LLM proposes: anything but "approve" holds the payout until the funder decides on-chain.
  const recommendation = claim.verdict?.recommendation;
  if (recommendation !== "approve" && !bounty.reviewOverride) {
    const reason = `advisory review recommended "${recommendation ?? "none"}"; held for the funder, who can approve on-chain (approveDespiteReview) or leave it unpaid`;
    setStatus("held_for_funder", reason);
    return { action: "held", reason };
  }

  // Same PR already paid by another bounty: the vault would refuse; stop here with a clear reason.
  const other = db
    .select({ id: bounties.id })
    .from(bounties)
    .innerJoin(claims, eq(claims.bountyId, bounties.id))
    .where(and(eq(claims.repo, claim.repo), eq(claims.prNumber, claim.prNumber), eq(bounties.status, "paid"), ne(bounties.id, id)))
    .get();
  if (other) {
    const error = `PR #${claim.prNumber} in ${claim.repo} was already paid by bounty #${other.id}`;
    setStatus("payout_failed", error);
    return { action: "payout_failed", error };
  }

  if (!payer) {
    const reason = "payout waiting: no agent signer is configured on this agent";
    setStatus("mandate_proven", reason);
    return { action: "waiting", reason };
  }

  const pub = readPublicSignals(mandate.publicSignals);
  const payee = `0x${pub.payee.toString(16).padStart(40, "0")}` as `0x${string}`;
  let row = db.select().from(payouts).where(eq(payouts.bountyId, id)).get();
  if (row?.state === "paid") return { action: "paid", txHash: row.txHash };

  // A tx is already out: follow it instead of sending another.
  if (row?.txHash && (row.state === "sent" || row.state === "sending")) {
    const r = await payer.receipt(row.txHash as `0x${string}`);
    if (r === "success") return markPaid(row.txHash);
    if (r === "pending") return { action: "waiting", reason: `payout tx ${row.txHash} pending` };
    db.update(payouts).set({ state: "failed", error: "payout tx reverted" }).where(eq(payouts.bountyId, id)).run();
    row = { ...row, state: "failed" };
  }

  // Before (re)sending, the vault's record wins: covers a crash after broadcast but before the hash
  // was stored, and a payout made by another agent instance.
  if (await payer.isPaid(id)) {
    if (!row) db.insert(payouts).values({ bountyId: id, state: "paid", payee, amount: bounty.payoutAmount, attempts: 0 }).run();
    return markPaid(bounty.paidTx);
  }

  const attempts = (row?.attempts ?? 0) + 1;
  if (attempts > MAX_PAYOUT_ATTEMPTS) {
    const error = row?.error ?? "payout failed";
    setStatus("payout_failed", error);
    return { action: "payout_failed", error };
  }
  db.insert(payouts)
    .values({ bountyId: id, state: "sending", payee, amount: bounty.payoutAmount, attempts })
    .onConflictDoUpdate({ target: payouts.bountyId, set: { state: "sending", txHash: null, attempts, error: null } })
    .run();

  const agg = mandate.zkAggregation as AggregationDetails | null;
  const claimId = (`0x${((pub.claimHi << 128n) | pub.claimLo).toString(16).padStart(64, "0")}`) as `0x${string}`;
  let txHash: `0x${string}`;
  try {
    txHash = await payer.release({
      bountyId: BigInt(id),
      payee,
      amount: pub.amount,
      claimId,
      prNumber: BigInt(claim.prNumber),
      checkedAt: pub.now,
      proofRef: (mandate.zkTxHash as `0x${string}` | null) ?? ZERO32,
      agg: {
        domainId: BigInt(mandate.zkDomainId ?? 0),
        aggregationId: BigInt(mandate.zkAggregationId ?? 0),
        merklePath: (agg?.merkleProof ?? []) as `0x${string}`[],
        leafCount: BigInt(agg?.numberOfLeaves ?? 0),
        index: BigInt(agg?.leafIndex ?? 0),
      },
    });
  } catch (err) {
    const error = `release failed: ${(err as Error).message.split("\n")[0]}`;
    db.update(payouts).set({ state: "failed", error }).where(eq(payouts.bountyId, id)).run();
    if (attempts >= MAX_PAYOUT_ATTEMPTS) {
      setStatus("payout_failed", error);
      return { action: "payout_failed", error };
    }
    setStatus("mandate_proven", `${error}; will retry (${attempts}/${MAX_PAYOUT_ATTEMPTS})`);
    return { action: "waiting", reason: error };
  }
  db.update(payouts).set({ state: "sent", txHash }).where(eq(payouts.bountyId, id)).run();

  const r = await payer.receipt(txHash);
  if (r === "success") return markPaid(txHash);
  if (r === "pending") return { action: "waiting", reason: `payout tx ${txHash} pending` };
  db.update(payouts).set({ state: "failed", error: "payout tx reverted" }).where(eq(payouts.bountyId, id)).run();
  setStatus("mandate_proven", "payout tx reverted; will retry");
  return { action: "waiting", reason: "payout tx reverted" };
}

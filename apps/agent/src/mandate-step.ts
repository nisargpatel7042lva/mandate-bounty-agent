import { mandateCommitmentHex, proveMandate, verifyMandateProof, type MandateProof } from "@mba/circuits";
import type { MandateReasonCode } from "@mba/shared";
import { reached, type JobState, type JobStatus } from "@mba/zkverify";
import { eq } from "drizzle-orm";
import type { Db } from "./db/client.ts";
import { bounties, mandateProofs, workProofs } from "./db/schema.ts";

export const MAX_ZKVERIFY_ATTEMPTS = 3;

/** Submits mandate proofs to zkVerify (Kurier in production) and reports job state. */
export interface ZkVerifier {
  submit(proof: MandateProof): Promise<{ jobId: string }>;
  status(jobId: string): Promise<JobState>;
  /** "Aggregated" when the vault checks aggregation on-chain, else "Finalized". */
  target: JobStatus;
  /**
   * Whether the aggregation in `state` is visible to the vault on the destination chain. Kurier's
   * status can stay at "Aggregated" after the root is published, so the agent checks the chain itself.
   */
  published?(state: JobState, domainId: number): Promise<boolean>;
  /** zkVerify domain the aggregation is published under (the vault needs it). */
  domainId: number;
}

export type MandateStepResult =
  | { action: "mandate_rejected"; reasons: MandateReasonCode[] }
  | { action: "mandate_proven" }
  | { action: "waiting"; reason: string };

type Status = (typeof bounties.$inferSelect)["status"];

/**
 * work_proven -> mandate_proven | mandate_rejected. Proves (Groth16) that paying the bounty's payout
 * to the proven payee fits the funder's mandate, then gets that proof verified by zkVerify. Polls
 * zkVerify once per call; never blocks the watcher.
 */
export async function mandateStep(db: Db, zk: ZkVerifier | undefined, id: number, now: number): Promise<MandateStepResult> {
  const bounty = db.select().from(bounties).where(eq(bounties.id, id)).get();
  const work = db.select().from(workProofs).where(eq(workProofs.bountyId, id)).get();
  if (!bounty || !work?.claim || !work.identifier) return { action: "waiting", reason: "no verified work proof" };
  const setStatus = (status: Status, reason: string | null) =>
    db.update(bounties).set({ status, statusReason: reason, updatedAt: now }).where(eq(bounties.id, id)).run();
  const save = (row: Partial<typeof mandateProofs.$inferInsert>) =>
    db
      .insert(mandateProofs)
      .values({ bountyId: id, state: "proved", reasons: [], ...row })
      .onConflictDoUpdate({ target: mandateProofs.bountyId, set: row })
      .run();
  const reject = (reasons: MandateReasonCode[], error: string | null = null): MandateStepResult => {
    save({ state: "rejected", reasons, error });
    setStatus("mandate_rejected", reasons.join(", ") + (error ? `: ${error}` : ""));
    return { action: "mandate_rejected", reasons };
  };

  let row = db.select().from(mandateProofs).where(eq(mandateProofs.bountyId, id)).get();

  if (!row || row.state === "failed") {
    if (!bounty.mandateCommitment) return reject(["MISSING_COMMITMENT"], "the bounty has no mandate commitment (created before vault v2)");
    const params = { perPayoutCap: BigInt(bounty.perPayoutCap), totalBudget: BigInt(bounty.totalBudget), expiry: bounty.expiry, allowedPayees: bounty.payees };
    if ((await mandateCommitmentHex(params)) !== bounty.mandateCommitment.toLowerCase()) {
      return reject(["COMMITMENT_MISMATCH"], "the on-chain commitment does not match the bounty's mandate");
    }
    const result = await proveMandate(
      { ...params, bountyId: id },
      { amount: BigInt(bounty.payoutAmount), payee: work.claim.payee, spent: BigInt(bounty.spent), now, claimId: work.identifier },
    );
    if (!result.ok) return reject(result.reasons);
    if (!(await verifyMandateProof(result.proof))) return reject(["ZKVERIFY_FAILED"], "the mandate proof did not verify locally");
    save({
      state: "proved",
      reasons: [],
      commitment: bounty.mandateCommitment,
      proof: result.proof.proof,
      publicSignals: result.proof.publicSignals,
      checkedAt: now,
      zkJobId: null,
      zkStatus: null,
      error: null,
    });
    row = db.select().from(mandateProofs).where(eq(mandateProofs.bountyId, id)).get();
  }
  if (!row) return { action: "waiting", reason: "mandate proof not stored" };
  if (row.state === "rejected") return { action: "mandate_rejected", reasons: row.reasons };
  if (row.state === "verified") return { action: "mandate_proven" };

  if (!zk) {
    const reason = "mandate proof ready; waiting for zkVerify (Kurier is not configured on this agent)";
    setStatus("work_proven", reason);
    return { action: "waiting", reason };
  }

  if (row.state === "proved") {
    const proof = { proof: row.proof, publicSignals: row.publicSignals ?? [] } as MandateProof;
    try {
      const { jobId } = await zk.submit(proof);
      save({ state: "submitted", zkJobId: jobId, zkStatus: "Queued", attempts: row.attempts + 1, error: null });
      row = { ...row, state: "submitted", zkJobId: jobId, attempts: row.attempts + 1 };
    } catch (err) {
      return retryOrFail(`zkVerify submission failed: ${(err as Error).message}`, row.attempts + 1);
    }
  }

  // state === "submitted": poll once.
  let state: JobState;
  try {
    state = await zk.status(row.zkJobId as string);
  } catch (err) {
    const reason = `zkVerify status unavailable: ${(err as Error).message}`;
    setStatus("work_proven", reason);
    return { action: "waiting", reason };
  }
  save({
    zkStatus: state.status,
    zkTxHash: state.txHash ?? null,
    zkAggregationId: state.aggregationId ?? null,
    zkStatement: state.statement ?? null,
    zkAggregation: state.aggregationDetails ?? null,
    zkDomainId: state.aggregationId !== undefined ? zk.domainId : null,
  });
  if (state.status === "Failed") return retryOrFail(`zkVerify rejected the proof${state.error ? `: ${state.error}` : ""}`, row.attempts);
  if (!reached(state.status, zk.target)) {
    const reason = `zkVerify: ${state.status} (waiting for ${zk.target})`;
    setStatus("work_proven", reason);
    return { action: "waiting", reason };
  }
  if (zk.published) {
    let onChain: boolean;
    try {
      onChain = await zk.published(state, zk.domainId);
    } catch (err) {
      const reason = `zkVerify: aggregation check on the destination chain failed: ${(err as Error).message.split("\n")[0]}`;
      setStatus("work_proven", reason);
      return { action: "waiting", reason };
    }
    if (!onChain) {
      const reason = `zkVerify: ${state.status}, waiting for aggregation #${state.aggregationId ?? "?"} to reach the destination chain`;
      setStatus("work_proven", reason);
      return { action: "waiting", reason };
    }
  }
  save({ state: "verified" });
  setStatus("mandate_proven", null);
  return { action: "mandate_proven" };

  function retryOrFail(error: string, attempts: number): MandateStepResult {
    if (attempts < MAX_ZKVERIFY_ATTEMPTS) {
      save({ state: "proved", error, attempts, zkJobId: null });
      const reason = `${error}; will retry (${attempts}/${MAX_ZKVERIFY_ATTEMPTS})`;
      setStatus("work_proven", reason);
      return { action: "waiting", reason };
    }
    save({ state: "failed", error, attempts });
    return reject(["ZKVERIFY_FAILED"], error);
  }
}

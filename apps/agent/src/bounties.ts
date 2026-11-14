import { BountySchema, type BountyDto, type ClaimDto, type CreateBountyRequest, type MandateProofDto, type PayoutDto, type WorkProofDto } from "@mba/shared";
import { zkVerifyTxUrl } from "@mba/zkverify";
import { desc, eq } from "drizzle-orm";
import type { Db } from "./db/client.ts";
import { bounties, claims, mandateProofs, payouts, workProofs } from "./db/schema.ts";
import { applyVaultEvents, type VaultEvent } from "./chain/events.ts";

/** What the bounty service needs from the chain; faked in unit tests. */
export interface VaultReader {
  chainId: number;
  vault: `0x${string}`;
  /** Vault events emitted by a mined, successful transaction; null if it is unknown or reverted. */
  eventsForTx(txHash: `0x${string}`): Promise<VaultEvent[] | null>;
}

export class BountyError extends Error {
  readonly status: 404 | 422;
  constructor(status: 404 | 422, message: string) {
    super(message);
    this.status = status;
  }
}

type Row = typeof bounties.$inferSelect;
type ClaimRow = typeof claims.$inferSelect;

export function claimToDto(c: ClaimRow): ClaimDto {
  return {
    repo: c.repo,
    prNumber: c.prNumber,
    prUrl: c.prUrl,
    prTitle: c.prTitle,
    author: c.author,
    mergedBy: c.mergedBy,
    mergedAt: c.mergedAt,
    baseRef: c.baseRef,
    headSha: c.headSha,
    mergeCommitSha: c.mergeCommitSha,
    closedAt: c.closedAt,
    detectedAt: c.detectedAt,
    review: { verdict: c.verdict ?? null, model: c.reviewModel, reviewedAt: c.reviewedAt, error: c.reviewError, attempts: c.reviewAttempts },
  };
}

type ProofRow = typeof workProofs.$inferSelect;

export function workProofToDto(p: ProofRow): WorkProofDto {
  return {
    state: p.verifiedAt ? "verified" : p.failureCode ? "failed" : "pending",
    claim: p.claim ?? null,
    identifier: p.identifier,
    signers: p.signers ?? [],
    attestedAt: p.attestedAt,
    verifiedAt: p.verifiedAt,
    failureCode: p.failureCode,
    error: p.error,
    attempts: p.attempts,
    zkVerify: null,
  };
}

type MandateRow = typeof mandateProofs.$inferSelect;
type PayoutRow = typeof payouts.$inferSelect;

export function mandateProofToDto(m: MandateRow): MandateProofDto {
  return {
    state: m.state,
    reasons: m.reasons,
    commitment: m.commitment,
    publicSignals: m.publicSignals ?? [],
    checkedAt: m.checkedAt,
    zkVerify: {
      jobId: m.zkJobId,
      status: m.zkStatus,
      txHash: m.zkTxHash,
      txUrl: m.zkTxHash ? zkVerifyTxUrl(m.zkTxHash) : null,
      aggregationId: m.zkAggregationId,
      domainId: m.zkDomainId,
      statement: m.zkStatement,
    },
    error: m.error,
    attempts: m.attempts,
  };
}

export function payoutToDto(p: PayoutRow): PayoutDto {
  return { state: p.state, payee: p.payee, amount: p.amount, txHash: p.txHash, paidAt: p.paidAt, error: p.error, attempts: p.attempts };
}

interface Joined {
  claim?: ClaimRow | null;
  proof?: ProofRow | null;
  mandate?: MandateRow | null;
  payout?: PayoutRow | null;
}

export function toDto(r: Row, j: Joined = {}): BountyDto {
  return {
    status: r.status,
    statusReason: r.statusReason,
    claim: j.claim ? claimToDto(j.claim) : null,
    workProof: j.proof ? workProofToDto(j.proof) : null,
    mandateProof: j.mandate ? mandateProofToDto(j.mandate) : null,
    payout: j.payout ? payoutToDto(j.payout) : null,
    reviewOverride: r.reviewOverride,
    id: r.id,
    chainId: r.chainId,
    vault: r.vault,
    funder: r.funder,
    repo: r.repo,
    issueNumber: r.issueNumber,
    payoutAmount: r.payoutAmount,
    mandate: { perPayoutCap: r.perPayoutCap, totalBudget: r.totalBudget, expiry: r.expiry, allowedPayees: r.payees, commitment: r.mandateCommitment },
    funded: r.funded,
    spent: r.spent,
    createdTx: r.createdTx,
    createdBlock: r.createdBlock,
    title: r.title,
    acceptanceCriteria: r.acceptanceCriteria,
  };
}

const withJoins = (db: Db) =>
  db
    .select()
    .from(bounties)
    .leftJoin(claims, eq(claims.bountyId, bounties.id))
    .leftJoin(workProofs, eq(workProofs.bountyId, bounties.id))
    .leftJoin(mandateProofs, eq(mandateProofs.bountyId, bounties.id))
    .leftJoin(payouts, eq(payouts.bountyId, bounties.id));

type JoinedRow = ReturnType<ReturnType<typeof withJoins>["all"]>[number];
const fromRow = (r: JoinedRow) => toDto(r.bounties, { claim: r.claims, proof: r.work_proofs, mandate: r.mandate_proofs, payout: r.payouts });

export function listBounties(db: Db): BountyDto[] {
  return withJoins(db)
    .orderBy(desc(bounties.id))
    .all()
    .map(fromRow);
}

export function getBounty(db: Db, id: number): BountyDto | null {
  const row = withJoins(db).where(eq(bounties.id, id)).get();
  return row ? fromRow(row) : null;
}

/** The raw Reclaim proof, for independent re-verification. */
export function getRawWorkProof(db: Db, id: number) {
  return db.select({ proof: workProofs.proof }).from(workProofs).where(eq(workProofs.bountyId, id)).get()?.proof ?? null;
}

/**
 * Registers an on-chain bounty: reads the creation tx, mirrors its events, then attaches the
 * off-chain metadata. Money fields come only from the chain, never from the request.
 */
export async function registerBounty(db: Db, chain: VaultReader, req: CreateBountyRequest): Promise<BountyDto> {
  const events = await chain.eventsForTx(req.txHash as `0x${string}`);
  if (!events) throw new BountyError(422, "transaction not found, not mined, or reverted");
  const created = events.find((e) => e.kind === "created");
  if (!created) throw new BountyError(422, "transaction did not create a bounty in this vault");

  // Defence in depth: the contract already enforces these, but the mirror must hold the same invariants.
  const check = BountySchema.safeParse({
    repo: created.repo,
    issueNumber: Number(created.issueNumber),
    payoutAmount: created.payoutAmount.toString(),
    mandate: {
      perPayoutCap: created.mandate.perPayoutCap.toString(),
      totalBudget: created.mandate.totalBudget.toString(),
      allowedPayees: [...created.payees],
      expiry: Number(created.mandate.expiry),
    },
  });
  if (!check.success) throw new BountyError(422, `on-chain bounty fails validation: ${check.error.issues[0]?.message}`);

  applyVaultEvents(db, chain, events);
  const id = Number(created.id);
  db.update(bounties).set({ title: req.title, acceptanceCriteria: req.acceptanceCriteria }).where(eq(bounties.id, id)).run();
  const dto = getBounty(db, id);
  if (!dto) throw new BountyError(404, "bounty vanished after registration");
  return dto;
}

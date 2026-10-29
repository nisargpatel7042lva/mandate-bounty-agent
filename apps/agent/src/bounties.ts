import { BountySchema, type BountyDto, type ClaimDto, type CreateBountyRequest } from "@mba/shared";
import { desc, eq } from "drizzle-orm";
import type { Db } from "./db/client.ts";
import { bounties, claims } from "./db/schema.ts";
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

export function toDto(r: Row, claim?: ClaimRow | null): BountyDto {
  return {
    status: r.status,
    statusReason: r.statusReason,
    claim: claim ? claimToDto(claim) : null,
    id: r.id,
    chainId: r.chainId,
    vault: r.vault,
    funder: r.funder,
    repo: r.repo,
    issueNumber: r.issueNumber,
    payoutAmount: r.payoutAmount,
    mandate: { perPayoutCap: r.perPayoutCap, totalBudget: r.totalBudget, expiry: r.expiry, allowedPayees: r.payees },
    funded: r.funded,
    spent: r.spent,
    createdTx: r.createdTx,
    createdBlock: r.createdBlock,
    title: r.title,
    acceptanceCriteria: r.acceptanceCriteria,
  };
}

export function listBounties(db: Db): BountyDto[] {
  return db
    .select()
    .from(bounties)
    .leftJoin(claims, eq(claims.bountyId, bounties.id))
    .orderBy(desc(bounties.id))
    .all()
    .map((r) => toDto(r.bounties, r.claims));
}

export function getBounty(db: Db, id: number): BountyDto | null {
  const row = db.select().from(bounties).leftJoin(claims, eq(claims.bountyId, bounties.id)).where(eq(bounties.id, id)).get();
  return row ? toDto(row.bounties, row.claims) : null;
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

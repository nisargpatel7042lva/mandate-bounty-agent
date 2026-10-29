import { z } from "zod";
import type { ReviewVerdict } from "./schemas.ts";

export const TxHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed 32-byte tx hash");

/**
 * Registers a bounty the funder already created on-chain. The agent never trusts the client for
 * money fields: it reads them from the BountyCreated event in this transaction.
 */
export const CreateBountyRequestSchema = z.object({
  txHash: TxHash,
  title: z.string().trim().min(3).max(200),
  acceptanceCriteria: z.string().trim().min(10).max(5000),
});
export type CreateBountyRequest = z.infer<typeof CreateBountyRequestSchema>;

/**
 * Workflow status. `reviewed` only means the advisory review finished; it never authorizes payment.
 * Later phases extend this (work_proven, mandate_proven, paid).
 */
export type BountyStatus = "open" | "claimed" | "reviewed" | "review_failed";

/** A merged PR that GitHub records as closing the bounty's issue, with its advisory review. */
export interface ClaimDto {
  repo: string;
  prNumber: number;
  prUrl: string;
  prTitle: string;
  author: string;
  mergedBy: string | null;
  mergedAt: string;
  baseRef: string;
  headSha: string;
  mergeCommitSha: string | null;
  closedAt: string;
  detectedAt: number;
  review: {
    verdict: ReviewVerdict | null;
    model: string | null;
    reviewedAt: number | null;
    error: string | null;
    attempts: number;
  };
}

/** Wire shape of a bounty. Amounts are decimal strings of tUSDC base units (6 decimals). */
export interface BountyDto {
  status: BountyStatus;
  statusReason: string | null;
  claim: ClaimDto | null;
  id: number;
  chainId: number;
  vault: string;
  funder: string;
  repo: string;
  issueNumber: number;
  payoutAmount: string;
  mandate: {
    perPayoutCap: string;
    totalBudget: string;
    expiry: number;
    allowedPayees: string[];
  };
  funded: string;
  spent: string;
  createdTx: string;
  createdBlock: number;
  title: string | null;
  acceptanceCriteria: string | null;
}

export interface ApiError {
  error: string;
  issues?: { path: string; message: string }[];
}

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
 * `work_proven`: a zkTLS proof that GitHub reported the PR as merged verified locally.
 * `mandate_proven`: zkVerify verified a proof that the payout fits the funder's mandate.
 * `held_for_funder`: the advisory review did not recommend approval; the funder decides on-chain.
 * `paid`: the vault released the payout (once).
 */
export type BountyStatus =
  | "open"
  | "claimed"
  | "reviewed"
  | "review_failed"
  | "work_proven"
  | "work_proof_failed"
  | "mandate_proven"
  | "mandate_rejected"
  | "held_for_funder"
  | "paid"
  | "payout_failed";

/** Why a payout does not fit the mandate (spec codes), or why the mandate proof could not be made. */
export type MandateReasonCode = "ZERO_AMOUNT" | "OVER_CAP" | "OVER_BUDGET" | "PAYEE_NOT_ALLOWED" | "EXPIRED" | "MISSING_COMMITMENT" | "COMMITMENT_MISMATCH" | "ZKVERIFY_FAILED";

export interface MandateProofDto {
  state: "rejected" | "proved" | "submitted" | "verified" | "failed";
  reasons: MandateReasonCode[];
  commitment: string | null;
  /** Public inputs, in circuit order: commitment, bountyId, amount, payee, spent, now, claimHi, claimLo. */
  publicSignals: string[];
  /** The `now` input: when the mandate check ran (unix seconds). */
  checkedAt: number | null;
  zkVerify: {
    jobId: string | null;
    status: string | null;
    txHash: string | null;
    txUrl: string | null;
    aggregationId: number | null;
    domainId: number | null;
    /** zkVerify statement leaf the vault rebuilds and checks on-chain. */
    statement: string | null;
  };
  error: string | null;
  attempts: number;
}

export interface PayoutDto {
  state: "sending" | "sent" | "paid" | "failed";
  payee: string;
  amount: string;
  txHash: string | null;
  paidAt: number | null;
  error: string | null;
  attempts: number;
}

/** Facts attested by the zkTLS proof (as GitHub's API returned them). */
export interface WorkProofClaimDto {
  repo: string;
  prNumber: number;
  merged: boolean;
  mergedAt: string | null;
  baseRef: string;
  author: string;
  /** Wallet named by the author in the PR description (mba-payee line), lowercased. */
  payee: string;
  /** Who last edited the description; null if never edited. */
  lastEditor: string | null;
}

export interface WorkProofDto {
  state: "verified" | "failed" | "pending";
  claim: WorkProofClaimDto | null;
  /** Reclaim claim identifier (keccak256 of the claim). Stable reference to this proof. */
  identifier: string | null;
  /** Attestor addresses whose signatures verified. */
  signers: string[];
  attestedAt: number | null;
  verifiedAt: number | null;
  failureCode: string | null;
  error: string | null;
  attempts: number;
  /** zkTLS proofs are not verified by zkVerify directly; the claim id is bound into the mandate proof. */
  zkVerify: null;
}

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
  workProof: WorkProofDto | null;
  mandateProof: MandateProofDto | null;
  payout: PayoutDto | null;
  /** The funder approved paying despite the advisory review (on-chain). */
  reviewOverride: boolean;
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
    /** Poseidon commitment to the mandate, set by the funder at creation (null for pre-v2 bounties). */
    commitment: string | null;
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

import type { BountyStatus } from "@mba/shared";

/** Plain-English labels for the workflow status; tone drives the pill colour. */
export const STATUS: Record<BountyStatus, { label: string; tone: "ok" | "warn" | "info" | "err" }> = {
  open: { label: "watching for a merged PR", tone: "info" },
  claimed: { label: "PR merged, review in progress", tone: "info" },
  reviewed: { label: "reviewed, proving the merge", tone: "info" },
  review_failed: { label: "review failed", tone: "err" },
  work_proven: { label: "merge proven, proving the mandate", tone: "info" },
  work_proof_failed: { label: "merge proof failed", tone: "err" },
  mandate_proven: { label: "mandate proven on zkVerify, paying", tone: "info" },
  mandate_rejected: { label: "payout outside the mandate", tone: "err" },
  held_for_funder: { label: "held for funder review", tone: "warn" },
  paid: { label: "paid", tone: "ok" },
  payout_failed: { label: "payout failed", tone: "err" },
};

/** Statuses where the agent still has work to do, so the page keeps refreshing. */
export const isPending = (s: BountyStatus) => ["open", "claimed", "reviewed", "work_proven", "mandate_proven", "held_for_funder"].includes(s);

/** Plain-English meaning of each mandate reason code. */
export const MANDATE_REASON: Record<string, string> = {
  ZERO_AMOUNT: "The payout amount is zero.",
  OVER_CAP: "The payout is above the per-payout cap.",
  OVER_BUDGET: "Paying this would take total spend above the budget.",
  PAYEE_NOT_ALLOWED: "The wallet named in the PR is not on the bounty's allowlist.",
  EXPIRED: "The mandate expired before the payout.",
  MISSING_COMMITMENT: "The bounty has no mandate commitment (created before vault v2).",
  COMMITMENT_MISMATCH: "The on-chain mandate commitment does not match the bounty's mandate.",
  ZKVERIFY_FAILED: "zkVerify could not verify the mandate proof.",
};

export const RECOMMENDATION: Record<"approve" | "reject" | "needs_human", { label: string; tone: "ok" | "warn" | "err" }> = {
  approve: { label: "Recommends approval", tone: "ok" },
  reject: { label: "Recommends rejection", tone: "err" },
  needs_human: { label: "Needs a human reviewer", tone: "warn" },
};

/** Plain-English meaning of each work-proof failure code. */
export const PROOF_FAILURE: Record<string, string> = {
  MALFORMED: "The proof is incomplete or malformed.",
  BAD_SIGNATURE: "The proof's signature could not be checked.",
  UNTRUSTED_ATTESTOR: "The proof was not signed by a trusted Reclaim attestor, or was edited after signing.",
  IDENTIFIER_MISMATCH: "The proof's identifier does not match its contents.",
  WRONG_REQUEST: "The proof is about a different request than the bounty's PR.",
  WRONG_BINDING: "The proof was made for a different bounty.",
  WRONG_REPO: "GitHub's answer names a different repository.",
  WRONG_PR: "GitHub's answer is about a different pull request.",
  NOT_MERGED: "GitHub reported the pull request as not merged.",
  WRONG_AUTHOR: "GitHub's answer names a different author than the claim.",
  PROOF_GENERATION_FAILED: "The agent could not produce a proof after several attempts.",
};

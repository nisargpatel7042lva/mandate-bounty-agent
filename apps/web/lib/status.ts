import type { BountyStatus } from "@mba/shared";

/** Plain-English labels for the workflow status; tone drives the pill colour. */
export const STATUS: Record<BountyStatus, { label: string; tone: "ok" | "warn" | "info" | "err" }> = {
  open: { label: "watching for a merged PR", tone: "info" },
  claimed: { label: "PR merged, review in progress", tone: "info" },
  reviewed: { label: "reviewed (advisory)", tone: "ok" },
  review_failed: { label: "review failed", tone: "err" },
};

/** Statuses where the agent still has work to do, so the page keeps refreshing. */
export const isPending = (s: BountyStatus) => s === "open" || s === "claimed";

export const RECOMMENDATION: Record<"approve" | "reject" | "needs_human", { label: string; tone: "ok" | "warn" | "err" }> = {
  approve: { label: "Recommends approval", tone: "ok" },
  reject: { label: "Recommends rejection", tone: "err" },
  needs_human: { label: "Needs a human reviewer", tone: "warn" },
};

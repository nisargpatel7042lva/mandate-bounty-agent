import type { IssueCloseInfo, PullRequestNode } from "./client.ts";

export type Detection =
  | { kind: "claim"; pr: PullRequestNode & { mergedAt: string; author: { login: string } }; closedAt: string }
  | { kind: "none"; reason: string };

/**
 * Decides whether an issue was closed by a merged PR in the bounty's own repository.
 * Deterministic and strict: anything ambiguous is "none" with a reason, never a guess.
 */
export function detectClosingPr(issue: IssueCloseInfo, bountyRepo: string): Detection {
  if (issue.state !== "CLOSED") return { kind: "none", reason: "issue is open" };

  const last = issue.timelineItems.nodes.at(-1);
  if (!last || last.__typename !== "ClosedEvent") return { kind: "none", reason: "no close event found" };

  const closer = last.closer;
  if (!closer) return { kind: "none", reason: "issue was closed manually, not by a pull request" };
  if (closer.__typename !== "PullRequest") return { kind: "none", reason: `issue was closed by a ${closer.__typename}, not a pull request` };

  const pr = closer as PullRequestNode;
  if (!pr.merged || !pr.mergedAt) return { kind: "none", reason: `PR #${pr.number} is not merged` };
  if (pr.repository.nameWithOwner.toLowerCase() !== bountyRepo.toLowerCase()) {
    return { kind: "none", reason: `closing PR belongs to ${pr.repository.nameWithOwner}, not ${bountyRepo}` };
  }
  if (!pr.author) return { kind: "none", reason: `PR #${pr.number} has no author (deleted account)` };

  return { kind: "claim", pr: { ...pr, mergedAt: pr.mergedAt, author: pr.author }, closedAt: last.createdAt };
}

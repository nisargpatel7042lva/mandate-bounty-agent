import type { IssueCloseInfo, PullRequestNode } from "../../src/github/client.ts";

// Shapes match GitHub's GraphQL response for ISSUE_CLOSE_QUERY.

export function mergedPr(over: Partial<PullRequestNode> = {}): PullRequestNode {
  return {
    __typename: "PullRequest",
    number: 7,
    url: "https://github.com/acme/widgets/pull/7",
    title: "Wrap widgets on narrow screens",
    body: "Closes #42",
    merged: true,
    mergedAt: "2026-10-28T10:00:00Z",
    baseRefName: "main",
    headRefOid: "a".repeat(40),
    mergeCommit: { oid: "b".repeat(40) },
    author: { login: "octocat" },
    mergedBy: { login: "maintainer" },
    repository: { nameWithOwner: "acme/widgets" },
    ...over,
  };
}

export function closedIssue(closer: IssueCloseInfo["timelineItems"]["nodes"][number] extends infer N ? (N extends { closer: infer C } ? C : never) : never): IssueCloseInfo {
  return {
    state: "CLOSED",
    title: "Widgets overflow on mobile",
    body: "Below 400px the grid overflows.",
    url: "https://github.com/acme/widgets/issues/42",
    timelineItems: { nodes: [{ __typename: "ClosedEvent", createdAt: "2026-10-28T10:00:05Z", closer }] },
  };
}

export const openIssue: IssueCloseInfo = {
  state: "OPEN",
  title: "Widgets overflow on mobile",
  body: "Below 400px the grid overflows.",
  url: "https://github.com/acme/widgets/issues/42",
  timelineItems: { nodes: [] },
};

export const SAMPLE_DIFF = `diff --git a/src/grid.css b/src/grid.css
--- a/src/grid.css
+++ b/src/grid.css
@@ -1,3 +1,4 @@
 .grid {
   display: flex;
+  flex-wrap: wrap;
 }
`;

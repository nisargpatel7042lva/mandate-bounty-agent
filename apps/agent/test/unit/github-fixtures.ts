import type { IssueCloseInfo, PrFacts, PullRequestNode } from "../../src/github/client.ts";

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

export const E2E_PAYEE = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"; // anvil dev account 2

/** PR facts as GitHub's GraphQL returns them for the prFacts query (author octocat, payee line present). */
export function prFacts(over: Partial<PrFacts> = {}): PrFacts {
  return { number: 7, merged: true, author: { login: "octocat" }, editor: null, body: `Closes #42\n\nmba-payee: ${E2E_PAYEE}`, ...over };
}

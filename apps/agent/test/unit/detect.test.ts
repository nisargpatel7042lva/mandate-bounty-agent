import { describe, expect, it } from "vitest";
import { IssueCloseInfoSchema } from "../../src/github/client.ts";
import { detectClosingPr } from "../../src/github/detect.ts";
import { closedIssue, mergedPr, openIssue } from "./github-fixtures.ts";

describe("detectClosingPr", () => {
  it("claims an issue closed by a merged PR in the same repo", () => {
    const d = detectClosingPr(closedIssue(mergedPr()), "acme/widgets");
    expect(d.kind).toBe("claim");
    if (d.kind !== "claim") return;
    expect(d.pr).toMatchObject({ number: 7, author: { login: "octocat" }, mergedAt: "2026-10-28T10:00:00Z" });
    expect(d.closedAt).toBe("2026-10-28T10:00:05Z");
  });

  it("matches the repo case-insensitively", () => {
    expect(detectClosingPr(closedIssue(mergedPr()), "ACME/Widgets").kind).toBe("claim");
  });

  it.each([
    ["open issue", openIssue, /open/],
    ["closed manually", closedIssue(null), /manually/],
    ["closed by a commit", closedIssue({ __typename: "Commit" }), /Commit/],
    ["closing PR not merged", closedIssue(mergedPr({ merged: false, mergedAt: null })), /not merged/],
    ["PR from another repo", closedIssue(mergedPr({ repository: { nameWithOwner: "evil/fork" } })), /evil\/fork/],
    ["deleted author", closedIssue(mergedPr({ author: null })), /no author/],
  ])("does not claim when %s", (_name, issue, reason) => {
    const d = detectClosingPr(issue, "acme/widgets");
    expect(d.kind).toBe("none");
    if (d.kind === "none") expect(d.reason).toMatch(reason);
  });

  it("uses the latest close after a reopen", () => {
    const issue = closedIssue(mergedPr({ number: 9 }));
    issue.timelineItems.nodes = [
      { __typename: "ClosedEvent", createdAt: "2026-10-01T00:00:00Z", closer: null },
      { __typename: "ReopenedEvent", createdAt: "2026-10-02T00:00:00Z" },
      ...issue.timelineItems.nodes,
    ];
    const d = detectClosingPr(issue, "acme/widgets");
    expect(d.kind === "claim" && d.pr.number).toBe(9);
  });

  it("does not claim when the last event is a reopen", () => {
    const issue = { ...closedIssue(mergedPr()), state: "CLOSED" as const };
    issue.timelineItems.nodes.push({ __typename: "ReopenedEvent", createdAt: "2026-10-29T00:00:00Z" });
    expect(detectClosingPr(issue, "acme/widgets")).toEqual({ kind: "none", reason: "no close event found" });
  });

  it("schema rejects an unexpected GitHub shape instead of guessing", () => {
    expect(() => IssueCloseInfoSchema.parse({ state: "CLOSED", title: "x" })).toThrow();
  });
});

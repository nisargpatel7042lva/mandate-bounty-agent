import { describe, expect, it } from "vitest";
import { createGitHubClient } from "../../src/github/client.ts";
import { detectClosingPr } from "../../src/github/detect.ts";
import { DEMO_BOUNTY_ISSUE, DEMO_OPEN_ISSUE, DEMO_PR, DEMO_REPO, githubToken } from "./real-services.ts";

// Real GitHub API against the demo repo. Read-only.
describe("GitHub detection against the real demo repo", () => {
  const gh = createGitHubClient({ token: githubToken() });

  it("does not claim the issue that is kept open", async () => {
    const d = detectClosingPr(await gh.issueCloseInfo(DEMO_REPO, DEMO_OPEN_ISSUE), DEMO_REPO);
    expect(d).toEqual({ kind: "none", reason: "issue is open" });
  });

  it("claims the bounty issue for the merged PR that closed it", async () => {
    const d = detectClosingPr(await gh.issueCloseInfo(DEMO_REPO, DEMO_BOUNTY_ISSUE), DEMO_REPO);
    expect(d.kind, d.kind === "none" ? d.reason : "").toBe("claim");
    if (d.kind !== "claim") return;
    expect(d.pr).toMatchObject({
      number: DEMO_PR,
      merged: true,
      baseRefName: "main",
      author: { login: "nisargpatel7042lva" },
      repository: { nameWithOwner: DEMO_REPO },
    });
    expect(d.pr.mergeCommit?.oid).toMatch(/^[0-9a-f]{40}$/);
  });

  it("fetches the merged PR's diff", async () => {
    const diff = await gh.pullDiff(DEMO_REPO, DEMO_PR);
    expect(diff).toContain("diff --git a/grid.css b/grid.css");
    expect(diff).toContain("+  flex-wrap: wrap;");
  });

  it("reports a missing issue as an error, not a claim", async () => {
    await expect(gh.issueCloseInfo(DEMO_REPO, 99_999)).rejects.toThrow(/Could not resolve|not found/);
  });
});

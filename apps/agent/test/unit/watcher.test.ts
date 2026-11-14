import type { BountyDto } from "@mba/shared";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { getBounty } from "../../src/bounties.ts";
import { applyVaultEvents } from "../../src/chain/events.ts";
import { openDb } from "../../src/db/client.ts";
import { bounties } from "../../src/db/schema.ts";
import type { GitHubClient, IssueCloseInfo } from "../../src/github/client.ts";
import type { ReviewOutcome, Reviewer } from "../../src/review/reviewer.ts";
import { MAX_REVIEW_ATTEMPTS, Watcher, processBounty } from "../../src/watcher.ts";
import { VAULT, createdEvent, fakeReader, fundedEvent } from "./fixtures.ts";
import { closedIssue, mergedPr, openIssue, prFacts, SAMPLE_DIFF } from "./github-fixtures.ts";

const NOW = 1_900_000_000;
const verdict = {
  recommendation: "approve" as const,
  criteriaMet: [{ criterion: "wraps", met: true, evidence: "flex-wrap added" }],
  summary: "Looks right.",
  confidence: 0.8,
};

function setup(opts: { issue?: IssueCloseInfo; outcomes?: ReviewOutcome[]; funded?: bigint; criteria?: string | null } = {}) {
  const { db } = openDb(":memory:");
  applyVaultEvents(db, { chainId: 31337, vault: VAULT }, [createdEvent(1), fundedEvent(1, opts.funded ?? 300_000_000n, opts.funded ?? 300_000_000n, 1)]);
  db.update(bounties).set({ acceptanceCriteria: opts.criteria === undefined ? "Widgets wrap below 400px." : opts.criteria }).run();

  let issue = opts.issue ?? closedIssue(mergedPr());
  const outcomes = [...(opts.outcomes ?? [{ ok: true, verdict, model: "claude-opus-5-5" }])];
  const reviewCalls: unknown[] = [];
  const github: GitHubClient = { issueCloseInfo: async () => issue, pullDiff: async () => SAMPLE_DIFF, prFacts: async () => prFacts() };
  const reviewer: Reviewer = {
    review: async (input) => {
      reviewCalls.push(input);
      return outcomes.shift() ?? { ok: false, error: "no more canned outcomes", retryable: false };
    },
  };
  const deps = { github, reviewer, now: () => NOW };
  return { db, deps, reviewCalls, setIssue: (i: IssueCloseInfo) => (issue = i) };
}

describe("watcher state machine", () => {
  it("open -> claimed -> reviewed in one pass when the issue was closed by a merged PR", async () => {
    const { db, deps, reviewCalls } = setup();
    const step = await processBounty(db, deps, 1);
    expect(step).toEqual({ action: "reviewed", recommendation: "approve" });

    const b = getBounty(db, 1) as BountyDto;
    expect(b.status).toBe("reviewed");
    expect(b.claim).toMatchObject({ prNumber: 7, author: "octocat", mergedBy: "maintainer", baseRef: "main", mergeCommitSha: "b".repeat(40) });
    expect(b.claim?.review).toMatchObject({ verdict, model: "claude-opus-5-5", error: null, attempts: 1 });
    expect(reviewCalls[0]).toMatchObject({ acceptanceCriteria: "Widgets wrap below 400px.", diff: SAMPLE_DIFF, pr: { number: 7 } });
  });

  it("stays open with a readable reason while the issue is open, then claims once it closes", async () => {
    const { db, deps, setIssue } = setup({ issue: openIssue });
    expect(await processBounty(db, deps, 1)).toEqual({ action: "waiting", reason: "issue is open" });
    expect(getBounty(db, 1)).toMatchObject({ status: "open", statusReason: "watching: issue is open", claim: null });

    setIssue(closedIssue(mergedPr()));
    expect((await processBounty(db, deps, 1)).action).toBe("reviewed");
  });

  it("keeps watching with a readable reason when GitHub is unreachable", async () => {
    const { db, deps } = setup();
    const down = { ...deps, github: { ...deps.github, issueCloseInfo: async () => Promise.reject(new Error("HTTP 502")) } };
    expect((await processBounty(db, down, 1)).action).toBe("waiting");
    expect(getBounty(db, 1)).toMatchObject({ status: "open", statusReason: expect.stringMatching(/could not read acme\/widgets#42.*HTTP 502/) });
  });

  it("does not watch an underfunded or expired bounty", async () => {
    const under = setup({ funded: 1n });
    expect(await processBounty(under.db, under.deps, 1)).toEqual({ action: "skipped", reason: "underfunded" });

    const expired = setup();
    expect(await processBounty(expired.db, { ...expired.deps, now: () => 2_000_000_001 }, 1)).toEqual({ action: "skipped", reason: "expired" });
    expect(getBounty(expired.db, 1)?.claim).toBeNull();
  });

  it("retries a retryable review failure, then gives up after the cap", async () => {
    const outcomes = Array.from({ length: MAX_REVIEW_ATTEMPTS }, () => ({ ok: false as const, error: "429", retryable: true }));
    const { db, deps } = setup({ outcomes });
    expect((await processBounty(db, deps, 1)).action).toBe("review_retry");
    expect(getBounty(db, 1)).toMatchObject({ status: "claimed", statusReason: expect.stringMatching(/retry \(1\/3\)/) });
    expect((await processBounty(db, deps, 1)).action).toBe("review_retry");
    expect(await processBounty(db, deps, 1)).toEqual({ action: "review_failed", error: "429" });
    expect(getBounty(db, 1)).toMatchObject({ status: "review_failed", claim: { review: { attempts: 3, error: "429" } } });
  });

  it("a non-retryable failure is terminal immediately", async () => {
    const { db, deps } = setup({ outcomes: [{ ok: false, error: "the model declined to review", retryable: false }] });
    expect((await processBounty(db, deps, 1)).action).toBe("review_failed");
    expect(await processBounty(db, deps, 1)).toEqual({ action: "done" });
  });

  it("does not claim a bounty until its acceptance criteria are registered", async () => {
    const { db, deps, reviewCalls } = setup({ criteria: null });
    expect(await processBounty(db, deps, 1)).toEqual({ action: "skipped", reason: "no acceptance criteria" });
    expect(getBounty(db, 1)).toMatchObject({ status: "open", claim: null });
    expect(reviewCalls).toHaveLength(0);

    db.update(bounties).set({ acceptanceCriteria: "Widgets wrap below 400px." }).run();
    expect((await processBounty(db, deps, 1)).action).toBe("reviewed");
  });

  it("without a reviewer, records the claim and waits without spending review attempts", async () => {
    const { db, deps } = setup();
    const noReviewer = { github: deps.github, now: deps.now };
    expect((await processBounty(db, noReviewer, 1)).action).toBe("waiting");
    expect(getBounty(db, 1)).toMatchObject({ status: "claimed", statusReason: expect.stringMatching(/no review LLM key/), claim: { prNumber: 7, review: { attempts: 0 } } });

    // Once a reviewer is configured, the same claim gets reviewed.
    expect((await processBounty(db, deps, 1)).action).toBe("reviewed");
  });

  it("the verdict never touches money fields", async () => {
    const { db, deps } = setup({ outcomes: [{ ok: true, verdict: { ...verdict, recommendation: "reject" }, model: "m" }] });
    const before = db.select().from(bounties).where(eq(bounties.id, 1)).get();
    await processBounty(db, deps, 1);
    const after = db.select().from(bounties).where(eq(bounties.id, 1)).get();
    expect([after?.funded, after?.spent, after?.payoutAmount]).toEqual([before?.funded, before?.spent, before?.payoutAmount]);
  });
});

describe("Watcher concurrency and API", () => {
  it("never processes the same bounty twice at once", async () => {
    const { db, deps } = setup();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const slow = { ...deps, github: { ...deps.github, issueCloseInfo: async () => (await gate, closedIssue(mergedPr())) } };
    const w = new Watcher(db, slow);
    const first = w.check(1);
    expect(await w.check(1)).toEqual({ action: "skipped", reason: "already being processed" });
    release();
    expect((await first).action).toBe("reviewed");
  });

  it("POST /bounties/:id/check runs the watcher and returns the updated bounty", async () => {
    const { db, deps } = setup();
    const app = createApp({ db, chain: fakeReader({}), watcher: new Watcher(db, deps), corsOrigins: [] });
    const res = await app.request("/bounties/1/check", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { step: { action: string }; bounty: BountyDto };
    expect(body.step.action).toBe("reviewed");
    expect(body.bounty.claim?.review.verdict?.recommendation).toBe("approve");

    expect((await app.request("/bounties/99/check", { method: "POST" })).status).toBe(404);
    const noWatcher = createApp({ db, chain: fakeReader({}), corsOrigins: [] });
    expect((await noWatcher.request("/bounties/1/check", { method: "POST" })).status).toBe(503);
  });
});

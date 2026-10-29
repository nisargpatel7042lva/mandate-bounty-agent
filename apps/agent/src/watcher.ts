import { eq, inArray } from "drizzle-orm";
import type { Db } from "./db/client.ts";
import { bounties, claims } from "./db/schema.ts";
import type { GitHubClient } from "./github/client.ts";
import { detectClosingPr } from "./github/detect.ts";
import type { Reviewer } from "./review/reviewer.ts";

export const MAX_REVIEW_ATTEMPTS = 3;

export interface WatcherDeps {
  github: GitHubClient;
  /** Without a reviewer, claims are recorded and the review waits (attempts are not spent). */
  reviewer?: Reviewer | undefined;
  /** Unix seconds; injectable for tests. */
  now?: () => number;
}

export type StepResult =
  | { action: "skipped"; reason: string }
  | { action: "waiting"; reason: string }
  | { action: "claimed"; prNumber: number }
  | { action: "reviewed"; recommendation: string }
  | { action: "review_retry"; error: string }
  | { action: "review_failed"; error: string }
  | { action: "done" };

const nowS = (deps: WatcherDeps) => (deps.now ? deps.now() : Math.floor(Date.now() / 1000));

function setStatus(db: Db, id: number, status: (typeof bounties.$inferSelect)["status"], reason: string | null, now: number) {
  db.update(bounties).set({ status, statusReason: reason, updatedAt: now }).where(eq(bounties.id, id)).run();
}

/**
 * Advances one bounty through open -> claimed -> reviewed | review_failed. Each call does at most
 * one detection and one review. Nothing here can move funds; the verdict is stored as advice.
 */
export async function processBounty(db: Db, deps: WatcherDeps, id: number): Promise<StepResult> {
  const bounty = db.select().from(bounties).where(eq(bounties.id, id)).get();
  if (!bounty) return { action: "skipped", reason: "bounty not found" };
  const now = nowS(deps);

  if (bounty.status === "open") {
    if (BigInt(bounty.funded) < BigInt(bounty.payoutAmount)) {
      setStatus(db, id, "open", "waiting for the bounty to be funded up to its payout", now);
      return { action: "skipped", reason: "underfunded" };
    }
    if (bounty.expiry <= now) {
      setStatus(db, id, "open", "mandate expired before a qualifying PR was merged", now);
      return { action: "skipped", reason: "expired" };
    }
    // Chain sync can mirror a bounty before its creator registers the off-chain metadata.
    // Without acceptance criteria there is nothing to review against, so don't claim yet.
    if (!bounty.acceptanceCriteria) {
      setStatus(db, id, "open", "waiting for acceptance criteria to be registered", now);
      return { action: "skipped", reason: "no acceptance criteria" };
    }

    let info;
    try {
      info = await deps.github.issueCloseInfo(bounty.repo, bounty.issueNumber);
    } catch (err) {
      const reason = `could not read ${bounty.repo}#${bounty.issueNumber} from GitHub: ${(err as Error).message}`;
      setStatus(db, id, "open", reason, now);
      return { action: "waiting", reason };
    }
    const detection = detectClosingPr(info, bounty.repo);
    if (detection.kind === "none") {
      setStatus(db, id, "open", `watching: ${detection.reason}`, now);
      return { action: "waiting", reason: detection.reason };
    }

    const pr = detection.pr;
    db.transaction((tx) => {
      tx.insert(claims)
        .values({
          bountyId: id,
          repo: pr.repository.nameWithOwner,
          prNumber: pr.number,
          prUrl: pr.url,
          prTitle: pr.title,
          prBody: pr.body,
          author: pr.author.login,
          mergedBy: pr.mergedBy?.login ?? null,
          mergedAt: pr.mergedAt,
          baseRef: pr.baseRefName,
          headSha: pr.headRefOid,
          mergeCommitSha: pr.mergeCommit?.oid ?? null,
          closedAt: detection.closedAt,
          detectedAt: now,
        })
        .onConflictDoNothing()
        .run();
      tx.update(bounties).set({ status: "claimed", statusReason: null, updatedAt: now }).where(eq(bounties.id, id)).run();
    });
    return reviewClaim(db, deps, id);
  }

  if (bounty.status === "claimed") return reviewClaim(db, deps, id);
  return { action: "done" };
}

async function reviewClaim(db: Db, deps: WatcherDeps, id: number): Promise<StepResult> {
  const bounty = db.select().from(bounties).where(eq(bounties.id, id)).get();
  const claim = db.select().from(claims).where(eq(claims.bountyId, id)).get();
  if (!bounty || !claim) return { action: "skipped", reason: "no claim to review" };
  const now = nowS(deps);

  const fail = (error: string, retryable: boolean): StepResult => {
    const attempts = claim.reviewAttempts + 1;
    db.update(claims).set({ reviewAttempts: attempts, reviewError: error }).where(eq(claims.bountyId, id)).run();
    if (retryable && attempts < MAX_REVIEW_ATTEMPTS) {
      setStatus(db, id, "claimed", `review will retry (${attempts}/${MAX_REVIEW_ATTEMPTS}): ${error}`, now);
      return { action: "review_retry", error };
    }
    setStatus(db, id, "review_failed", error, now);
    return { action: "review_failed", error };
  };

  if (!bounty.acceptanceCriteria) return fail("bounty has no acceptance criteria to review against", false);
  if (!deps.reviewer) {
    const reason = "review waiting: no Claude API key is configured on this agent";
    setStatus(db, id, "claimed", reason, now);
    return { action: "waiting", reason };
  }

  let diff: string;
  let issue: { title: string; body: string };
  try {
    [diff, issue] = await Promise.all([
      deps.github.pullDiff(claim.repo, claim.prNumber),
      deps.github.issueCloseInfo(bounty.repo, bounty.issueNumber),
    ]);
  } catch (err) {
    return fail(`could not load the PR from GitHub: ${(err as Error).message}`, true);
  }

  const outcome = await deps.reviewer.review({
    repo: bounty.repo,
    issueNumber: bounty.issueNumber,
    issueTitle: issue.title,
    issueBody: issue.body,
    acceptanceCriteria: bounty.acceptanceCriteria,
    pr: { number: claim.prNumber, title: claim.prTitle, body: claim.prBody, author: claim.author },
    diff,
  });
  if (!outcome.ok) return fail(outcome.error, outcome.retryable);

  db.transaction((tx) => {
    tx.update(claims)
      .set({ verdict: outcome.verdict, reviewModel: outcome.model, reviewedAt: now, reviewError: null, reviewAttempts: claim.reviewAttempts + 1 })
      .where(eq(claims.bountyId, id))
      .run();
    tx.update(bounties).set({ status: "reviewed", statusReason: null, updatedAt: now }).where(eq(bounties.id, id)).run();
  });
  return { action: "reviewed", recommendation: outcome.verdict.recommendation };
}

/** Serialises work per bounty so the poll loop and a manual check never race on one bounty. */
export class Watcher {
  private readonly inFlight = new Set<number>();
  private readonly db: Db;
  private readonly deps: WatcherDeps;

  constructor(db: Db, deps: WatcherDeps) {
    this.db = db;
    this.deps = deps;
  }

  async check(id: number): Promise<StepResult> {
    if (this.inFlight.has(id)) return { action: "skipped", reason: "already being processed" };
    this.inFlight.add(id);
    try {
      return await processBounty(this.db, this.deps, id);
    } finally {
      this.inFlight.delete(id);
    }
  }

  /** One pass over every bounty that still needs work. Errors are reported per bounty, not thrown. */
  async tick(): Promise<{ id: number; result?: StepResult; error?: string }[]> {
    const pending = this.db.select({ id: bounties.id }).from(bounties).where(inArray(bounties.status, ["open", "claimed"])).all();
    const out: { id: number; result?: StepResult; error?: string }[] = [];
    for (const { id } of pending) {
      try {
        out.push({ id, result: await this.check(id) });
      } catch (err) {
        out.push({ id, error: (err as Error).message });
      }
    }
    return out;
  }
}

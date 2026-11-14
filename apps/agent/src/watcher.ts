import { findPayees, PAYEE_LINE, verifyMergedPrProof, type BountyBinding, type ZkTlsProof } from "@mba/zktls";
import { eq, inArray } from "drizzle-orm";
import type { Db } from "./db/client.ts";
import { bounties, claims, workProofs } from "./db/schema.ts";
import type { GitHubClient } from "./github/client.ts";
import { detectClosingPr } from "./github/detect.ts";
import type { Reviewer } from "./review/reviewer.ts";
import { mandateStep, type MandateStepResult, type ZkVerifier } from "./mandate-step.ts";
import { payoutStep, type PayoutStepResult, type Payer } from "./payout-step.ts";

export const MAX_REVIEW_ATTEMPTS = 3;
export const MAX_PROOF_ATTEMPTS = 3;

/** Produces zkTLS proofs of a PR (Reclaim zkFetch in production) and names the attestors to trust. */
export interface WorkProver {
  prove(input: { repo: string; prNumber: number; binding: BountyBinding }): Promise<ZkTlsProof>;
  trustedAttestors: string[];
}

export interface WatcherDeps {
  github: GitHubClient;
  /** Without a reviewer, claims are recorded and the review waits (attempts are not spent). */
  reviewer?: Reviewer | undefined;
  /** Without a prover, reviewed bounties wait for their work proof (attempts are not spent). */
  prover?: WorkProver | undefined;
  /** Without it, mandate proofs are made and verified locally, and wait for zkVerify. */
  zkverify?: ZkVerifier | undefined;
  /** Without it, zkVerify-proven bounties wait for a signer to release the payout. */
  payer?: Payer | undefined;
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
  | { action: "work_proven"; identifier: string }
  | { action: "proof_retry"; error: string }
  | { action: "work_proof_failed"; code: string; error: string }
  | MandateStepResult
  | PayoutStepResult
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
  if (bounty.status === "reviewed") return proveWork(db, deps, id);
  if (bounty.status === "work_proven") return proveMandateStep(db, deps, id);
  if (bounty.status === "mandate_proven" || bounty.status === "held_for_funder") return payoutStep(db, deps.payer, id, nowS(deps));
  return { action: "done" };
}

/**
 * Proves, over zkTLS, that GitHub's API reports the claimed PR as merged by the claimed author in
 * the bounty's repo, bound to this bounty, then verifies the proof locally. reviewed -> work_proven
 * or work_proof_failed. The proof's verdict is independent of the LLM's advice.
 */
async function proveWork(db: Db, deps: WatcherDeps, id: number): Promise<StepResult> {
  const bounty = db.select().from(bounties).where(eq(bounties.id, id)).get();
  const claim = db.select().from(claims).where(eq(claims.bountyId, id)).get();
  if (!bounty || !claim) return { action: "skipped", reason: "no claim to prove" };
  const now = nowS(deps);

  if (!deps.prover) {
    const reason = "work proof waiting: Reclaim zkTLS is not configured on this agent";
    setStatus(db, id, "reviewed", reason, now);
    return { action: "waiting", reason };
  }

  // The payee comes from a `mba-payee: 0x...` line in the PR description. Check it with a plain
  // GitHub call first: a missing or ambiguous line is the contributor's to fix, so the bounty waits
  // (spending no proof attempts) instead of failing.
  let facts;
  try {
    facts = await deps.github.prFacts(bounty.repo, claim.prNumber);
  } catch (err) {
    const reason = `could not read PR #${claim.prNumber} from GitHub: ${(err as Error).message}`;
    setStatus(db, id, "reviewed", reason, now);
    return { action: "waiting", reason };
  }
  const payees = findPayees(facts.body);
  const waitFor = (reason: string): StepResult => (setStatus(db, id, "reviewed", reason, now), { action: "waiting", reason });
  if (payees.length === 0) return waitFor(`waiting for the contributor to add a line "${PAYEE_LINE} 0x..." with their wallet to PR #${claim.prNumber}'s description`);
  if (payees.length > 1) return waitFor(`PR #${claim.prNumber}'s description names ${payees.length} different payees; it must name exactly one`);
  if (facts.editor && facts.editor.login.toLowerCase() !== claim.author.toLowerCase()) {
    return waitFor(`PR #${claim.prNumber}'s description was last edited by @${facts.editor.login}, not the author; @${claim.author} must save it again`);
  }

  const existing = db.select().from(workProofs).where(eq(workProofs.bountyId, id)).get();
  const attempts = (existing?.attempts ?? 0) + 1;
  const binding: BountyBinding = { chainId: bounty.chainId, vault: bounty.vault as `0x${string}`, bountyId: id };

  let proof: ZkTlsProof;
  try {
    proof = await deps.prover.prove({ repo: bounty.repo, prNumber: claim.prNumber, binding });
  } catch (err) {
    const error = `zkTLS proof generation failed: ${(err as Error).message}`;
    const final = attempts >= MAX_PROOF_ATTEMPTS;
    db.insert(workProofs)
      .values({ bountyId: id, attempts, error, failureCode: final ? "PROOF_GENERATION_FAILED" : null })
      .onConflictDoUpdate({ target: workProofs.bountyId, set: { attempts, error, failureCode: final ? "PROOF_GENERATION_FAILED" : null } })
      .run();
    if (final) {
      setStatus(db, id, "work_proof_failed", error, now);
      return { action: "work_proof_failed", code: "PROOF_GENERATION_FAILED", error };
    }
    setStatus(db, id, "reviewed", `work proof will retry (${attempts}/${MAX_PROOF_ATTEMPTS}): ${error}`, now);
    return { action: "proof_retry", error };
  }

  const result = verifyMergedPrProof(proof, deps.prover.trustedAttestors, { ...binding, repo: bounty.repo, prNumber: claim.prNumber, author: claim.author });
  const row = result.ok
    ? { proof, claim: result.claim, identifier: result.identifier, signers: result.signers, attestedAt: result.attestedAt, verifiedAt: now, failureCode: null, error: null, attempts }
    : { proof, claim: null, identifier: proof.identifier ?? null, signers: null, attestedAt: null, verifiedAt: null, failureCode: result.code, error: result.reason, attempts };

  db.transaction((tx) => {
    tx.insert(workProofs).values({ bountyId: id, ...row }).onConflictDoUpdate({ target: workProofs.bountyId, set: row }).run();
    tx.update(bounties)
      .set(result.ok ? { status: "work_proven", statusReason: null, updatedAt: now } : { status: "work_proof_failed", statusReason: `${result.code}: ${result.reason}`, updatedAt: now })
      .where(eq(bounties.id, id))
      .run();
  });
  if (!result.ok) return { action: "work_proof_failed", code: result.code, error: result.reason };
  // Continue to the mandate proof in the same pass when zkVerify is configured.
  if (deps.zkverify) return proveMandateStep(db, deps, id);
  return { action: "work_proven", identifier: result.identifier };
}

/** work_proven -> mandate_proven (then straight on to the payout) | mandate_rejected. */
async function proveMandateStep(db: Db, deps: WatcherDeps, id: number): Promise<StepResult> {
  const r = await mandateStep(db, deps.zkverify, id, nowS(deps));
  if (r.action === "mandate_proven") return payoutStep(db, deps.payer, id, nowS(deps));
  return r;
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
    const reason = "review waiting: no review LLM key (Gemini or Claude) is configured on this agent";
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
  // Prove the work in the same pass when a prover is configured; otherwise the next pass will.
  if (deps.prover) return proveWork(db, deps, id);
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
    const pending = this.db.select({ id: bounties.id }).from(bounties).where(inArray(bounties.status, ["open", "claimed", "reviewed", "work_proven", "mandate_proven", "held_for_funder"])).all();
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

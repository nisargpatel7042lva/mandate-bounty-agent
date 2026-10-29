"use client";

import type { BountyDto } from "@mba/shared";
import { RECOMMENDATION } from "../lib/status.ts";

const shortSha = (sha: string | null) => (sha ? sha.slice(0, 7) : "-");
const when = (iso: string) => new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC";

/** The merged PR that closed the issue, and the LLM's advisory review of it. */
export function ClaimPanel({ bounty }: { bounty: BountyDto }) {
  const claim = bounty.claim;
  if (!claim) {
    return (
      <div className="card" data-testid="no-claim">
        <p style={{ margin: 0 }}>No merged pull request has closed this issue yet.</p>
        {bounty.statusReason && <p className="row-meta" style={{ margin: "6px 0 0" }}>{bounty.statusReason}</p>}
      </div>
    );
  }

  const { verdict, error, model } = claim.review;
  const rec = verdict ? RECOMMENDATION[verdict.recommendation] : null;

  return (
    <>
      <div className="card" data-testid="claim">
        <dl className="kv">
          <dt>Pull request</dt>
          <dd>
            <a href={claim.prUrl} target="_blank" rel="noreferrer">
              #{claim.prNumber} {claim.prTitle}
            </a>
          </dd>
          <dt>Author</dt>
          <dd>
            <a href={`https://github.com/${claim.author}`} target="_blank" rel="noreferrer">
              @{claim.author}
            </a>
          </dd>
          <dt>Merged</dt>
          <dd>
            {when(claim.mergedAt)} into <span className="mono">{claim.baseRef}</span>
            {claim.mergedBy && <> by @{claim.mergedBy}</>}
          </dd>
          <dt>Merge commit</dt>
          <dd className="mono">{shortSha(claim.mergeCommitSha)}</dd>
        </dl>
      </div>

      <h2>Advisory review</h2>
      <div className="card" data-testid="review">
        <p className="notice warn" style={{ marginTop: 0 }}>
          The LLM proposes, the proofs dispose. This review is advice only: it cannot release or block a payout.
        </p>
        {verdict && rec ? (
          <>
            <p>
              <span className={`pill ${rec.tone}`} data-testid="recommendation">
                {rec.label}
              </span>{" "}
              <span className="row-meta">confidence {Math.round(verdict.confidence * 100)}% · {model}</span>
            </p>
            <p>{verdict.summary}</p>
            <ul className="criteria">
              {verdict.criteriaMet.map((c, i) => (
                <li key={i} className={c.met ? "met" : "unmet"}>
                  <strong>{c.met ? "Met" : "Not met"}:</strong> {c.criterion}
                  <div className="row-meta">{c.evidence}</div>
                </li>
              ))}
            </ul>
          </>
        ) : error ? (
          <p className="notice err" style={{ marginBottom: 0 }}>
            Review {bounty.status === "review_failed" ? "failed" : "will retry"}: {error}
          </p>
        ) : (
          <p className="lede" style={{ margin: 0 }}>Review in progress…</p>
        )}
      </div>
    </>
  );
}

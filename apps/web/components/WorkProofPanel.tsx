"use client";

import type { BountyDto } from "@mba/shared";
import { shortAddress } from "../lib/format.ts";
import { PROOF_FAILURE } from "../lib/status.ts";

const when = (iso: string) => new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC";
const whenS = (s: number) => when(new Date(s * 1000).toISOString());

/** The zkTLS proof of the merge, explained in plain English: what it shows and what it does not. */
export function WorkProofPanel({ bounty, agentUrl }: { bounty: BountyDto; agentUrl: string }) {
  const p = bounty.workProof;
  if (!p) {
    return (
      <div className="card" data-testid="no-work-proof">
        <p style={{ margin: 0 }}>{bounty.claim ? "No proof yet. The agent proves the merge after the review." : "Waiting for a merged pull request."}</p>
        {bounty.status === "reviewed" && bounty.statusReason && <p className="row-meta" style={{ margin: "6px 0 0" }}>{bounty.statusReason}</p>}
      </div>
    );
  }

  const rawUrl = `${agentUrl.replace(/\/$/, "")}/bounties/${bounty.id}/proof`;

  if (p.state !== "verified" || !p.claim) {
    return (
      <div className="card" data-testid="work-proof">
        <p className={`notice ${p.state === "failed" ? "err" : "warn"}`} style={{ marginTop: 0 }}>
          {p.state === "failed" ? "The merge could not be proven. " : "Proof in progress. "}
          {p.failureCode ? PROOF_FAILURE[p.failureCode] ?? p.failureCode : null}
        </p>
        {p.error && <p className="row-meta">{p.error}</p>}
        {p.identifier && (
          <p className="row-meta" style={{ marginBottom: 0 }}>
            Proof <span className="mono">{shortAddress(p.identifier)}</span> ·{" "}
            <a href={rawUrl} target="_blank" rel="noreferrer">
              raw proof
            </a>
          </p>
        )}
      </div>
    );
  }

  const c = p.claim;
  return (
    <>
      <div className="card proof-box ok" data-testid="proof-establishes">
        <h3>What this proof establishes</h3>
        <ul>
          <li>
            GitHub&apos;s API (<span className="mono">api.github.com</span>) itself reported that pull request <strong>#{c.prNumber}</strong> in{" "}
            <strong>{c.repo}</strong> is <strong>merged</strong>, into <span className="mono">{c.baseRef}</span>, on {c.mergedAt ? when(c.mergedAt) : "-"}.
          </li>
          <li>
            It names <strong>@{c.author}</strong> as the pull request&apos;s author.
          </li>
          <li>
            The pull request&apos;s description names payee wallet <span className="mono" data-testid="proof-payee">{c.payee}</span>, and that
            description was {c.lastEditor ? <>last edited by its author @{c.lastEditor}</> : "never edited after it was opened"}, so the author chose
            this wallet.
          </li>
          <li>
            The answer came over a TLS connection observed by a Reclaim attestor that signed it ({p.signers.map(shortAddress).join(", ")}), on{" "}
            {p.attestedAt ? whenS(p.attestedAt) : "-"}. Any later edit breaks the signature.
          </li>
          <li>The proof is bound to this bounty (chain {bounty.chainId}, bounty #{bounty.id}), so it cannot be reused for another one.</li>
          <li>The agent&apos;s GitHub token was used privately and is not in the proof.</li>
        </ul>
      </div>
      <div className="card proof-box" data-testid="proof-does-not-establish">
        <h3>What it does NOT establish</h3>
        <ul>
          <li>That the code is correct or meets the acceptance criteria. That is the advisory review&apos;s opinion, not a proof.</li>
          <li>That @{c.author} holds the key to {c.payee}. The author named it; whether they control it is on them.</li>
          <li>That {c.payee} is on this bounty&apos;s allowlist, or that the payout fits the funder&apos;s mandate. The mandate proof (next phase) checks both.</li>
          <li>Anything about GitHub beyond these fields, or that GitHub itself is honest. The proof trusts GitHub&apos;s API and the Reclaim attestor.</li>
          <li>It is not on zkVerify yet: the next phase binds this claim into the mandate proof that zkVerify verifies.</li>
        </ul>
      </div>
      <p className="row-meta" data-testid="proof-reference">
        Proof reference <span className="mono">{p.identifier}</span> ·{" "}
        <a href={rawUrl} target="_blank" rel="noreferrer">
          raw proof (re-verifiable)
        </a>
      </p>
    </>
  );
}

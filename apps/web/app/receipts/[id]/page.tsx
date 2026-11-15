"use client";

import type { BountyDto } from "@mba/shared";
import { useParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useConfig } from "../../../components/use-config.ts";
import { agentApi } from "../../../lib/api.ts";
import { addressUrl, txUrl } from "../../../lib/config.ts";
import { formatUsdc, shortAddress } from "../../../lib/format.ts";
import { RECOMMENDATION } from "../../../lib/status.ts";

const Frame = ({ children }: { children: ReactNode }) => <div className="page shell">{children}</div>;

/** The rotating "verified" seal: text set on a circle around a filled core. */
function Seal() {
  return (
    <div className="seal-stamp" aria-hidden>
      <svg viewBox="0 0 200 200">
        <defs>
          <path id="seal-c" d="M100 100m-78 0a78 78 0 1 1 156 0a78 78 0 1 1 -156 0" />
        </defs>
        <circle cx="100" cy="100" r="96" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <text fill="currentColor" style={{ font: "500 15px var(--f-mono), monospace", letterSpacing: "0.18em" }}>
          <textPath href="#seal-c" textLength="482" lengthAdjust="spacing">
            VERIFIED · ZKTLS · GROTH16 · ZKVERIFY · PAID ·
          </textPath>
        </text>
      </svg>
      <div className="core">
        <span>✓</span>
      </div>
    </div>
  );
}

const whenS = (s: number | null) => (s ? new Date(s * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "-");

function Ext({ href, children, testId }: { href: string | null; children: React.ReactNode; testId?: string }) {
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" data-testid={testId}>
      {children}
    </a>
  ) : (
    <span data-testid={testId}>{children}</span>
  );
}

/**
 * Public receipt for a paid bounty: everything needed to check the payout without trusting the agent.
 * The PR, the advisory review, the zkTLS claim, the zkVerify references and the vault payment.
 */
export default function ReceiptPage() {
  const cfg = useConfig();
  const { id } = useParams<{ id: string }>();
  const [b, setB] = useState<BountyDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cfg.ok) return;
    agentApi(cfg.config.agentUrl)
      .get(Number(id))
      .then(setB)
      .catch((e: Error) => setError(e.message));
  }, [cfg, id]);

  if (!cfg.ok) return <Frame><p className="notice err">Configuration error: {cfg.error}</p></Frame>;
  if (error) return <Frame><p className="notice err">Could not load receipt #{id}: {error}</p></Frame>;
  if (!b) return <Frame><p className="lede">Loading…</p></Frame>;
  if (b.status !== "paid" || !b.payout?.txHash) return <Frame><p className="notice warn">Bounty #{id} has not been paid, so there is no receipt yet.</p></Frame>;

  const { config } = cfg;
  const c = b.claim;
  const w = b.workProof;
  const m = b.mandateProof;
  const v = c?.review.verdict;
  const rawProof = `${config.agentUrl.replace(/\/$/, "")}/bounties/${b.id}/proof`;

  return (
    <div className="page shell">
    <article className="receipt" data-testid="receipt">
      <header className="r-head">
        <span className="label seal">Payout receipt · bounty #{b.id}</span>
        <h1>
          Paid, <span className="it">and proven.</span>
        </h1>
        <p className="r-total">
          <b>{formatUsdc(b.payout.amount)}</b>
          <span>
            {b.title ?? `${b.repo}#${b.issueNumber}`} · {whenS(b.payout.paidAt)}
          </span>
        </p>
        <Seal />
      </header>

      <section className="r-sec">
        <header>
          <span className="num">01</span>
          <h2>Payment</h2>
          <p>Sent by the vault after it checked both proofs on-chain.</p>
        </header>
      <div className="card">
        <dl className="kv">
          <dt>Amount</dt>
          <dd data-testid="r-amount">{formatUsdc(b.payout.amount)}</dd>
          <dt>Paid to</dt>
          <dd className="mono" data-testid="r-payee">
            <Ext href={addressUrl(config, b.payout.payee)}>{b.payout.payee}</Ext>
          </dd>
          <dt>Payment tx</dt>
          <dd className="mono">
            <Ext href={txUrl(config, b.payout.txHash)} testId="r-payment-tx">
              {b.payout.txHash}
            </Ext>
          </dd>
          <dt>Vault</dt>
          <dd className="mono">
            <Ext href={addressUrl(config, b.vault)}>{b.vault}</Ext> (chain {b.chainId})
          </dd>
        </dl>
      </div>
      </section>

      <section className="r-sec">
        <header>
          <span className="num">02</span>
          <h2>Delivered work</h2>
          <p>The merged pull request that closed the issue.</p>
        </header>
      <div className="card">
        <dl className="kv">
          <dt>Pull request</dt>
          <dd data-testid="r-pr">
            <Ext href={c?.prUrl ?? null}>
              {c ? `${c.repo}#${c.prNumber} ${c.prTitle}` : "-"}
            </Ext>
          </dd>
          <dt>Author</dt>
          <dd data-testid="r-author">@{c?.author}</dd>
          <dt>Merged</dt>
          <dd>{c ? `${c.mergedAt.slice(0, 16).replace("T", " ")} UTC into ${c.baseRef}` : "-"}</dd>
        </dl>
      </div>
      </section>

      <section className="r-sec">
        <header>
          <span className="num">03</span>
          <h2>Advisory review</h2>
          <p>The model's opinion. Recorded, never obeyed.</p>
        </header>
      <div className="card" data-testid="r-verdict">
        {v ? (
          <>
            <p style={{ marginTop: 0 }}>
              <span className={`pill ${RECOMMENDATION[v.recommendation].tone}`}>{RECOMMENDATION[v.recommendation].label}</span>{" "}
              <span className="row-meta">
                confidence {Math.round(v.confidence * 100)}% · {c?.review.model}
                {b.reviewOverride ? " · funder approved despite the review" : ""}
              </span>
            </p>
            <p style={{ marginBottom: 0 }}>{v.summary}</p>
          </>
        ) : (
          "-"
        )}
        <p className="row-meta" style={{ marginBottom: 0 }}>
          Advice only. It cannot release or block a payout; the two proofs below decide.
        </p>
      </div>
      </section>

      <section className="r-sec">
        <header>
          <span className="num">04</span>
          <h2>zkTLS proof</h2>
          <p>What GitHub's API said, signed by a Reclaim attestor.</p>
        </header>
      <div className="card">
        <dl className="kv">
          <dt>Claim</dt>
          <dd data-testid="r-zktls-claim">
            GitHub&apos;s API reported {w?.claim?.repo}#{w?.claim?.prNumber} merged into {w?.claim?.baseRef} at {w?.claim?.mergedAt}, authored by @
            {w?.claim?.author}, naming payee {w?.claim?.payee}
          </dd>
          <dt>Proof id</dt>
          <dd className="mono" data-testid="r-zktls-id">
            {w?.identifier}
          </dd>
          <dt>Attestor</dt>
          <dd className="mono">{w?.signers.map(shortAddress).join(", ")} (Reclaim)</dd>
          <dt>Raw proof</dt>
          <dd>
            <Ext href={rawProof} testId="r-zktls-raw">
              download and re-verify
            </Ext>
          </dd>
        </dl>
      </div>
      </section>

      <section className="r-sec">
        <header>
          <span className="num">05</span>
          <h2>Mandate proof</h2>
          <p>The payout fits the mandate, verified on zkVerify.</p>
        </header>
      <div className="card">
        <dl className="kv">
          <dt>Mandate</dt>
          <dd>
            cap {formatUsdc(b.mandate.perPayoutCap)}, budget {formatUsdc(b.mandate.totalBudget)}, expires {whenS(b.mandate.expiry)}, {b.mandate.allowedPayees.length}{" "}
            allowed payee(s)
          </dd>
          <dt>Commitment</dt>
          <dd className="mono" data-testid="r-commitment">
            {m?.commitment}
          </dd>
          <dt>zkVerify status</dt>
          <dd data-testid="r-zkverify-status">{m?.zkVerify.status}</dd>
          <dt>zkVerify tx</dt>
          <dd className="mono">
            <Ext href={m?.zkVerify.txUrl ?? null} testId="r-zkverify-tx">
              {m?.zkVerify.txHash ?? "-"}
            </Ext>
          </dd>
          <dt>Aggregation</dt>
          <dd className="mono" data-testid="r-aggregation">
            {m?.zkVerify.aggregationId !== null && m?.zkVerify.aggregationId !== undefined
              ? `#${m.zkVerify.aggregationId}, domain ${m.zkVerify.domainId ?? 0}, leaf ${m.zkVerify.statement}`
              : "direct verification"}
          </dd>
          <dt>Public inputs</dt>
          <dd className="mono" style={{ fontSize: 12 }} data-testid="r-public-inputs">
            {m?.publicSignals.join(", ")}
          </dd>
        </dl>
      </div>
      </section>
    </article>
    </div>
  );
}

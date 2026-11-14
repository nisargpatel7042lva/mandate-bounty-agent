"use client";

import type { BountyDto } from "@mba/shared";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useConfig } from "../../../components/use-config.ts";
import { agentApi } from "../../../lib/api.ts";
import { addressUrl, txUrl } from "../../../lib/config.ts";
import { formatUsdc, shortAddress } from "../../../lib/format.ts";
import { RECOMMENDATION } from "../../../lib/status.ts";

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

  if (!cfg.ok) return <p className="notice err">Configuration error: {cfg.error}</p>;
  if (error) return <p className="notice err">Could not load receipt #{id}: {error}</p>;
  if (!b) return <p className="lede">Loading…</p>;
  if (b.status !== "paid" || !b.payout?.txHash) return <p className="notice warn">Bounty #{id} has not been paid, so there is no receipt yet.</p>;

  const { config } = cfg;
  const c = b.claim;
  const w = b.workProof;
  const m = b.mandateProof;
  const v = c?.review.verdict;
  const rawProof = `${config.agentUrl.replace(/\/$/, "")}/bounties/${b.id}/proof`;

  return (
    <article data-testid="receipt">
      <h1>Payout receipt · bounty #{b.id}</h1>
      <p className="lede">
        {b.title ?? `${b.repo}#${b.issueNumber}`} · paid {formatUsdc(b.payout.amount)} on {whenS(b.payout.paidAt)}
      </p>

      <h2>1. Payment</h2>
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

      <h2>2. Delivered work</h2>
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

      <h2>3. Advisory review (LLM)</h2>
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

      <h2>4. zkTLS proof of the merge</h2>
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

      <h2>5. Mandate proof on zkVerify</h2>
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
    </article>
  );
}

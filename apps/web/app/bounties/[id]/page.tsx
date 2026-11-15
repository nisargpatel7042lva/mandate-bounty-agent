"use client";

import type { BountyDto } from "@mba/shared";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ClaimPanel } from "../../../components/ClaimPanel.tsx";
import { WorkProofPanel } from "../../../components/WorkProofPanel.tsx";
import { MandatePayoutPanel } from "../../../components/MandatePayoutPanel.tsx";
import { Pipeline } from "../../../components/Pipeline.tsx";
import { useConfig } from "../../../components/use-config.ts";
import { agentApi } from "../../../lib/api.ts";
import { addressUrl, txUrl, type WebConfig } from "../../../lib/config.ts";
import { formatExpiry, formatUsdc, shortAddress } from "../../../lib/format.ts";
import { isPending, STATUS } from "../../../lib/status.ts";

function Hash({ config, value, kind }: { config: WebConfig; value: string; kind: "tx" | "address" }) {
  const href = kind === "tx" ? txUrl(config, value) : addressUrl(config, value);
  const label = <span className="mono">{kind === "tx" ? shortAddress(value) : value}</span>;
  return href ? (
    <a href={href} target="_blank" rel="noreferrer">
      {label}
    </a>
  ) : (
    label
  );
}

const REFRESH_MS = 5_000;

const Frame = ({ children }: { children: ReactNode }) => <div className="page shell">{children}</div>;

export default function BountyDetailPage() {
  const cfg = useConfig();
  const { id } = useParams<{ id: string }>();
  const [bounty, setBounty] = useState<BountyDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!cfg.ok) return;
    agentApi(cfg.config.agentUrl)
      .get(Number(id))
      .then((b) => {
        setBounty(b);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [cfg, id]);

  useEffect(load, [load]);

  // Keep polling while the agent still has work to do on this bounty.
  const pending = bounty ? isPending(bounty.status) : false;
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [pending, load]);

  const checkNow = () => {
    if (!cfg.ok) return;
    setChecking(true);
    setCheckError(null);
    agentApi(cfg.config.agentUrl)
      .check(Number(id))
      .then((r) => setBounty(r.bounty))
      .catch((e: Error) => setCheckError(e.message))
      .finally(() => setChecking(false));
  };

  if (!cfg.ok) return <Frame><p className="notice err">Configuration error: {cfg.error}</p></Frame>;
  if (error) return <Frame><p className="notice err">Could not load bounty #{id}: {error}</p></Frame>;
  if (!bounty) return <Frame><p className="lede">Loading…</p></Frame>;

  const { config } = cfg;
  const budget = BigInt(bounty.mandate.totalBudget);
  const funded = BigInt(bounty.funded);
  const pct = budget > 0n ? Number((funded * 10_000n) / budget) / 100 : 0;
  const expired = bounty.mandate.expiry * 1000 <= Date.now();
  const coversPayout = funded >= BigInt(bounty.payoutAmount);

  return (
    <div className="page shell">
      <header className="b-head">
        <div className="b-meta">
          <span>Bounty #{String(bounty.id).padStart(3, "0")}</span>
          <span aria-hidden>·</span>
          <a href={`https://github.com/${bounty.repo}/issues/${bounty.issueNumber}`} target="_blank" rel="noreferrer">
            {bounty.repo}#{bounty.issueNumber}
          </a>
          <span aria-hidden>·</span>
          {expired ? <span className="pill warn">mandate expired</span> : coversPayout ? <span className="pill ok">funded</span> : <span className="pill warn">underfunded</span>}
          <span className={`pill ${STATUS[bounty.status].tone}`} data-testid="status">
            {STATUS[bounty.status].label}
          </span>
        </div>
        <h1>{bounty.title ?? `${bounty.repo}#${bounty.issueNumber}`}</h1>
        <Pipeline status={bounty.status} />
      </header>

      <div className="b-grid">
        <div className="b-main">
          <h2>Acceptance criteria</h2>
          <div className="card criteria-text">{bounty.acceptanceCriteria ?? <span className="row-meta">Not provided.</span>}</div>

          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <h2>Delivered work</h2>
            {pending && (
              <button type="button" className="btn secondary sm" onClick={checkNow} disabled={checking}>
                {checking ? "Checking…" : "Check GitHub now"}
              </button>
            )}
          </div>
          {checkError && <p className="notice err">{checkError}</p>}
          <ClaimPanel bounty={bounty} />

          <h2>Proof of merge (zkTLS)</h2>
          <WorkProofPanel bounty={bounty} agentUrl={config.agentUrl} />

          <MandatePayoutPanel bounty={bounty} config={config} onChange={load} />

          <h2>On-chain</h2>
          <div className="card">
            <dl className="kv">
              <dt>Funder</dt>
              <dd>
                <Hash config={config} value={bounty.funder} kind="address" />
              </dd>
              <dt>Vault</dt>
              <dd>
                <Hash config={config} value={bounty.vault} kind="address" />
              </dd>
              <dt>Created in</dt>
              <dd>
                <Hash config={config} value={bounty.createdTx} kind="tx" /> (block {bounty.createdBlock}, chain {bounty.chainId})
              </dd>
            </dl>
          </div>
        </div>

        <aside className="b-aside" aria-label="Bounty summary">
          <div className="card">
            <span className="label">Payout</span>
            <p className="b-payout">{formatUsdc(bounty.payoutAmount)}</p>
            <dl className="kv">
              <dt>Funded</dt>
              <dd data-testid="funded">
                {formatUsdc(bounty.funded)} of {formatUsdc(bounty.mandate.totalBudget)} budget
                <div className="meter" aria-hidden>
                  <span style={{ width: `${Math.min(pct, 100)}%` }} />
                </div>
              </dd>
              <dt>Spent</dt>
              <dd>{formatUsdc(bounty.spent)}</dd>
            </dl>
          </div>
          <div className="card">
            <h2>Mandate</h2>
            <dl className="kv">
              <dt>Per-payout cap</dt>
              <dd>{formatUsdc(bounty.mandate.perPayoutCap)}</dd>
              <dt>Total budget</dt>
              <dd>{formatUsdc(bounty.mandate.totalBudget)}</dd>
              <dt>Expires</dt>
              <dd>{formatExpiry(bounty.mandate.expiry)}</dd>
              <dt>Allowed payees</dt>
              <dd>
                {bounty.mandate.allowedPayees.map((p) => (
                  <div key={p}>
                    <Hash config={config} value={p} kind="address" />
                  </div>
                ))}
              </dd>
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}

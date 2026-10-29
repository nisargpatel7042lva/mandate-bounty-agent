"use client";

import type { BountyDto } from "@mba/shared";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ClaimPanel } from "../../../components/ClaimPanel.tsx";
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

  if (!cfg.ok) return <p className="notice err">Configuration error: {cfg.error}</p>;
  if (error) return <p className="notice err">Could not load bounty #{id}: {error}</p>;
  if (!bounty) return <p className="lede">Loading…</p>;

  const { config } = cfg;
  const budget = BigInt(bounty.mandate.totalBudget);
  const funded = BigInt(bounty.funded);
  const pct = budget > 0n ? Number((funded * 10_000n) / budget) / 100 : 0;
  const expired = bounty.mandate.expiry * 1000 <= Date.now();
  const coversPayout = funded >= BigInt(bounty.payoutAmount);

  return (
    <>
      <h1>{bounty.title ?? `${bounty.repo}#${bounty.issueNumber}`}</h1>
      <p className="lede">
        <a href={`https://github.com/${bounty.repo}/issues/${bounty.issueNumber}`} target="_blank" rel="noreferrer">
          {bounty.repo}#{bounty.issueNumber}
        </a>{" "}
        · bounty #{bounty.id} ·{" "}
        {expired ? <span className="pill warn">mandate expired</span> : coversPayout ? <span className="pill ok">funded</span> : <span className="pill warn">underfunded</span>} ·{" "}
        <span className={`pill ${STATUS[bounty.status].tone}`} data-testid="status">
          {STATUS[bounty.status].label}
        </span>
      </p>

      <div className="card">
        <dl className="kv">
          <dt>Payout</dt>
          <dd>
            <strong>{formatUsdc(bounty.payoutAmount)}</strong>
          </dd>
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

      <h2>Mandate</h2>
      <div className="card">
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

      <h2>Acceptance criteria</h2>
      <div className="card" style={{ whiteSpace: "pre-wrap" }}>
        {bounty.acceptanceCriteria ?? <span className="lede">Not provided.</span>}
      </div>

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <h2>Delivered work</h2>
        {pending && (
          <button type="button" className="btn secondary" onClick={checkNow} disabled={checking}>
            {checking ? "Checking…" : "Check GitHub now"}
          </button>
        )}
      </div>
      {checkError && <p className="notice err">{checkError}</p>}
      <ClaimPanel bounty={bounty} />

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
    </>
  );
}

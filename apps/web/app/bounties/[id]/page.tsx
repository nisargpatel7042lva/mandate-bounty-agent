"use client";

import type { BountyDto } from "@mba/shared";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useConfig } from "../../../components/use-config.ts";
import { agentApi } from "../../../lib/api.ts";
import { addressUrl, txUrl, type WebConfig } from "../../../lib/config.ts";
import { formatExpiry, formatUsdc, shortAddress } from "../../../lib/format.ts";

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

export default function BountyDetailPage() {
  const cfg = useConfig();
  const { id } = useParams<{ id: string }>();
  const [bounty, setBounty] = useState<BountyDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cfg.ok) return;
    agentApi(cfg.config.agentUrl)
      .get(Number(id))
      .then(setBounty)
      .catch((e: Error) => setError(e.message));
  }, [cfg, id]);

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
        {expired ? <span className="pill warn">mandate expired</span> : coversPayout ? <span className="pill ok">funded</span> : <span className="pill warn">underfunded</span>}
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

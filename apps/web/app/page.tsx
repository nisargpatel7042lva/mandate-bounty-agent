"use client";

import type { BountyDto } from "@mba/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useConfig } from "../components/use-config.ts";
import { agentApi } from "../lib/api.ts";
import { formatUsdc } from "../lib/format.ts";
import { STATUS } from "../lib/status.ts";

export default function BountyListPage() {
  const cfg = useConfig();
  const [bounties, setBounties] = useState<BountyDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cfg.ok) return;
    agentApi(cfg.config.agentUrl)
      .list()
      .then(setBounties)
      .catch((e: Error) => setError(`Could not reach the agent: ${e.message}`));
  }, [cfg]);

  if (!cfg.ok) return <p className="notice err">Configuration error: {cfg.error}</p>;

  return (
    <>
      <h1>Bounties</h1>
      <p className="lede">Funded bounties and the mandate each payout must stay inside.</p>
      {error && <p className="notice err">{error}</p>}
      {!error && bounties === null && <p className="lede">Loading…</p>}
      {bounties?.length === 0 && (
        <div className="card empty">
          No bounties yet. <Link href="/bounties/new">Create the first one</Link>.
        </div>
      )}
      {bounties && bounties.length > 0 && (
        <ul className="list" aria-label="Bounties">
          {bounties.map((b) => (
            <li key={b.id}>
              <Link href={`/bounties/${b.id}`} className="card row">
                <span className="row-title">{b.title ?? `${b.repo}#${b.issueNumber}`}</span>
                <span className="row-amount">{formatUsdc(b.payoutAmount)}</span>
                <span className="row-meta">
                  {b.repo} · issue #{b.issueNumber}
                </span>
                <span className="row-meta">
                  funded {formatUsdc(b.funded)} · {STATUS[b.status].label}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

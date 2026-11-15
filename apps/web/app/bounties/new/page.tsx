"use client";

import { CreateBountyForm } from "../../../components/CreateBountyForm.tsx";
import { useConfig } from "../../../components/use-config.ts";

export default function NewBountyPage() {
  const cfg = useConfig();
  return (
    <div className="page shell">
      <header className="nb-head">
        <div>
          <span className="label seal">New bounty</span>
          <h1 style={{ marginTop: 18 }}>
            Set the rules. <span className="it">Then let go.</span>
          </h1>
        </div>
        <p>
          Set the payout and the mandate it must stay inside. The vault enforces the mandate on-chain. The agent can recommend a payout
          but can never exceed it.
        </p>
      </header>
      {cfg.ok ? (
        <div className="nb-form">
          <CreateBountyForm config={cfg.config} />
        </div>
      ) : (
        <p className="notice err">Configuration error: {cfg.error}</p>
      )}
    </div>
  );
}

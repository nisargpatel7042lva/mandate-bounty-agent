"use client";

import { CreateBountyForm } from "../../../components/CreateBountyForm.tsx";
import { useConfig } from "../../../components/use-config.ts";

export default function NewBountyPage() {
  const cfg = useConfig();
  if (!cfg.ok) return <p className="notice err">Configuration error: {cfg.error}</p>;
  return (
    <>
      <h1>New bounty</h1>
      <p className="lede">
        Set the payout and the mandate it must stay inside. The vault enforces the mandate on-chain. The agent can
        recommend a payout but can never exceed it.
      </p>
      <CreateBountyForm config={cfg.config} />
    </>
  );
}

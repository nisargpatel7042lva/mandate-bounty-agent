"use client";

import { bountyVaultAbi } from "@mba/contracts";
import type { BountyDto } from "@mba/shared";
import Link from "next/link";
import { useState } from "react";
import { txUrl, type WebConfig } from "../lib/config.ts";
import { formatUsdc, shortAddress } from "../lib/format.ts";
import { MANDATE_REASON } from "../lib/status.ts";
import { clients, connectWallet } from "../lib/wallet.ts";

const whenS = (s: number) => new Date(s * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";

/** The mandate proof (zkVerify), the review hold, and the vault payout. */
export function MandatePayoutPanel({ bounty, config, onChange }: { bounty: BountyDto; config: WebConfig; onChange: () => void }) {
  const m = bounty.mandateProof;
  const p = bounty.payout;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      const account = await connectWallet(config);
      const { wallet, reader } = clients(config, account);
      const hash = await wallet.writeContract({ address: bounty.vault as `0x${string}`, abi: bountyVaultAbi, functionName: "approveDespiteReview", args: [BigInt(bounty.id)] });
      await reader.waitForTransactionReceipt({ hash });
      onChange();
    } catch (e) {
      const err = e as { shortMessage?: string; message?: string };
      setError(err.shortMessage ?? err.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2>Mandate proof (zkVerify)</h2>
      <div className="card" data-testid="mandate-proof">
        {!m ? (
          <p style={{ margin: 0 }} className="lede">
            Not yet. After the merge is proven, the agent proves the payout fits the mandate and has zkVerify verify it.
          </p>
        ) : m.state === "rejected" || m.state === "failed" ? (
          <>
            <p className="notice err" style={{ marginTop: 0 }}>
              No payout: {m.reasons.map((r) => MANDATE_REASON[r] ?? r).join(" ")}
            </p>
            <p className="row-meta" style={{ marginBottom: 0 }}>
              Reason codes: <span className="mono">{m.reasons.join(", ")}</span>
              {m.error ? ` · ${m.error}` : ""}
            </p>
          </>
        ) : (
          <dl className="kv">
            <dt>Proves</dt>
            <dd>
              Paying {formatUsdc(bounty.payoutAmount)} to the proven payee is within the per-payout cap and the remaining budget, the payee is on
              the allowlist, and the mandate had not expired, against the funder&apos;s on-chain mandate commitment, for this bounty and this
              proven PR. Groth16 proof, verified by zkVerify.
            </dd>
            <dt>Checked at</dt>
            <dd>{m.checkedAt ? whenS(m.checkedAt) : "-"}</dd>
            <dt>zkVerify</dt>
            <dd data-testid="zkverify-status">
              {m.zkVerify.status ?? (m.state === "proved" ? "proof ready, not submitted yet" : "-")}
              {m.zkVerify.txUrl && (
                <>
                  {" "}
                  ·{" "}
                  <a href={m.zkVerify.txUrl} target="_blank" rel="noreferrer">
                    verification tx
                  </a>
                </>
              )}
            </dd>
            {m.zkVerify.aggregationId !== null && (
              <>
                <dt>Aggregation</dt>
                <dd className="mono">
                  #{m.zkVerify.aggregationId} (domain {m.zkVerify.domainId ?? 0}) · leaf {m.zkVerify.statement ? shortAddress(m.zkVerify.statement) : "-"}
                </dd>
              </>
            )}
            <dt>Commitment</dt>
            <dd className="mono">{m.commitment ? shortAddress(m.commitment) : "-"}</dd>
          </dl>
        )}
      </div>

      <h2>Payout</h2>
      <div className="card" data-testid="payout">
        {bounty.status === "held_for_funder" ? (
          <>
            <p className="notice warn" style={{ marginTop: 0 }}>
              Held: the advisory review did not recommend approval. The proofs are in place; the funder decides. Nothing is paid unless the
              funder approves on-chain.
            </p>
            <button type="button" className="btn" onClick={approve} disabled={busy}>
              {busy ? "Approving…" : "Approve payout anyway (funder)"}
            </button>
            {error && <p className="notice err">{error}</p>}
          </>
        ) : p ? (
          <dl className="kv">
            <dt>State</dt>
            <dd data-testid="payout-state">{p.state}</dd>
            <dt>Paid to</dt>
            <dd className="mono">{p.payee}</dd>
            <dt>Amount</dt>
            <dd>{formatUsdc(p.amount)}</dd>
            {p.txHash && (
              <>
                <dt>Transaction</dt>
                <dd>{txUrl(config, p.txHash) ? <a href={txUrl(config, p.txHash) ?? ""} target="_blank" rel="noreferrer" className="mono">{shortAddress(p.txHash)}</a> : <span className="mono">{p.txHash}</span>}</dd>
              </>
            )}
            {p.error && (
              <>
                <dt>Error</dt>
                <dd>{p.error}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="lede" style={{ margin: 0 }}>
            {bounty.status === "payout_failed" ? bounty.statusReason : "Not paid yet. The vault pays only after zkVerify verifies the mandate proof."}
          </p>
        )}
        {bounty.status === "paid" && (
          <p style={{ marginBottom: 0 }}>
            <Link href={`/receipts/${bounty.id}`} className="btn secondary" data-testid="receipt-link">
              Public receipt
            </Link>
          </p>
        )}
      </div>
    </>
  );
}

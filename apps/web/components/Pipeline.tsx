import type { BountyStatus } from "@mba/shared";

const STAGES = [
  { key: "fund", label: "Funded", sub: "Mandate on-chain" },
  { key: "merge", label: "PR merged", sub: "Claim detected" },
  { key: "review", label: "Reviewed", sub: "LLM · advice only" },
  { key: "zktls", label: "Merge proven", sub: "zkTLS · Reclaim" },
  { key: "mandate", label: "Mandate proven", sub: "Groth16 · zkVerify" },
  { key: "paid", label: "Paid", sub: "Vault checked proofs" },
] as const;

/** Index of the stage the bounty is at, and how that stage is going. */
function position(s: BountyStatus): { at: number; state: "current" | "hold" | "fail" | "paid" } {
  switch (s) {
    case "open": return { at: 1, state: "current" };
    case "claimed": return { at: 2, state: "current" };
    case "review_failed": return { at: 2, state: "fail" };
    case "reviewed": return { at: 3, state: "current" };
    case "work_proof_failed": return { at: 3, state: "fail" };
    case "work_proven": return { at: 4, state: "current" };
    case "mandate_rejected": return { at: 4, state: "fail" };
    case "mandate_proven": return { at: 5, state: "current" };
    case "held_for_funder": return { at: 5, state: "hold" };
    case "payout_failed": return { at: 5, state: "fail" };
    case "paid": return { at: 5, state: "paid" };
  }
}

/** Six-stage rail: where this bounty is between funding and payment. */
export function Pipeline({ status }: { status: BountyStatus }) {
  const { at, state } = position(status);
  return (
    <ol className="rail" aria-label="Payout pipeline">
      {STAGES.map((s, i) => {
        const cls = i < at ? "done" : i === at ? state : "";
        return (
          <li key={s.key} className={cls} aria-current={i === at ? "step" : undefined}>
            <b>{s.label}</b>
            <small>{i === at && state === "hold" ? "Held for funder" : i === at && state === "fail" ? "Stopped here" : s.sub}</small>
          </li>
        );
      })}
    </ol>
  );
}

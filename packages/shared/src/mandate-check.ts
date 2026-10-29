import type { Mandate } from "./schemas.ts";

export type MandateViolation =
  | "AMOUNT_ZERO"
  | "EXCEEDS_PER_PAYOUT_CAP"
  | "EXCEEDS_TOTAL_BUDGET"
  | "PAYEE_NOT_ALLOWLISTED"
  | "MANDATE_EXPIRED";

export interface PayoutRequest {
  amount: bigint;
  payee: `0x${string}`;
  /** Sum of payouts already released under this mandate. */
  spentSoFar: bigint;
  /** Unix seconds at evaluation time. */
  now: number;
}

/**
 * Reference semantics for mandate compliance. The circuit and BountyVault must
 * agree with this function on every test vector. Checks run in the same order as
 * Mandate's underwriting checks, and every violation is reported, not just the first.
 */
export function checkMandate(mandate: Mandate, req: PayoutRequest): { ok: boolean; violations: MandateViolation[] } {
  const violations: MandateViolation[] = [];
  if (req.amount === 0n) violations.push("AMOUNT_ZERO");
  if (req.amount > mandate.perPayoutCap) violations.push("EXCEEDS_PER_PAYOUT_CAP");
  if (req.spentSoFar + req.amount > mandate.totalBudget) violations.push("EXCEEDS_TOTAL_BUDGET");
  if (!mandate.allowedPayees.includes(req.payee.toLowerCase() as `0x${string}`)) violations.push("PAYEE_NOT_ALLOWLISTED");
  if (req.now >= mandate.expiry) violations.push("MANDATE_EXPIRED");
  return { ok: violations.length === 0, violations };
}

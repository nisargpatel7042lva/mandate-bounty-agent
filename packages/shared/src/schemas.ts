import { z } from "zod";

/** Token amounts are base units (test USDC has 6 decimals), carried as decimal strings. */
export const Amount = z
  .string()
  .regex(/^\d+$/, "amount must be a non-negative integer string")
  .transform((s) => BigInt(s));

export const EvmAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x-prefixed 20-byte hex address")
  .transform((s) => s.toLowerCase() as `0x${string}`);

/**
 * The funder's spending mandate for one bounty. Field shape follows Mandate's
 * PermissionScope (per-position cap, budget, expiry), with the protocol bitmask
 * replaced by an explicit payee allowlist.
 */
export const MandateSchema = z.object({
  perPayoutCap: Amount,
  totalBudget: Amount,
  allowedPayees: z.array(EvmAddress).min(1),
  /** Unix seconds; payouts at or after this instant are rejected. */
  expiry: z.number().int().positive(),
});
export type Mandate = z.infer<typeof MandateSchema>;

export const BountySchema = z.object({
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, "repo must be owner/name"),
  issueNumber: z.number().int().positive(),
  payoutAmount: Amount,
  mandate: MandateSchema,
});
export type Bounty = z.infer<typeof BountySchema>;

/** Advisory only. The LLM's verdict never authorizes a payout on its own. */
export const ReviewVerdictSchema = z.object({
  recommendation: z.enum(["approve", "reject", "needs_human"]),
  criteriaMet: z.array(z.object({ criterion: z.string(), met: z.boolean(), evidence: z.string() })),
  summary: z.string().max(2000),
  confidence: z.number().min(0).max(1),
});
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;

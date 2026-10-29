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
/** Matches BountyVault.MAX_PAYEES. */
export const MAX_PAYEES = 16;

export const MandateSchema = z
  .object({
    perPayoutCap: Amount,
    totalBudget: Amount,
    allowedPayees: z.array(EvmAddress).min(1).max(MAX_PAYEES),
    /** Unix seconds; payouts at or after this instant are rejected. */
    expiry: z.number().int().positive(),
  })
  .superRefine((m, ctx) => {
    if (m.perPayoutCap > m.totalBudget) {
      ctx.addIssue({ code: "custom", path: ["perPayoutCap"], message: "per-payout cap cannot exceed the total budget" });
    }
    if (new Set(m.allowedPayees).size !== m.allowedPayees.length) {
      ctx.addIssue({ code: "custom", path: ["allowedPayees"], message: "payees must be unique" });
    }
    if (m.allowedPayees.includes("0x0000000000000000000000000000000000000000")) {
      ctx.addIssue({ code: "custom", path: ["allowedPayees"], message: "the zero address cannot be a payee" });
    }
  });
export type Mandate = z.infer<typeof MandateSchema>;

/** Same invariants BountyVault.createBounty enforces, so the form fails before the wallet prompt. */
export const BountySchema = z
  .object({
    repo: z.string().max(140).regex(/^[\w.-]+\/[\w.-]+$/, "repo must be owner/name"),
    issueNumber: z.number().int().positive(),
    payoutAmount: Amount,
    mandate: MandateSchema,
  })
  .superRefine((b, ctx) => {
    if (b.payoutAmount === 0n) ctx.addIssue({ code: "custom", path: ["payoutAmount"], message: "payout must be greater than zero" });
    if (b.payoutAmount > b.mandate.perPayoutCap) {
      ctx.addIssue({ code: "custom", path: ["payoutAmount"], message: "payout cannot exceed the per-payout cap" });
    }
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

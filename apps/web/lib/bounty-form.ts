import { BountySchema, type Bounty } from "@mba/shared";
import { parseUsdc } from "./format.ts";

export interface BountyFormValues {
  repo: string;
  issueNumber: string;
  title: string;
  acceptanceCriteria: string;
  payoutAmount: string;
  perPayoutCap: string;
  totalBudget: string;
  fundAmount: string;
  expiryDays: string;
  payees: string;
}

export type FieldErrors = Partial<Record<keyof BountyFormValues, string>>;

export interface ParsedBountyForm {
  bounty: Bounty;
  fundAmount: bigint;
  title: string;
  acceptanceCriteria: string;
}

const MAP: Record<string, keyof BountyFormValues> = {
  repo: "repo",
  issueNumber: "issueNumber",
  payoutAmount: "payoutAmount",
  "mandate.perPayoutCap": "perPayoutCap",
  "mandate.totalBudget": "totalBudget",
  "mandate.expiry": "expiryDays",
  "mandate.allowedPayees": "payees",
};

/**
 * Turns raw form strings into a validated bounty using the shared BountySchema (the same rules
 * the vault enforces), plus the form-only rules for title, criteria and the funding amount.
 */
export function parseBountyForm(v: BountyFormValues, nowSeconds: number): { ok: true; value: ParsedBountyForm } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const usdc = (field: keyof BountyFormValues): bigint | undefined => {
    try {
      return parseUsdc(v[field]);
    } catch (e) {
      errors[field] = (e as Error).message;
      return undefined;
    }
  };

  const payoutAmount = usdc("payoutAmount");
  const perPayoutCap = usdc("perPayoutCap");
  const totalBudget = usdc("totalBudget");
  const fundAmount = usdc("fundAmount");

  const days = Number(v.expiryDays);
  if (!Number.isInteger(days) || days < 1 || days > 365) errors.expiryDays = "expiry must be 1 to 365 days";
  const issueNumber = Number(v.issueNumber);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) errors.issueNumber = "issue number must be a positive integer";

  if (v.title.trim().length < 3) errors.title = "title needs at least 3 characters";
  if (v.acceptanceCriteria.trim().length < 10) errors.acceptanceCriteria = "describe what counts as done (10+ characters)";

  const payees = v.payees.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);

  const parsed = BountySchema.safeParse({
    repo: v.repo.trim(),
    issueNumber,
    payoutAmount: (payoutAmount ?? 0n).toString(),
    mandate: {
      perPayoutCap: (perPayoutCap ?? 0n).toString(),
      totalBudget: (totalBudget ?? 0n).toString(),
      allowedPayees: payees,
      expiry: nowSeconds + days * 86_400,
    },
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = MAP[issue.path.slice(0, 2).join(".")] ?? MAP[String(issue.path[0])];
      if (field && !errors[field]) errors[field] = issue.message;
    }
  }

  if (fundAmount !== undefined && totalBudget !== undefined && !errors.fundAmount) {
    if (fundAmount === 0n) errors.fundAmount = "fund at least the payout amount";
    else if (fundAmount > totalBudget) errors.fundAmount = "funding cannot exceed the total budget";
    else if (payoutAmount !== undefined && fundAmount < payoutAmount) errors.fundAmount = "fund at least the payout amount";
  }

  if (Object.keys(errors).length > 0 || !parsed.success || fundAmount === undefined) return { ok: false, errors };
  return { ok: true, value: { bounty: parsed.data, fundAmount, title: v.title.trim(), acceptanceCriteria: v.acceptanceCriteria.trim() } };
}

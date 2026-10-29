import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MandateSchema, checkMandate, type MandateViolation } from "../src/index.ts";

// Same vectors as packages/contracts test_checkPayout_matchesSharedVectors.
const vectors = JSON.parse(readFileSync(new URL("../test-vectors/mandate.json", import.meta.url), "utf8")) as {
  cases: {
    name: string;
    cap: string;
    budget: string;
    spentSoFar: string;
    amount: string;
    payeeAllowed: boolean;
    secondsUntilExpiry: number;
    mask: number;
  }[];
};

const BITS: Record<MandateViolation, number> = {
  AMOUNT_ZERO: 1,
  EXCEEDS_PER_PAYOUT_CAP: 2,
  EXCEEDS_TOTAL_BUDGET: 4,
  PAYEE_NOT_ALLOWLISTED: 8,
  MANDATE_EXPIRED: 16,
};

const ALLOWED = "0x00000000000000000000000000000000000a11ce";
const OTHER = "0x000000000000000000000000000000000ba11e75";
const EXPIRY = 2_000_000_000;

describe("checkMandate agrees with shared vectors", () => {
  it.each(vectors.cases)("$name", (v) => {
    const mandate = MandateSchema.parse({
      perPayoutCap: v.cap,
      totalBudget: v.budget,
      allowedPayees: [ALLOWED],
      expiry: EXPIRY,
    });
    const { violations } = checkMandate(mandate, {
      amount: BigInt(v.amount),
      payee: v.payeeAllowed ? ALLOWED : OTHER,
      spentSoFar: BigInt(v.spentSoFar),
      now: EXPIRY - v.secondsUntilExpiry,
    });
    expect(violations.reduce((m, x) => m | BITS[x], 0)).toBe(v.mask);
  });
});

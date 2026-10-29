import { describe, expect, it } from "vitest";
import { MandateSchema, checkMandate } from "../src/index.js";

const ALICE = "0x00000000000000000000000000000000000a11ce";
const MALLORY = "0x000000000000000000000000000000000ba11e75";

const mandate = MandateSchema.parse({
  perPayoutCap: "500000000", // 500 USDC
  totalBudget: "1000000000", // 1000 USDC
  allowedPayees: [ALICE.toUpperCase().replace("0X", "0x")],
  expiry: 2_000_000_000,
});

const base = { amount: 500_000_000n, payee: ALICE, spentSoFar: 0n, now: 1_900_000_000 } as const;

describe("checkMandate", () => {
  it("accepts a payout inside every limit", () => {
    expect(checkMandate(mandate, base)).toEqual({ ok: true, violations: [] });
  });

  it("accepts spending exactly up to the budget", () => {
    expect(checkMandate(mandate, { ...base, spentSoFar: 500_000_000n }).ok).toBe(true);
  });

  it.each([
    ["zero amount", { amount: 0n }, "AMOUNT_ZERO"],
    ["amount over cap", { amount: 500_000_001n }, "EXCEEDS_PER_PAYOUT_CAP"],
    ["cumulative spend over budget", { spentSoFar: 500_000_001n }, "EXCEEDS_TOTAL_BUDGET"],
    ["payee not allowlisted", { payee: MALLORY }, "PAYEE_NOT_ALLOWLISTED"],
    ["at expiry", { now: 2_000_000_000 }, "MANDATE_EXPIRED"],
  ] as const)("rejects %s", (_name, override, violation) => {
    const result = checkMandate(mandate, { ...base, ...override });
    expect(result.ok).toBe(false);
    expect(result.violations).toContain(violation);
  });

  it("reports every violation, not only the first", () => {
    const result = checkMandate(mandate, { amount: 600_000_000n, payee: MALLORY, spentSoFar: 900_000_000n, now: 2_100_000_000 });
    expect(result.violations).toEqual(["EXCEEDS_PER_PAYOUT_CAP", "EXCEEDS_TOTAL_BUDGET", "PAYEE_NOT_ALLOWLISTED", "MANDATE_EXPIRED"]);
  });

  it("matches payees case-insensitively", () => {
    expect(checkMandate(mandate, { ...base, payee: ALICE.toUpperCase().replace("0X", "0x") as `0x${string}` }).ok).toBe(true);
  });
});

describe("MandateSchema", () => {
  it("rejects malformed payee addresses", () => {
    expect(() => MandateSchema.parse({ perPayoutCap: "1", totalBudget: "1", allowedPayees: ["0x123"], expiry: 1 })).toThrow();
  });

  it("rejects negative or decimal amounts", () => {
    expect(() => MandateSchema.parse({ perPayoutCap: "-1", totalBudget: "1", allowedPayees: [ALICE], expiry: 1 })).toThrow();
    expect(() => MandateSchema.parse({ perPayoutCap: "1.5", totalBudget: "1", allowedPayees: [ALICE], expiry: 1 })).toThrow();
  });
});

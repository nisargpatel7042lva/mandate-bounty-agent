import { describe, expect, it } from "vitest";
import { parseBountyForm, type BountyFormValues } from "../lib/bounty-form.ts";
import { formatExpiry, formatUsdc, parseUsdc } from "../lib/format.ts";

const NOW = 1_900_000_000;
const ALICE = "0x00000000000000000000000000000000000A11cE";

const ok: BountyFormValues = {
  repo: "acme/widgets",
  issueNumber: "42",
  title: "Fix widget overflow",
  acceptanceCriteria: "Widgets no longer overflow on mobile.",
  payoutAmount: "250",
  perPayoutCap: "500",
  totalBudget: "1000",
  fundAmount: "300.5",
  expiryDays: "30",
  payees: `${ALICE}\n`,
};

describe("parseBountyForm", () => {
  it("parses a valid form into base units and an absolute expiry", () => {
    const r = parseBountyForm(ok, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.bounty.payoutAmount).toBe(250_000_000n);
    expect(r.value.bounty.mandate.totalBudget).toBe(1_000_000_000n);
    expect(r.value.fundAmount).toBe(300_500_000n);
    expect(r.value.bounty.mandate.expiry).toBe(NOW + 30 * 86_400);
    expect(r.value.bounty.mandate.allowedPayees).toEqual([ALICE.toLowerCase()]);
  });

  it.each<[string, Partial<BountyFormValues>, keyof BountyFormValues]>([
    ["payout over cap", { payoutAmount: "501" }, "payoutAmount"],
    ["cap over budget", { perPayoutCap: "1001", payoutAmount: "1" }, "perPayoutCap"],
    ["funding over budget", { fundAmount: "1000.000001" }, "fundAmount"],
    ["funding below payout", { fundAmount: "10" }, "fundAmount"],
    ["too many decimals", { payoutAmount: "1.0000001" }, "payoutAmount"],
    ["no payees", { payees: "  " }, "payees"],
    ["bad payee", { payees: "0x123" }, "payees"],
    ["bad repo", { repo: "widgets" }, "repo"],
    ["bad issue", { issueNumber: "0" }, "issueNumber"],
    ["expiry too long", { expiryDays: "400" }, "expiryDays"],
    ["missing criteria", { acceptanceCriteria: "" }, "acceptanceCriteria"],
  ])("flags %s", (_n, patch, field) => {
    const r = parseBountyForm({ ...ok, ...patch }, NOW);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[field]).toBeTruthy();
  });

  it("accepts comma- or space-separated payees", () => {
    const r = parseBountyForm({ ...ok, payees: `${ALICE}, 0x000000000000000000000000000000000000bEEF` }, NOW);
    expect(r.ok && r.value.bounty.mandate.allowedPayees.length).toBe(2);
  });
});

describe("format helpers", () => {
  it("round-trips USDC amounts", () => {
    expect(parseUsdc("1234.5")).toBe(1_234_500_000n);
    expect(formatUsdc(1_234_500_000n)).toBe("1,234.5 tUSDC");
    expect(formatUsdc("1000000")).toBe("1 tUSDC");
  });

  it("marks past expiries", () => {
    expect(formatExpiry(1_000, 2_000_000)).toMatch(/expired/);
    expect(formatExpiry(2_000_000_000, 0)).not.toMatch(/expired/);
  });
});

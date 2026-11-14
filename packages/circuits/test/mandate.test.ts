import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as snarkjs from "snarkjs";
import { describe, expect, it } from "vitest";
import {
  allowlistSlots,
  ARTIFACTS,
  mandateCommitment,
  proveMandate,
  readPublicSignals,
  splitClaimId,
  verifyMandateProof,
  type MandateParams,
  type MandateReason,
  type PayoutRequest,
} from "../src/mandate.ts";

const ALLOWED = "0x1890d4b70874e92530faa5cf1599f4c2f01aefe2";
const OTHER = "0x000000000000000000000000000000000ba11e75";
const CLAIM = "0x1f0e5c3b7a9d2e4f6081a3c5e7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5";
const EXPIRY = 2_000_000_000;

const mandate: MandateParams = { bountyId: 2, perPayoutCap: 500_000_000n, totalBudget: 1_000_000_000n, expiry: EXPIRY, allowedPayees: [ALLOWED] };
const ok: PayoutRequest = { amount: 250_000_000n, payee: ALLOWED, spent: 0n, now: EXPIRY - 3600, claimId: CLAIM };

/** Witness input that skips the JS pre-check, to show the circuit itself refuses bad payouts. */
async function rawInput(over: Partial<Record<string, string | string[]>> = {}, m: MandateParams = mandate) {
  const [hi, lo] = splitClaimId(CLAIM);
  return {
    mandateCommitment: (await mandateCommitment(m)).toString(),
    bountyId: String(m.bountyId),
    amount: "250000000",
    payee: BigInt(ALLOWED).toString(),
    spent: "0",
    now: String(EXPIRY - 3600),
    claimHi: hi.toString(),
    claimLo: lo.toString(),
    perPayoutCap: m.perPayoutCap.toString(),
    totalBudget: m.totalBudget.toString(),
    expiry: String(m.expiry),
    allowed: allowlistSlots(m.allowedPayees).map(String),
    ...over,
  };
}

const fullProve = async (input: Record<string, unknown>) => snarkjs.groth16.fullProve(input, ARTIFACTS.wasm, ARTIFACTS.zkey);

describe("artifacts", () => {
  it("were generated from the current circuit source (re-run setup and re-register the key if this fails)", () => {
    const manifest = JSON.parse(readFileSync(ARTIFACTS.manifest, "utf8")) as { sourceSha256: string; publicInputs: number; ceremony: string };
    const source = createHash("sha256").update(readFileSync(new URL("../circuits/mandate.circom", import.meta.url))).digest("hex");
    expect(manifest.sourceSha256).toBe(source);
    expect(manifest.publicInputs).toBe(8);
    expect(manifest.ceremony).toMatch(/NOT production-grade/);
  });
});

describe("valid payout", () => {
  it("proves and verifies, exposing exactly the intended public inputs", async () => {
    const r = await proveMandate(mandate, ok);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await verifyMandateProof(r.proof)).toBe(true);
    const pub = readPublicSignals(r.proof.publicSignals);
    const [hi, lo] = splitClaimId(CLAIM);
    expect(pub).toEqual({ mandateCommitment: r.commitment, bountyId: 2n, amount: 250_000_000n, payee: BigInt(ALLOWED), spent: 0n, now: BigInt(EXPIRY - 3600), claimHi: hi, claimLo: lo });
  }, 60_000);

  it("accepts spending exactly up to the budget and a payee in any slot", async () => {
    const m = { ...mandate, allowedPayees: [OTHER, "0x0000000000000000000000000000000000000abc", ALLOWED] };
    const r = await proveMandate(m, { ...ok, amount: 500_000_000n, spent: 500_000_000n });
    expect(r.ok && (await verifyMandateProof(r.proof))).toBe(true);
  }, 60_000);
});

describe("shared mandate vectors", () => {
  const vectors = JSON.parse(readFileSync(new URL("../../shared/test-vectors/mandate.json", import.meta.url), "utf8")) as {
    cases: { name: string; cap: string; budget: string; spentSoFar: string; amount: string; payeeAllowed: boolean; secondsUntilExpiry: number; mask: number }[];
  };
  const BITS: [number, MandateReason][] = [
    [1, "ZERO_AMOUNT"],
    [2, "OVER_CAP"],
    [4, "OVER_BUDGET"],
    [8, "PAYEE_NOT_ALLOWED"],
    [16, "EXPIRED"],
  ];

  it.each(vectors.cases)("$name", async (v) => {
    const m = { ...mandate, perPayoutCap: BigInt(v.cap), totalBudget: BigInt(v.budget) };
    const r = await proveMandate(m, { ...ok, amount: BigInt(v.amount), spent: BigInt(v.spentSoFar), payee: v.payeeAllowed ? ALLOWED : OTHER, now: EXPIRY - v.secondsUntilExpiry });
    if (v.mask === 0) {
      expect(r.ok && (await verifyMandateProof(r.proof))).toBe(true);
    } else {
      expect(r).toEqual({ ok: false, reasons: BITS.filter(([b]) => v.mask & b).map(([, code]) => code) });
    }
  }, 60_000);
});

describe("the circuit itself refuses a non-compliant payout", () => {
  it.each([
    ["amount over the cap", { amount: "500000001" }],
    ["spend over the budget", { spent: "800000000" }],
    ["a payee not on the allowlist", { payee: BigInt(OTHER).toString() }],
    ["the zero address as payee", { payee: "0" }],
    ["an expired mandate", { now: String(EXPIRY) }],
    ["a zero amount", { amount: "0" }],
    ["a commitment to a different mandate", { mandateCommitment: "12345" }],
  ])("%s", async (_n, over) => {
    await expect(fullProve(await rawInput(over))).rejects.toThrow();
  }, 60_000);
});

describe("tampering with public inputs", () => {
  it.each([
    ["amount", 2, "250000001"],
    ["payee", 3, BigInt(OTHER).toString()],
    ["spent", 4, "1"],
    ["claim identifier (low half)", 7, "1"],
    ["claim identifier (high half)", 6, "1"],
    ["bounty id", 1, "3"],
  ])("breaks verification when the %s is changed", async (_n, index, value) => {
    const r = await proveMandate(mandate, ok);
    if (!r.ok) throw new Error("expected a proof");
    const publicSignals = [...r.proof.publicSignals];
    publicSignals[index] = value;
    expect(await verifyMandateProof({ proof: r.proof.proof, publicSignals })).toBe(false);
  }, 60_000);
});

describe("commitment", () => {
  it("changes with every mandate field and with the allowlist", async () => {
    const base = await mandateCommitment(mandate);
    const variants = [
      { ...mandate, perPayoutCap: 1n },
      { ...mandate, totalBudget: 1n },
      { ...mandate, expiry: EXPIRY + 1 },
      { ...mandate, allowedPayees: [OTHER] },
      { ...mandate, allowedPayees: [ALLOWED, OTHER] },
    ];
    for (const v of variants) expect(await mandateCommitment(v)).not.toBe(base);
    expect(await mandateCommitment({ ...mandate, allowedPayees: [ALLOWED.toUpperCase().replace("0X", "0x")] })).toBe(base);
  });

  it("rejects more than 16 payees and malformed claim ids", () => {
    expect(() => allowlistSlots(Array.from({ length: 17 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}`))).toThrow();
    expect(() => splitClaimId("0x1234")).toThrow();
  });
});

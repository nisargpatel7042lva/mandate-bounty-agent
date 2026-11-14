/// <reference path="./vendor.d.ts" />
import { buildPoseidon, type Poseidon } from "circomlibjs";
import { checkMandate, type MandateViolation } from "@mba/shared";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import * as snarkjs from "snarkjs";

/** Allowlist slots in the circuit (MandateCompliance(16)); matches BountyVault.MAX_PAYEES. */
export const ALLOWLIST_SLOTS = 16;

const artifacts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../artifacts");
export const ARTIFACTS = {
  wasm: path.join(artifacts, "mandate.wasm"),
  zkey: path.join(artifacts, "mandate.zkey"),
  vkey: path.join(artifacts, "mandate.vkey.json"),
  manifest: path.join(artifacts, "manifest.json"),
};

export interface MandateParams {
  bountyId: number | bigint;
  perPayoutCap: bigint;
  totalBudget: bigint;
  /** Unix seconds. */
  expiry: number | bigint;
  allowedPayees: string[];
}

export interface PayoutRequest {
  amount: bigint;
  payee: `0x${string}`;
  /** Cumulative spend before this payout, as recorded on-chain. */
  spent: bigint;
  /** Unix seconds of the check. */
  now: number | bigint;
  /** zkTLS claim identifier (0x + 64 hex) of the proven merged PR. */
  claimId: string;
}

/** Spec reason codes for a mandate rejection. */
export type MandateReason = "ZERO_AMOUNT" | "OVER_CAP" | "OVER_BUDGET" | "PAYEE_NOT_ALLOWED" | "EXPIRED";

const REASON: Record<MandateViolation, MandateReason> = {
  AMOUNT_ZERO: "ZERO_AMOUNT",
  EXCEEDS_PER_PAYOUT_CAP: "OVER_CAP",
  EXCEEDS_TOTAL_BUDGET: "OVER_BUDGET",
  PAYEE_NOT_ALLOWLISTED: "PAYEE_NOT_ALLOWED",
  MANDATE_EXPIRED: "EXPIRED",
};
export const toReasonCodes = (v: MandateViolation[]): MandateReason[] => v.map((x) => REASON[x]);

let poseidonP: Promise<Poseidon> | undefined;
const poseidon = () => (poseidonP ??= buildPoseidon());

const addr = (a: string) => BigInt(a.toLowerCase());

/** Allowlist padded with zeros to the circuit's slot count. */
export function allowlistSlots(payees: string[]): bigint[] {
  if (payees.length > ALLOWLIST_SLOTS) throw new Error(`at most ${ALLOWLIST_SLOTS} payees`);
  return [...payees.map(addr), ...Array<bigint>(ALLOWLIST_SLOTS - payees.length).fill(0n)];
}

/**
 * The mandate commitment the funder publishes at bounty creation:
 * Poseidon(cap, budget, expiry, h16) with h0 = 0, h(i+1) = Poseidon(h(i), slot(i)).
 * It does not include the bounty id (unknown until the creation tx is mined); the vault stores it per
 * bounty and checks the proof's separate bountyId input.
 */
export async function mandateCommitment(m: Omit<MandateParams, "bountyId">): Promise<bigint> {
  const p = await poseidon();
  let h = 0n;
  for (const slot of allowlistSlots(m.allowedPayees)) h = p.F.toObject(p([h, slot]));
  return p.F.toObject(p([m.perPayoutCap, m.totalBudget, BigInt(m.expiry), h]));
}

/** Splits a 32-byte claim identifier into two 128-bit field elements (high, low). */
export function splitClaimId(claimId: string): [bigint, bigint] {
  if (!/^0x[0-9a-fA-F]{64}$/.test(claimId)) throw new Error("claim id must be 0x + 64 hex");
  const v = BigInt(claimId);
  return [v >> 128n, v & ((1n << 128n) - 1n)];
}

/** Public signal order, as declared in mandate.circom. */
export const PUBLIC_SIGNALS = ["mandateCommitment", "bountyId", "amount", "payee", "spent", "now", "claimHi", "claimLo"] as const;

export interface MandateProof {
  proof: snarkjs.Groth16Proof;
  publicSignals: string[];
}

export type ProveResult = { ok: true; proof: MandateProof; commitment: bigint } | { ok: false; reasons: MandateReason[] };

/**
 * Checks the payout against the mandate (same rules as the circuit). If it complies, generates a
 * Groth16 proof; if not, returns the reason codes without trying (the circuit could not be satisfied).
 */
export async function proveMandate(m: MandateParams, req: PayoutRequest): Promise<ProveResult> {
  const { violations } = checkMandate(
    { perPayoutCap: m.perPayoutCap, totalBudget: m.totalBudget, expiry: Number(m.expiry), allowedPayees: m.allowedPayees.map((a) => a.toLowerCase() as `0x${string}`) },
    { amount: req.amount, payee: req.payee, spentSoFar: req.spent, now: Number(req.now) },
  );
  if (violations.length > 0) return { ok: false, reasons: toReasonCodes(violations) };

  const commitment = await mandateCommitment(m);
  const [claimHi, claimLo] = splitClaimId(req.claimId);
  const input = {
    mandateCommitment: commitment.toString(),
    bountyId: BigInt(m.bountyId).toString(),
    amount: req.amount.toString(),
    payee: addr(req.payee).toString(),
    spent: req.spent.toString(),
    now: BigInt(req.now).toString(),
    claimHi: claimHi.toString(),
    claimLo: claimLo.toString(),
    perPayoutCap: m.perPayoutCap.toString(),
    totalBudget: m.totalBudget.toString(),
    expiry: BigInt(m.expiry).toString(),
    allowed: allowlistSlots(m.allowedPayees).map(String),
  };
  const proof = await snarkjs.groth16.fullProve(input, ARTIFACTS.wasm, ARTIFACTS.zkey);
  return { ok: true, proof, commitment };
}

let vkey: unknown;
export function verificationKey(): unknown {
  return (vkey ??= JSON.parse(readFileSync(ARTIFACTS.vkey, "utf8")));
}

/** Local Groth16 verification against the committed verification key. */
export function verifyMandateProof(p: MandateProof): Promise<boolean> {
  return snarkjs.groth16.verify(verificationKey(), p.publicSignals, p.proof);
}

/** Named view of a proof's public signals. */
export function readPublicSignals(publicSignals: string[]): Record<(typeof PUBLIC_SIGNALS)[number], bigint> {
  return Object.fromEntries(PUBLIC_SIGNALS.map((name, i) => [name, BigInt(publicSignals[i] ?? "0")])) as Record<(typeof PUBLIC_SIGNALS)[number], bigint>;
}

/** The commitment as the bytes32 hex the vault stores (Mandate.commitment). */
export async function mandateCommitmentHex(m: Omit<MandateParams, "bountyId">): Promise<`0x${string}`> {
  return `0x${(await mandateCommitment(m)).toString(16).padStart(64, "0")}`;
}

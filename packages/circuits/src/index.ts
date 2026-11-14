/** Mandate compliance circuit (Circom + Groth16 on BN254, snarkjs). */
export const PROOF_SYSTEM = { system: "groth16", curve: "bn254", library: "snarkjs" } as const;

export * from "./mandate.ts";

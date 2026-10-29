/** Mandate compliance circuit (Circom + Groth16 on BN254). Phase 5 fills this in. */
export const PROOF_SYSTEM = { system: "groth16", curve: "bn254", library: "snarkjs" } as const;

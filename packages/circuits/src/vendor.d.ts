// Minimal typings for the parts of snarkjs and circomlibjs this package uses (neither ships types).
declare module "snarkjs" {
  export interface Groth16Proof {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    protocol: string;
    curve: string;
  }
  export const groth16: {
    fullProve(input: Record<string, unknown>, wasmFile: string, zkeyFile: string): Promise<{ proof: Groth16Proof; publicSignals: string[] }>;
    verify(vkey: unknown, publicSignals: string[], proof: Groth16Proof): Promise<boolean>;
  };
  export const powersOfTau: Record<string, (...args: unknown[]) => Promise<unknown>>;
  export const zKey: Record<string, (...args: unknown[]) => Promise<unknown>>;
  export const r1cs: { info(file: string): Promise<{ nConstraints: number; nPubInputs: number }> };
  export const curves: { getCurveFromName(name: string): Promise<unknown> };
}

declare module "circomlibjs" {
  export interface Poseidon {
    (inputs: (bigint | number | string)[]): Uint8Array;
    F: { toObject(x: Uint8Array): bigint };
  }
  export function buildPoseidon(): Promise<Poseidon>;
}

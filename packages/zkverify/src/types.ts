/** snarkjs Groth16 proof JSON, as Kurier accepts it for library "snarkjs". */
export interface Groth16Proof {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol: string;
  curve: string;
}

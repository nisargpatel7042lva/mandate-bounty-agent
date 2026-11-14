// The aggregation leaf ("statement") zkVerify computes for a Groth16 proof, which an EVM contract
// rebuilds and checks with verifyProofAggregation. From the zkVerify docs (smart-contract tutorial
// and Groth16 pallet): leaf = keccak256(PROVING_SYSTEM_ID ‖ vkHash ‖ VERSION_HASH ‖ keccak256(pubs)),
// where pubs is each public input as 32 bytes little-endian, concatenated.
// BountyVault._statementLeaf implements the same formula; a shared test vector keeps them equal.
import { concat, keccak256, sha256, toBytes, toHex, type Hex } from "viem";

export const PROVING_SYSTEM_ID: Hex = keccak256(toBytes("groth16"));
/** Groth16 has no prover version, so the version hash is sha256 of the empty string. */
export const VERSION_HASH: Hex = sha256(new Uint8Array());

/** A field element as 32 little-endian bytes (zkVerify's scalar encoding). */
export function scalarLE(x: bigint | string): Uint8Array {
  const be = toBytes(toHex(BigInt(x), { size: 32 }));
  return be.reverse();
}

export function pubsHash(publicSignals: (bigint | string)[]): Hex {
  return keccak256(concat(publicSignals.map(scalarLE)));
}

export function statementLeaf(vkHash: Hex, publicSignals: (bigint | string)[]): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(vkHash)) throw new Error("vkHash must be 0x + 64 hex");
  return keccak256(concat([PROVING_SYSTEM_ID, vkHash, VERSION_HASH, pubsHash(publicSignals)]));
}

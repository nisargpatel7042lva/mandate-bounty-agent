import { verificationKey } from "@mba/circuits";
import { createKurierClient, type JobStatus } from "@mba/zkverify";
import { parseAbi, type Address, type Hex, type PublicClient } from "viem";
import type { ZkVerifier } from "./mandate-step.ts";

export interface KurierVerifierOptions {
  apiUrl: string;
  apiKey: string;
  /** EVM chain the aggregation is published to; set when the vault checks aggregation on-chain. */
  aggregationChainId?: number | undefined;
  domainId: number;
  /** When set, a proof counts as verified only once this contract confirms its aggregation. */
  aggregationCheck?: { client: Pick<PublicClient, "readContract">; address: Address } | undefined;
}

const aggregationAbi = parseAbi([
  "function verifyProofAggregation(uint256 domainId, uint256 aggregationId, bytes32 leaf, bytes32[] merklePath, uint256 leafCount, uint256 index) view returns (bool)",
]);

/**
 * zkVerify via Kurier. Registers the mandate circuit's verification key (idempotent) and returns the
 * verifier plus the vkHash, which must equal BountyVault.vkHash for on-chain checks to pass.
 */
export async function createKurierVerifier(opts: KurierVerifierOptions): Promise<{ verifier: ZkVerifier; vkHash: string }> {
  const kurier = createKurierClient({ apiUrl: opts.apiUrl, apiKey: opts.apiKey });
  const vkHash = await kurier.registerVk(verificationKey());
  // Kurier reports "Aggregated" with the Merkle details; on testnet it may never move on to
  // "AggregationPublished" even after the root is on the destination chain (seen 2026-11-14).
  const target: JobStatus = opts.aggregationChainId ? "Aggregated" : "Finalized";
  const check = opts.aggregationCheck;
  return {
    vkHash,
    verifier: {
      target,
      domainId: opts.domainId,
      submit: (proof) =>
        kurier.submitProof({ proof: proof.proof, publicSignals: proof.publicSignals, vkHash, ...(opts.aggregationChainId ? { chainId: opts.aggregationChainId } : {}) }),
      status: (jobId) => kurier.jobStatus(jobId),
      ...(check
        ? {
            published: async (state, domainId) => {
              const a = state.aggregationDetails;
              if (state.aggregationId === undefined || state.aggregationId === null || !a) return false;
              return check.client.readContract({
                address: check.address,
                abi: aggregationAbi,
                functionName: "verifyProofAggregation",
                args: [BigInt(domainId), BigInt(state.aggregationId), a.leaf as Hex, a.merkleProof as Hex[], BigInt(a.numberOfLeaves), BigInt(a.leafIndex)],
              });
            },
          }
        : {}),
    },
  };
}

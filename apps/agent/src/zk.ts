import { verificationKey } from "@mba/circuits";
import { createKurierClient, type JobStatus } from "@mba/zkverify";
import type { ZkVerifier } from "./mandate-step.ts";

export interface KurierVerifierOptions {
  apiUrl: string;
  apiKey: string;
  /** EVM chain the aggregation is published to; set when the vault checks aggregation on-chain. */
  aggregationChainId?: number | undefined;
  domainId: number;
}

/**
 * zkVerify via Kurier. Registers the mandate circuit's verification key (idempotent) and returns the
 * verifier plus the vkHash, which must equal BountyVault.vkHash for on-chain checks to pass.
 */
export async function createKurierVerifier(opts: KurierVerifierOptions): Promise<{ verifier: ZkVerifier; vkHash: string }> {
  const kurier = createKurierClient({ apiUrl: opts.apiUrl, apiKey: opts.apiKey });
  const vkHash = await kurier.registerVk(verificationKey());
  const target: JobStatus = opts.aggregationChainId ? "AggregationPublished" : "Finalized";
  return {
    vkHash,
    verifier: {
      target,
      domainId: opts.domainId,
      submit: (proof) =>
        kurier.submitProof({ proof: proof.proof, publicSignals: proof.publicSignals, vkHash, ...(opts.aggregationChainId ? { chainId: opts.aggregationChainId } : {}) }),
      status: (jobId) => kurier.jobStatus(jobId),
    },
  };
}

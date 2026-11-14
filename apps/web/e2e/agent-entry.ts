// Starts the real agent for E2E with two substitutions, both external networks:
//  - work proofs come from a local test attestor instead of Reclaim (the agent still verifies them
//    exactly as in production; only the trusted attestor differs);
//  - zkVerify is a local stand-in that "aggregates" a mandate proof by marking its statement leaf on
//    MockZkVerify, which the vault then checks on-chain like the real zkVerify contract.
// The Groth16 mandate proof, the vault release and the payment are all real.
import { loadEnv } from "@mba/agent/env";
import { startAgent } from "@mba/agent/main";
import { mockZkVerifyAbi } from "@mba/contracts";
import { statementLeaf, type JobState } from "@mba/zkverify";
import { localAttestorAddress, signLocalClaim } from "@mba/zktls/testing";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { E2E_MERGED_AT, E2E_PAYEE, E2E_PR_AUTHOR } from "./stubs.ts";

const ATTESTOR_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // anvil dev key 1
const env = loadEnv();
const zkVerify = process.env.E2E_ZKVERIFY_ADDRESS as Hex;
const vkHash = process.env.E2E_VK_HASH as Hex;
const transport = http(env.RPC_URL);
const reader = createPublicClient({ chain: foundry, transport });
const marker = createWalletClient({ chain: foundry, transport, account: privateKeyToAccount(env.AGENT_PRIVATE_KEY as Hex) });
const jobs = new Map<string, Hex>();

await startAgent(env, {
  prover: {
    trustedAttestors: [localAttestorAddress(ATTESTOR_KEY)],
    prove: ({ repo, prNumber, binding }) =>
      signLocalClaim(ATTESTOR_KEY, {
        repo,
        prNumber,
        binding,
        extracted: {
          number: String(prNumber),
          merged: "true",
          mergedAt: `"${E2E_MERGED_AT}"`,
          baseRef: "main",
          author: E2E_PR_AUTHOR,
          editor: "null",
          repo,
          payee: E2E_PAYEE,
        },
      }),
  },
  zkverify: {
    target: "AggregationPublished",
    domainId: 0,
    async submit(p) {
      const leaf = statementLeaf(vkHash, p.publicSignals);
      const hash = await marker.writeContract({ address: zkVerify, abi: mockZkVerifyAbi, functionName: "markAggregated", args: [0n, 1n, leaf] });
      await reader.waitForTransactionReceipt({ hash });
      const jobId = `e2e-${jobs.size + 1}`;
      jobs.set(jobId, leaf);
      return { jobId };
    },
    async status(jobId): Promise<JobState> {
      const leaf = jobs.get(jobId) as Hex;
      return {
        jobId,
        status: "AggregationPublished",
        chainId: 31337,
        txHash: `0x${"7a".repeat(32)}`,
        aggregationId: 1,
        statement: leaf,
        aggregationDetails: { receipt: "0x", receiptBlockHash: "0x", root: "0x", leaf, leafIndex: 0, numberOfLeaves: 1, merkleProof: [] },
      };
    },
  },
});

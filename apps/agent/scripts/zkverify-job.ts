// Prints the current zkVerify (Kurier) status of one job, then asks the vault's zkVerify aggregation
// contract (on RPC_URL) whether that aggregation is visible on-chain, exactly as the agent does. Usage:
//   node --env-file=../../.env --experimental-strip-types scripts/zkverify-job.ts <jobId>
import { bountyVaultAbi } from "@mba/contracts";
import { createPublicClient, http, type Address } from "viem";
import { createKurierVerifier } from "../src/zk.ts";

const jobId = process.argv[2];
if (!jobId) throw new Error("usage: zkverify-job.ts <jobId>");
const client = createPublicClient({ transport: http(process.env.RPC_URL) });
const address = await client.readContract({ address: process.env.VAULT_ADDRESS as Address, abi: bountyVaultAbi, functionName: "zkVerify" });
const { verifier } = await createKurierVerifier({
  apiUrl: process.env.KURIER_API_URL as string,
  apiKey: process.env.KURIER_API_KEY as string,
  aggregationChainId: Number(process.env.CHAIN_ID ?? 11155111),
  domainId: Number(process.env.ZKVERIFY_DOMAIN_ID ?? 0),
  aggregationCheck: { client, address },
});
const state = await verifier.status(jobId);
console.log(`status ${state.status}, aggregation ${state.aggregationId ?? "-"}, statement ${state.statement ?? "-"}`);
console.log(`on-chain at ${address} (domain ${verifier.domainId}): ${await verifier.published?.(state, verifier.domainId)}`);

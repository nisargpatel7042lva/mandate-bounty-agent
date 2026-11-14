// Smoke test of the zkVerify leg on testnet: proves one sample mandate, submits it to zkVerify via
// Kurier with aggregation to Ethereum Sepolia, and prints each status until it is aggregated (check
// the root on Sepolia with scripts/zkverify-job.ts) or the wait times out. Uses no chain funds. Usage:
//   node --env-file=../../.env --experimental-strip-types scripts/zkverify-smoke.ts
import { proveMandate } from "@mba/circuits";
import { createKurierClient, statementLeaf } from "@mba/zkverify";

const kurier = createKurierClient({ apiUrl: process.env.KURIER_API_URL as string, apiKey: process.env.KURIER_API_KEY as string });
const vkHash = process.env.ZKVERIFY_VK_HASH as `0x${string}`;
const payee = "0x1890d4b70874e92530faa5cf1599f4c2f01aefe2" as const;
const now = Math.floor(Date.now() / 1000);
const r = await proveMandate(
  { bountyId: 999, perPayoutCap: 500_000_000n, totalBudget: 1_000_000_000n, expiry: now + 86_400, allowedPayees: [payee] },
  { amount: 1_000_000n, payee, spent: 0n, now, claimId: `0x${"ab".repeat(32)}` },
);
if (!r.ok) throw new Error(`mandate rejected: ${r.reasons.join(", ")}`);
const { jobId, optimisticVerify } = await kurier.submitProof({ proof: r.proof.proof, publicSignals: r.proof.publicSignals, vkHash, chainId: 11155111 });
console.log(`job ${jobId}, optimistic verify: ${optimisticVerify}`);
console.log(`expected leaf ${statementLeaf(vkHash, r.proof.publicSignals)}`);
let last = "";
const deadline = Date.now() + 30 * 60_000;
while (Date.now() < deadline) {
  const s = await kurier.jobStatus(jobId);
  if (s.status !== last) {
    last = s.status;
    console.log(new Date().toISOString(), s.status, s.txHash ?? "", s.aggregationId ?? "", s.statement ?? "");
  }
  if (s.status === "Aggregated" || s.status === "AggregationPublished" || /Fail|Error/i.test(s.status)) {
    console.log(JSON.stringify(s.aggregationDetails ?? {}, null, 0).slice(0, 400));
    break;
  }
  await new Promise((res) => setTimeout(res, 10_000));
}

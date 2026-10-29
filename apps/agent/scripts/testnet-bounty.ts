// Creates and funds one real bounty on Ethereum Sepolia from the deployer account, then registers it
// with the running agent. Usage:
//   node --env-file=../../.env --experimental-strip-types scripts/testnet-bounty.ts [owner/repo] [issue]
// Optional: BOUNTY_TITLE and BOUNTY_CRITERIA set the title and acceptance criteria sent to the agent.
import { readFileSync } from "node:fs";
import { bountyVaultAbi, mockUSDCAbi } from "@mba/contracts";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const [repo = "nisargpatel7042lva/mandate", issue = "1"] = process.argv.slice(2);
const deployment = JSON.parse(
  readFileSync(new URL("../../../packages/contracts/deployments/11155111.json", import.meta.url), "utf8"),
) as { bountyVault: Address; mockUsdc: Address };

const key = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("DEPLOYER_PRIVATE_KEY missing from .env");
const account = privateKeyToAccount(key);
const transport = http(process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com");
const reader = createPublicClient({ chain: sepolia, transport });
const wallet = createWalletClient({ chain: sepolia, transport, account });
const explorer = (h: string) => `https://sepolia.etherscan.io/tx/${h}`;

async function send(label: string, hash: Hex) {
  const r = await reader.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} reverted: ${explorer(hash)}`);
  console.log(`${label.padEnd(16)} ${explorer(hash)}`);
  return hash;
}

const fund = 400_000_000n; // 400 tUSDC
await send("faucet", await wallet.writeContract({ address: deployment.mockUsdc, abi: mockUSDCAbi, functionName: "faucet", args: [1_000_000_000n] }));
await send("approve", await wallet.writeContract({ address: deployment.mockUsdc, abi: mockUSDCAbi, functionName: "approve", args: [deployment.bountyVault, fund] }));
const createTx = await send(
  "createAndFund",
  await wallet.writeContract({
    address: deployment.bountyVault,
    abi: bountyVaultAbi,
    functionName: "createAndFund",
    args: [
      repo,
      BigInt(issue),
      250_000_000n,
      { perPayoutCap: 500_000_000n, totalBudget: 1_000_000_000n, expiry: BigInt(Math.floor(Date.now() / 1000) + 30 * 86_400) },
      [account.address],
      fund,
    ],
  }),
);

const agentUrl = process.env.AGENT_URL ?? `http://localhost:${process.env.PORT ?? 8787}`;
const res = await fetch(`${agentUrl}/bounties`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    txHash: createTx,
    title: process.env.BOUNTY_TITLE ?? `Testnet bounty for ${repo}#${issue}`,
    acceptanceCriteria: process.env.BOUNTY_CRITERIA ?? "Phase 1 manual E2E: created and funded from the CLI on Ethereum Sepolia.",
  }),
}).catch((e: Error) => ({ ok: false, status: 0, text: async () => e.message }));
console.log(res.ok ? `registered with agent at ${agentUrl}` : `agent registration failed (${res.status}): ${await res.text()}`);

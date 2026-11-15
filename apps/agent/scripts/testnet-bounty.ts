// Creates and funds one real bounty on Ethereum Sepolia from the deployer account, then registers it
// with the running agent. Usage:
//   node --env-file=../../.env --experimental-strip-types scripts/testnet-bounty.ts [owner/repo] [issue]
// Optional: BOUNTY_TITLE and BOUNTY_CRITERIA set the title and acceptance criteria sent to the agent;
// BOUNTY_PAYEES (comma-separated) sets the allowlist (default: the deployer). Amounts in whole tUSDC:
// BOUNTY_PAYOUT (250), BOUNTY_FUND (400), BOUNTY_CAP (500), BOUNTY_BUDGET (1000), BOUNTY_DAYS (30).
// AGENT_URL is the agent to register with (default: localhost).
import { readFileSync } from "node:fs";
import { mandateCommitmentHex } from "@mba/circuits";
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

const usdc = (name: string, fallback: number) => BigInt(Math.round(Number(process.env[name] ?? fallback) * 1_000_000));
const payout = usdc("BOUNTY_PAYOUT", 250);
const fund = usdc("BOUNTY_FUND", 400);
// The mandate and the Poseidon commitment the mandate proof will be checked against.
const days = Number(process.env.BOUNTY_DAYS ?? 30);
const mandate = { perPayoutCap: usdc("BOUNTY_CAP", 500), totalBudget: usdc("BOUNTY_BUDGET", 1000), expiry: BigInt(Math.floor(Date.now() / 1000) + days * 86_400) };
if (payout > mandate.perPayoutCap || fund > mandate.totalBudget || fund < payout) throw new Error("need payout <= cap, payout <= fund <= budget");
const payees = (process.env.BOUNTY_PAYEES ?? account.address).split(",").map((a) => a.trim() as Address);
const commitment = await mandateCommitmentHex({ ...mandate, allowedPayees: payees });
await send("faucet", await wallet.writeContract({ address: deployment.mockUsdc, abi: mockUSDCAbi, functionName: "faucet", args: [fund] }));
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
      payout,
      { ...mandate, commitment },
      payees,
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

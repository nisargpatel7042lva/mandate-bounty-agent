// Public, always-on agent endpoint (GET or POST /api/agent). It reports what the agent has done,
// read live from the BountyVault on Ethereum Sepolia, so it never depends on the agent's own host.
// Each payout shows the zkTLS claim ID and the zkVerify leaf the vault checked before paying. When
// the full agent (watcher + API) is reachable at NEXT_PUBLIC_AGENT_URL, its /health is included too.
import { bountyVaultAbi } from "@mba/contracts";
import { createPublicClient, fallback, http, type Address } from "viem";

export const dynamic = "force-dynamic";

const VAULT = process.env.NEXT_PUBLIC_VAULT_ADDRESS as Address;
const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const EXPLORER = process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://sepolia.etherscan.io";
const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? "";
const DEPLOY_BLOCK = 12133209n;

async function agentHealth() {
  if (!AGENT_URL) return { reachable: false };
  try {
    const res = await fetch(`${AGENT_URL.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(3000), cache: "no-store" });
    return { reachable: res.ok, url: AGENT_URL, health: res.ok ? await res.json() : null };
  } catch {
    return { reachable: false, url: AGENT_URL };
  }
}

async function status() {
  // public Sepolia RPCs prune old logs at times; fall back to ones that keep full history
  const client = createPublicClient({
    transport: fallback([http(RPC), http("https://rpc.sepolia.ethpandaops.io"), http("https://sepolia.gateway.tenderly.co")]),
  });
  const [count, logs, agent, agentSigner, vkHash] = await Promise.all([
    client.readContract({ address: VAULT, abi: bountyVaultAbi, functionName: "bountyCount" }),
    client.getContractEvents({ address: VAULT, abi: bountyVaultAbi, eventName: "PayoutReleased", fromBlock: DEPLOY_BLOCK }),
    agentHealth(),
    client.readContract({ address: VAULT, abi: bountyVaultAbi, functionName: "agent" }),
    client.readContract({ address: VAULT, abi: bountyVaultAbi, functionName: "vkHash" }),
  ]);
  return {
    agent: "Mandate Bounty Agent",
    summary: "Pays open-source bounties only when a zkTLS proof shows the PR was merged and a zkVerify-verified Groth16 proof shows the payout fits the funder's mandate. The LLM proposes, the proofs dispose.",
    ok: true,
    chain: { id: 11155111, name: "Ethereum Sepolia" },
    vault: { address: VAULT, agentSigner, zkVerifyVkHash: vkHash, bounties: Number(count) },
    payouts: logs.map((l) => ({
      bountyId: Number(l.args.id),
      payee: l.args.payee,
      amount: `${Number(l.args.amount) / 1e6} tUSDC`,
      prNumber: Number(l.args.prNumber),
      zkTlsClaimId: l.args.claimId,
      zkVerifyLeaf: l.args.proofRef,
      tx: `${EXPLORER}/tx/${l.transactionHash}`,
      receipt: `https://mandate-bounty-agent.vercel.app/receipts/${Number(l.args.id)}`,
    })),
    liveAgent: agent,
    source: "https://github.com/nisargpatel7042lva/mandate-bounty-agent",
  };
}

const respond = async () => {
  try {
    return Response.json(await status(), { headers: { "access-control-allow-origin": "*" } });
  } catch (err) {
    return Response.json({ agent: "Mandate Bounty Agent", ok: false, error: (err as Error).message.split("\n")[0] }, { status: 502 });
  }
};

export const GET = respond;
export const POST = respond;

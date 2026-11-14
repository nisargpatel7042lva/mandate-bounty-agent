import { bountyVaultAbi } from "@mba/contracts";
import { createWalletClient, defineChain, http, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Payer } from "../payout-step.ts";

/** Sends BountyVault.release from the agent's signer key. */
export function createPayer(client: PublicClient, opts: { rpcUrl: string; chainId: number; vault: `0x${string}`; agentKey: `0x${string}` }): Payer & { address: `0x${string}` } {
  const account = privateKeyToAccount(opts.agentKey);
  const chain = defineChain({ id: opts.chainId, name: `chain-${opts.chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [opts.rpcUrl] } } });
  const wallet = createWalletClient({ account, chain, transport: http(opts.rpcUrl) });

  return {
    address: account.address,
    async release(r) {
      // Simulate first so a revert (e.g. ProofNotVerified) surfaces as a named error, without gas.
      const { request } = await client.simulateContract({ account, address: opts.vault, abi: bountyVaultAbi, functionName: "release", args: [r] });
      return wallet.writeContract(request);
    },
    async receipt(hash) {
      const r = await client.getTransactionReceipt({ hash }).catch(() => null);
      if (!r) return "pending";
      return r.status === "success" ? "success" : "reverted";
    },
    async isPaid(bountyId) {
      const b = await client.readContract({ address: opts.vault, abi: bountyVaultAbi, functionName: "getBounty", args: [BigInt(bountyId)] });
      return b.paid;
    },
  };
}

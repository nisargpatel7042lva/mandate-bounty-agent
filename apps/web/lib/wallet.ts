"use client";

import { createPublicClient, createWalletClient, custom, http, numberToHex, type Address, type EIP1193Provider } from "viem";
import type { WebConfig } from "./config.ts";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export class WalletError extends Error {}

/** Connects the browser's injected wallet (MetaMask, Rabby, ...) and switches it to the app's chain. */
export async function connectWallet(config: WebConfig): Promise<Address> {
  const provider = window.ethereum;
  if (!provider) throw new WalletError("No browser wallet found. Install MetaMask or another injected wallet.");
  const [account] = await provider.request({ method: "eth_requestAccounts" });
  if (!account) throw new WalletError("The wallet returned no account.");
  await ensureChain(provider, config);
  return account;
}

async function ensureChain(provider: EIP1193Provider, config: WebConfig) {
  const current = Number(await provider.request({ method: "eth_chainId" }));
  if (current === config.chainId) return;
  const chainId = numberToHex(config.chainId);
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (err) {
    // 4902: chain not added to the wallet yet.
    if ((err as { code?: number }).code !== 4902) throw err;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: config.chainName,
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: [config.rpcUrl],
          ...(config.explorerUrl ? { blockExplorerUrls: [config.explorerUrl] } : {}),
        },
      ],
    });
  }
}

export function clients(config: WebConfig, account: Address) {
  const provider = window.ethereum;
  if (!provider) throw new WalletError("No browser wallet found.");
  return {
    wallet: createWalletClient({ account, chain: config.chain, transport: custom(provider) }),
    reader: createPublicClient({ chain: config.chain, transport: http(config.rpcUrl) }),
  };
}

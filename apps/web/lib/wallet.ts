"use client";

import { createPublicClient, createWalletClient, custom, http, numberToHex, type Address, type EIP1193Provider } from "viem";
import type { WebConfig } from "./config.ts";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export class WalletError extends Error {}

/** A browser wallet announced through EIP-6963 (or the legacy window.ethereum fallback). */
export interface WalletOption {
  id: string;
  name: string;
  icon: string | null;
  rdns: string;
  provider: EIP1193Provider;
}

interface AnnounceDetail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: EIP1193Provider;
}

const LAST_KEY = "mba:last-wallet";
let selected: EIP1193Provider | null = null;

/**
 * Lists installed wallets via EIP-6963, so several extensions (MetaMask, Coinbase, Phantom, ...)
 * don't fight over window.ethereum. Falls back to window.ethereum when no wallet announces itself.
 */
export async function discoverWallets(waitMs = 300): Promise<WalletOption[]> {
  if (typeof window === "undefined") return [];
  const found = new Map<string, WalletOption>();
  const onAnnounce = (e: Event) => {
    const d = (e as CustomEvent<AnnounceDetail>).detail;
    if (!d?.provider || !d.info) return;
    found.set(d.info.rdns || d.info.uuid, { id: d.info.uuid, name: d.info.name, icon: d.info.icon || null, rdns: d.info.rdns, provider: d.provider });
  };
  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((r) => setTimeout(r, waitMs));
  window.removeEventListener("eip6963:announceProvider", onAnnounce);

  const list = [...found.values()];
  if (list.length === 0 && window.ethereum) {
    list.push({ id: "injected", name: "Browser wallet", icon: null, rdns: "injected", provider: window.ethereum });
  }
  // MetaMask first, then the order wallets announced themselves
  return list.sort((a, b) => Number(b.rdns === "io.metamask") - Number(a.rdns === "io.metamask"));
}

export function lastWalletRdns(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

/** Turns wallet error codes into something a person can act on. */
export function walletErrorMessage(e: unknown): string {
  const err = e as { code?: number; shortMessage?: string; message?: string; cause?: { code?: number } };
  const code = err.code ?? err.cause?.code;
  if (code === 4001) return "You rejected the request in your wallet. Click Connect wallet to try again.";
  if (code === -32002) return "Your wallet already has a request waiting. Open the wallet extension and approve or reject it.";
  if (code === 4100) return "Your wallet hasn't authorised this site. Unlock the wallet and try again.";
  const text = `${err.shortMessage ?? ""} ${err.message ?? ""}`;
  if (/insufficient funds|exceeds the balance|gas required exceeds/i.test(text))
    return "Your wallet has no Sepolia ETH to pay gas. Get a little from a Sepolia faucet, then try again.";
  if (/does not match the target chain|chain mismatch/i.test(text)) return "Your wallet is on a different network. Switch it to Sepolia and try again.";
  return err.shortMessage ?? err.message ?? String(e);
}

/** Connects the chosen wallet and switches it to the app's chain. */
export async function connectWallet(config: WebConfig, wallet: WalletOption): Promise<Address> {
  const provider = wallet.provider;
  const [account] = await provider.request({ method: "eth_requestAccounts" });
  if (!account) throw new WalletError("The wallet returned no account. Unlock it and try again.");
  await ensureChain(provider, config);
  selected = provider;
  try {
    localStorage.setItem(LAST_KEY, wallet.rdns);
  } catch {
    // private mode: nothing to remember, which is fine
  }
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

/**
 * Connects without a picker: the wallet used last time, else MetaMask, else the only one installed.
 * For one-off actions (the funder's approve button) where a picker would be in the way.
 */
export async function connectPreferred(config: WebConfig): Promise<Address> {
  const found = await discoverWallets();
  const last = lastWalletRdns();
  const pick = found.find((w) => w.rdns === last) ?? found[0];
  if (!pick) throw new WalletError("No browser wallet found. Install MetaMask (or another wallet extension), then reload this page.");
  return connectWallet(config, pick);
}

/** Before every transaction: the wallet may have been moved to another network since connecting. */
export async function ensureSelectedChain(config: WebConfig) {
  const provider = selected ?? window.ethereum;
  if (provider) await ensureChain(provider, config);
}

export function clients(config: WebConfig, account: Address) {
  const provider = selected ?? window.ethereum;
  if (!provider) throw new WalletError("No wallet connected.");
  return {
    wallet: createWalletClient({ account, chain: config.chain, transport: custom(provider) }),
    reader: createPublicClient({ chain: config.chain, transport: http(config.rpcUrl) }),
  };
}

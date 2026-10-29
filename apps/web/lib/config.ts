import { defineChain, type Address, type Chain } from "viem";
import { z } from "zod";

const Address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x address").transform((s) => s as Address);

const ConfigSchema = z.object({
  agentUrl: z.url(),
  chainId: z.coerce.number().int().positive(),
  chainName: z.string().min(1),
  rpcUrl: z.url(),
  explorerUrl: z.url().optional(),
  vault: Address,
  usdc: Address,
});
export type WebConfig = z.infer<typeof ConfigSchema> & { chain: Chain };

// Next.js inlines NEXT_PUBLIC_* only when referenced literally, so each one is spelled out.
const raw = {
  agentUrl: process.env.NEXT_PUBLIC_AGENT_URL,
  chainId: process.env.NEXT_PUBLIC_CHAIN_ID,
  chainName: process.env.NEXT_PUBLIC_CHAIN_NAME,
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL,
  explorerUrl: process.env.NEXT_PUBLIC_EXPLORER_URL || undefined,
  vault: process.env.NEXT_PUBLIC_VAULT_ADDRESS,
  usdc: process.env.NEXT_PUBLIC_USDC_ADDRESS,
};

/** Parsed lazily so a missing variable shows up as a readable message in the UI, not a build crash. */
export function getConfig(): { ok: true; config: WebConfig } | { ok: false; error: string } {
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => `NEXT_PUBLIC_${toEnvName(String(i.path[0]))}: ${i.message}`).join("; ") };
  }
  const c = parsed.data;
  const chain = defineChain({
    id: c.chainId,
    name: c.chainName,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [c.rpcUrl] } },
    ...(c.explorerUrl ? { blockExplorers: { default: { name: "Explorer", url: c.explorerUrl } } } : {}),
  });
  return { ok: true, config: { ...c, chain } };
}

const ENV_NAMES: Record<string, string> = {
  agentUrl: "AGENT_URL",
  chainId: "CHAIN_ID",
  chainName: "CHAIN_NAME",
  rpcUrl: "RPC_URL",
  explorerUrl: "EXPLORER_URL",
  vault: "VAULT_ADDRESS",
  usdc: "USDC_ADDRESS",
};
const toEnvName = (key: string) => ENV_NAMES[key] ?? key;

export function txUrl(config: WebConfig, hash: string): string | null {
  return config.explorerUrl ? `${config.explorerUrl.replace(/\/$/, "")}/tx/${hash}` : null;
}

export function addressUrl(config: WebConfig, address: string): string | null {
  return config.explorerUrl ? `${config.explorerUrl.replace(/\/$/, "")}/address/${address}` : null;
}

// One-time testnet setup for the payout path, run before deploying vault v2:
//  1. registers the mandate circuit's verification key with zkVerify (via Kurier) and records its
//     hash as ZKVERIFY_VK_HASH;
//  2. creates a dedicated agent signer (AGENT_PRIVATE_KEY / AGENT_ADDRESS) if .env has none.
// Writes only missing or placeholder keys in the root .env; prints no secrets. Usage:
//   node --env-file=../../.env --experimental-strip-types scripts/testnet-setup.ts
import { readFileSync, writeFileSync } from "node:fs";
import { verificationKey } from "@mba/circuits";
import { createKurierClient } from "@mba/zkverify";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const envPath = new URL("../../../.env", import.meta.url);
let env = readFileSync(envPath, "utf8");
const isSet = (k: string) => {
  const v = env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim();
  return Boolean(v) && !/placeholder/i.test(v as string);
};
const put = (k: string, v: string) => {
  const line = `${k}=${v}`;
  env = new RegExp(`^${k}=.*$`, "m").test(env) ? env.replace(new RegExp(`^${k}=.*$`, "m"), line) : `${env.replace(/\s*$/, "")}\n${line}\n`;
};

const apiKey = process.env.KURIER_API_KEY;
if (!apiKey || /placeholder/i.test(apiKey)) throw new Error("KURIER_API_KEY missing from .env");
const kurier = createKurierClient({ apiUrl: process.env.KURIER_API_URL ?? "https://api-testnet.kurier.xyz/api/v1", apiKey });
const vkHash = await kurier.registerVk(verificationKey());
put("ZKVERIFY_VK_HASH", vkHash);
console.log(`ZKVERIFY_VK_HASH=${vkHash}`);

if (!isSet("AGENT_PRIVATE_KEY")) {
  const key = generatePrivateKey();
  put("AGENT_PRIVATE_KEY", key);
  put("AGENT_ADDRESS", privateKeyToAccount(key).address);
  console.log(`new agent signer: ${privateKeyToAccount(key).address}`);
} else {
  const key = env.match(/^AGENT_PRIVATE_KEY=(.*)$/m)?.[1]?.trim() as `0x${string}`;
  put("AGENT_ADDRESS", privateKeyToAccount(key).address);
  console.log(`existing agent signer: ${privateKeyToAccount(key).address}`);
}
writeFileSync(envPath, env);

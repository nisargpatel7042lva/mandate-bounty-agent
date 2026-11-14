// Boots the full local stack for Playwright: anvil + deployed contracts + agent + Next dev server.
// Run by playwright.config.ts as its webServer; stays in the foreground until killed.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deployLocal, startAnvil } from "@mba/contracts/testing";
import { E2E } from "./ports.ts";
import { startStubs } from "./stubs.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, "..");
// The real agent, with a local test attestor in place of Reclaim (see agent-entry.ts).
const agentEntry = path.join(here, "agent-entry.ts");
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");

const stubs = await startStubs();
const chain = await startAnvil(E2E.anvilPort);
const VK_HASH = `0x${"5a".repeat(32)}` as const;
const d = await deployLocal(chain.rpcUrl, { vkHash: VK_HASH, aggregationRequired: true });
writeFileSync(path.join(here, ".stack.json"), JSON.stringify({ rpcUrl: chain.rpcUrl, vault: d.bountyVault, usdc: d.mockUsdc, agentUrl: `http://127.0.0.1:${E2E.agentPort}` }));

const children: ChildProcess[] = [];
const start = (args: string[], env: Record<string, string>, cwd: string) => {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: "inherit" });
  children.push(child);
  return child;
};

start(
  ["--experimental-strip-types", "--no-warnings", agentEntry],
  {
    PORT: String(E2E.agentPort),
    DATABASE_PATH: path.join(mkdtempSync(path.join(tmpdir(), "mba-e2e-")), "e2e.sqlite"),
    RPC_URL: chain.rpcUrl,
    CHAIN_ID: "31337",
    VAULT_ADDRESS: d.bountyVault,
    VAULT_DEPLOY_BLOCK: d.deployBlock.toString(),
    SYNC_INTERVAL_MS: "1000",
    CORS_ORIGINS: E2E.webUrl,
    // The vault's release signer (anvil dev key 0, public) and the local zkVerify stand-in.
    AGENT_PRIVATE_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    E2E_ZKVERIFY_ADDRESS: d.zkVerify,
    E2E_VK_HASH: VK_HASH,
    KURIER_API_KEY: "",
    // GitHub and Claude are local stubs (e2e/stubs.ts); the agent's real clients talk to them.
    GITHUB_TOKEN: "e2e-github-token",
    GITHUB_TOKEN_COMMAND: "",
    GITHUB_API_URL: stubs.githubUrl,
    GITHUB_POLL_INTERVAL_MS: "1000",
    ANTHROPIC_API_KEY: "e2e-anthropic-key",
    ANTHROPIC_BASE_URL: stubs.anthropicUrl,
  },
  webDir,
);

// Playwright waits only for the web port, so hold Next until the agent answers.
const agentHealth = `http://127.0.0.1:${E2E.agentPort}/health`;
for (let i = 0; ; i++) {
  try {
    if ((await fetch(agentHealth)).ok) break;
  } catch {
    // not up yet
  }
  if (i > 240) throw new Error("agent did not start within 60s");
  await new Promise((r) => setTimeout(r, 250));
}

start(
  [nextBin, "dev", "--port", String(E2E.webPort)],
  {
    NEXT_DIST_DIR: ".next-e2e",
    NEXT_PUBLIC_AGENT_URL: `http://127.0.0.1:${E2E.agentPort}`,
    NEXT_PUBLIC_CHAIN_ID: "31337",
    NEXT_PUBLIC_CHAIN_NAME: "Anvil",
    NEXT_PUBLIC_RPC_URL: chain.rpcUrl,
    NEXT_PUBLIC_EXPLORER_URL: "",
    NEXT_PUBLIC_VAULT_ADDRESS: d.bountyVault,
    NEXT_PUBLIC_USDC_ADDRESS: d.mockUsdc,
  },
  webDir,
);

const shutdown = () => {
  for (const c of children) c.kill();
  chain.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

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
const d = await deployLocal(chain.rpcUrl);
writeFileSync(path.join(here, ".stack.json"), JSON.stringify({ rpcUrl: chain.rpcUrl, vault: d.bountyVault, usdc: d.mockUsdc }));

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

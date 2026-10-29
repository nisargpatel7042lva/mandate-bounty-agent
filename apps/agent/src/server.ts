import { serve } from "@hono/node-server";
import { createPublicClient, http } from "viem";
import { createApp } from "./app.ts";
import { createVaultReader } from "./chain/reader.ts";
import { syncVault } from "./chain/sync.ts";
import { openDb } from "./db/client.ts";
import { loadEnv } from "./env.ts";

const env = loadEnv();
const { db } = openDb(env.DATABASE_PATH);
const client = createPublicClient({ transport: http(env.RPC_URL) });
const ctx = { client, chainId: env.CHAIN_ID, vault: env.VAULT_ADDRESS, deployBlock: env.VAULT_DEPLOY_BLOCK };

const app = createApp({ db, chain: createVaultReader(client, env.CHAIN_ID, env.VAULT_ADDRESS), corsOrigins: env.CORS_ORIGINS });

let syncing = false;
async function tick() {
  if (syncing) return;
  syncing = true;
  try {
    const r = await syncVault(db, ctx);
    if (r.events > 0) console.log(`sync: ${r.events} events in blocks ${r.from}..${r.to}`);
  } catch (err) {
    console.error("sync failed:", err instanceof Error ? err.message : err);
  } finally {
    syncing = false;
  }
}

await tick();
setInterval(tick, env.SYNC_INTERVAL_MS);

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`agent listening on :${info.port} (chain ${env.CHAIN_ID}, vault ${env.VAULT_ADDRESS})`);
});

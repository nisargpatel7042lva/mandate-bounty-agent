// Rebuilds seed/mandate-bounty.sqlite so a fresh agent (Render's free tier wipes its disk) starts
// with every bounty's off-chain metadata. Starts from the current seed, syncs new bounties from the
// vault on Sepolia, copies titles and acceptance criteria from the live agent, then writes the seed.
// Usage (from apps/agent):  node --env-file=../../.env --experimental-strip-types scripts/refresh-seed.ts [agentUrl]
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { createPublicClient, http, type Address } from "viem";
import { syncVault } from "../src/chain/sync.ts";
import { openDb } from "../src/db/client.ts";
import { bounties } from "../src/db/schema.ts";

const agentUrl = process.argv[2] ?? "https://mandate-bounty-agent.onrender.com";
const seed = "seed/mandate-bounty.sqlite";
const dir = mkdtempSync(path.join(tmpdir(), "mba-seed-"));
const file = path.join(dir, "seed.sqlite");

const { db, close } = openDb(file, seed);
const client = createPublicClient({ transport: http(process.env.RPC_URL) });
const r = await syncVault(db, { client, chainId: Number(process.env.CHAIN_ID), vault: process.env.VAULT_ADDRESS as Address, deployBlock: BigInt(process.env.VAULT_DEPLOY_BLOCK ?? 0) });
console.log(`synced blocks ${r.from}..${r.to}: ${r.events} events`);

const live = (await (await fetch(`${agentUrl}/bounties`)).json()) as { id: number; title: string | null; acceptanceCriteria: string | null }[];
for (const b of live) {
  db.update(bounties).set({ title: b.title, acceptanceCriteria: b.acceptanceCriteria }).where(eq(bounties.id, b.id)).run();
}
close();

rmSync(seed, { force: true });
const src = new Database(file, { readonly: true });
src.exec(`VACUUM INTO '${seed}'`);
src.close();
const check = new Database(seed, { readonly: true });
console.log(check.prepare("select id, status, title from bounties order by id").all());
check.close();
rmSync(dir, { recursive: true, force: true });

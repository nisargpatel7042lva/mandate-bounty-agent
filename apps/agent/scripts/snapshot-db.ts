// Writes a consistent copy of the agent's live SQLite database to seed/mandate-bounty.sqlite. Hosts
// with an ephemeral disk (Render's free tier) start from this seed, so past bounties keep their
// claims, proofs and receipts across restarts. Safe while the agent runs (VACUUM INTO). Usage:
//   node --env-file=../../.env --experimental-strip-types scripts/snapshot-db.ts
import { rmSync } from "node:fs";
import Database from "better-sqlite3";

const source = process.env.DATABASE_PATH ?? "./data/mandate-bounty.sqlite";
const target = "seed/mandate-bounty.sqlite";
rmSync(target, { force: true });
new Database(source, { readonly: true }).exec(`VACUUM INTO '${target}'`);
const db = new Database(target, { readonly: true });
for (const { name } of db.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]) {
  console.log(name.padEnd(18), (db.prepare(`select count(*) as c from "${name}"`).get() as { c: number }).c);
}
console.log(db.prepare("select id, status from bounties").all());

import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Mirror of BountyVault state plus off-chain metadata. The chain is the source of truth for
 * every money field; amounts are stored as decimal strings because they exceed 2^53.
 */
export const bounties = sqliteTable("bounties", {
  id: integer("id").primaryKey(),
  chainId: integer("chain_id").notNull(),
  vault: text("vault").notNull(),
  funder: text("funder").notNull(),
  repo: text("repo").notNull(),
  issueNumber: integer("issue_number").notNull(),
  payoutAmount: text("payout_amount").notNull(),
  perPayoutCap: text("per_payout_cap").notNull(),
  totalBudget: text("total_budget").notNull(),
  expiry: integer("expiry").notNull(),
  payees: text("payees", { mode: "json" }).$type<string[]>().notNull(),
  funded: text("funded").notNull().default("0"),
  spent: text("spent").notNull().default("0"),
  createdTx: text("created_tx").notNull(),
  createdBlock: integer("created_block").notNull(),
  title: text("title"),
  acceptanceCriteria: text("acceptance_criteria"),
  updatedAt: integer("updated_at").notNull(),
});

export const fundings = sqliteTable(
  "fundings",
  {
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    bountyId: integer("bounty_id").notNull(),
    from: text("from_address").notNull(),
    amount: text("amount").notNull(),
    blockNumber: integer("block_number").notNull(),
  },
  (t) => [primaryKey({ columns: [t.txHash, t.logIndex] })],
);

export const syncState = sqliteTable("sync_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/** Kept next to the Drizzle schema so the two cannot drift; applied idempotently at startup. */
export const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS bounties (
  id INTEGER PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  vault TEXT NOT NULL,
  funder TEXT NOT NULL,
  repo TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  payout_amount TEXT NOT NULL,
  per_payout_cap TEXT NOT NULL,
  total_budget TEXT NOT NULL,
  expiry INTEGER NOT NULL,
  payees TEXT NOT NULL,
  funded TEXT NOT NULL DEFAULT '0',
  spent TEXT NOT NULL DEFAULT '0',
  created_tx TEXT NOT NULL,
  created_block INTEGER NOT NULL,
  title TEXT,
  acceptance_criteria TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS fundings (
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  bounty_id INTEGER NOT NULL,
  from_address TEXT NOT NULL,
  amount TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

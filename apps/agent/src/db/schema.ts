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
  /** Poseidon commitment the funder set on-chain; the mandate proof must match it. */
  mandateCommitment: text("mandate_commitment"),
  payees: text("payees", { mode: "json" }).$type<string[]>().notNull(),
  funded: text("funded").notNull().default("0"),
  spent: text("spent").notNull().default("0"),
  createdTx: text("created_tx").notNull(),
  createdBlock: integer("created_block").notNull(),
  title: text("title"),
  acceptanceCriteria: text("acceptance_criteria"),
  /** Workflow position (see BountyStatus). Only the vault moves money; this is the agent's view. */
  status: text("status").$type<BountyStatus>().notNull().default("open"),
  statusReason: text("status_reason"),
  /** Funder approved paying despite the advisory review (mirrored from ReviewOverrideApproved). */
  reviewOverride: integer("review_override", { mode: "boolean" }).notNull().default(false),
  /** Mirrored from PayoutReleased. */
  paidTx: text("paid_tx"),
  updatedAt: integer("updated_at").notNull(),
});

export type BountyStatus = import("@mba/shared").BountyStatus;

/** The zkTLS proof that GitHub reported the claimed PR as merged, and its local verification. */
export const workProofs = sqliteTable("work_proofs", {
  bountyId: integer("bounty_id").primaryKey(),
  /** Raw Reclaim proof, kept so anyone can re-verify it. */
  proof: text("proof", { mode: "json" }).$type<import("@mba/zktls").ZkTlsProof>(),
  claim: text("claim", { mode: "json" }).$type<import("@mba/zktls").MergedPrClaim>(),
  identifier: text("identifier"),
  signers: text("signers", { mode: "json" }).$type<string[]>(),
  attestedAt: integer("attested_at"),
  verifiedAt: integer("verified_at"),
  failureCode: text("failure_code"),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
});

/** The Groth16 mandate-compliance proof for the payout, and its zkVerify verification. */
export const mandateProofs = sqliteTable("mandate_proofs", {
  bountyId: integer("bounty_id").primaryKey(),
  state: text("state").$type<"rejected" | "proved" | "submitted" | "verified" | "failed">().notNull(),
  reasons: text("reasons", { mode: "json" }).$type<import("@mba/shared").MandateReasonCode[]>().notNull(),
  commitment: text("commitment"),
  proof: text("proof", { mode: "json" }).$type<unknown>(),
  publicSignals: text("public_signals", { mode: "json" }).$type<string[]>(),
  checkedAt: integer("checked_at"),
  zkJobId: text("zk_job_id"),
  zkStatus: text("zk_status"),
  zkTxHash: text("zk_tx_hash"),
  zkAggregationId: integer("zk_aggregation_id"),
  zkDomainId: integer("zk_domain_id"),
  zkStatement: text("zk_statement"),
  zkAggregation: text("zk_aggregation", { mode: "json" }).$type<import("@mba/zkverify").AggregationDetails>(),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
});

/** The vault payout. Written before the transaction is sent, so a crash can be reconciled. */
export const payouts = sqliteTable("payouts", {
  bountyId: integer("bounty_id").primaryKey(),
  state: text("state").$type<"sending" | "sent" | "paid" | "failed">().notNull(),
  payee: text("payee").notNull(),
  amount: text("amount").notNull(),
  txHash: text("tx_hash"),
  paidAt: integer("paid_at"),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
});

/**
 * A merged PR that GitHub records as closing the bounty's issue, plus the advisory LLM review
 * of it. One claim per bounty: the first qualifying close wins.
 */
export const claims = sqliteTable("claims", {
  bountyId: integer("bounty_id").primaryKey(),
  repo: text("repo").notNull(),
  prNumber: integer("pr_number").notNull(),
  prUrl: text("pr_url").notNull(),
  prTitle: text("pr_title").notNull(),
  prBody: text("pr_body").notNull(),
  author: text("author").notNull(),
  mergedBy: text("merged_by"),
  mergedAt: text("merged_at").notNull(),
  baseRef: text("base_ref").notNull(),
  headSha: text("head_sha").notNull(),
  mergeCommitSha: text("merge_commit_sha"),
  closedAt: text("closed_at").notNull(),
  detectedAt: integer("detected_at").notNull(),
  verdict: text("verdict", { mode: "json" }).$type<import("@mba/shared").ReviewVerdict>(),
  reviewModel: text("review_model"),
  reviewedAt: integer("reviewed_at"),
  reviewError: text("review_error"),
  reviewAttempts: integer("review_attempts").notNull().default(0),
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
  mandate_commitment TEXT,
  payees TEXT NOT NULL,
  funded TEXT NOT NULL DEFAULT '0',
  spent TEXT NOT NULL DEFAULT '0',
  created_tx TEXT NOT NULL,
  created_block INTEGER NOT NULL,
  title TEXT,
  acceptance_criteria TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  status_reason TEXT,
  review_override INTEGER NOT NULL DEFAULT 0,
  paid_tx TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS claims (
  bounty_id INTEGER PRIMARY KEY,
  repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  pr_url TEXT NOT NULL,
  pr_title TEXT NOT NULL,
  pr_body TEXT NOT NULL,
  author TEXT NOT NULL,
  merged_by TEXT,
  merged_at TEXT NOT NULL,
  base_ref TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  merge_commit_sha TEXT,
  closed_at TEXT NOT NULL,
  detected_at INTEGER NOT NULL,
  verdict TEXT,
  review_model TEXT,
  reviewed_at INTEGER,
  review_error TEXT,
  review_attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS mandate_proofs (
  bounty_id INTEGER PRIMARY KEY,
  state TEXT NOT NULL,
  reasons TEXT NOT NULL,
  commitment TEXT,
  proof TEXT,
  public_signals TEXT,
  checked_at INTEGER,
  zk_job_id TEXT,
  zk_status TEXT,
  zk_tx_hash TEXT,
  zk_aggregation_id INTEGER,
  zk_domain_id INTEGER,
  zk_statement TEXT,
  zk_aggregation TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS payouts (
  bounty_id INTEGER PRIMARY KEY,
  state TEXT NOT NULL,
  payee TEXT NOT NULL,
  amount TEXT NOT NULL,
  tx_hash TEXT,
  paid_at INTEGER,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS work_proofs (
  bounty_id INTEGER PRIMARY KEY,
  proof TEXT,
  claim TEXT,
  identifier TEXT,
  signers TEXT,
  attested_at INTEGER,
  verified_at INTEGER,
  failure_code TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0
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

/** Columns added after a table first shipped; applied with ALTER TABLE when missing. */
export const ADDED_COLUMNS: { table: string; column: string; ddl: string }[] = [
  { table: "bounties", column: "status", ddl: "ALTER TABLE bounties ADD COLUMN status TEXT NOT NULL DEFAULT 'open'" },
  { table: "bounties", column: "status_reason", ddl: "ALTER TABLE bounties ADD COLUMN status_reason TEXT" },
  { table: "bounties", column: "mandate_commitment", ddl: "ALTER TABLE bounties ADD COLUMN mandate_commitment TEXT" },
  { table: "bounties", column: "review_override", ddl: "ALTER TABLE bounties ADD COLUMN review_override INTEGER NOT NULL DEFAULT 0" },
  { table: "bounties", column: "paid_tx", ddl: "ALTER TABLE bounties ADD COLUMN paid_tx TEXT" },
];

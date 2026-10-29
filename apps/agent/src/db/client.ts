import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.ts";

export type Db = BetterSQLite3Database<typeof schema>;

/** Opens (and migrates) the SQLite database. Pass ":memory:" for tests. */
export function openDb(file: string): { db: Db; close: () => void } {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(schema.MIGRATION_SQL);
  for (const { table, column, ddl } of schema.ADDED_COLUMNS) {
    const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) sqlite.exec(ddl);
  }
  return { db: drizzle(sqlite, { schema }), close: () => sqlite.close() };
}

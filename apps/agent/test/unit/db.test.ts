import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getBounty, listBounties } from "../../src/bounties.ts";
import { applyVaultEvents } from "../../src/chain/events.ts";
import { openDb } from "../../src/db/client.ts";
import { fundings } from "../../src/db/schema.ts";
import { COMMITMENT, VAULT, createdEvent, fundedEvent } from "./fixtures.ts";

const ctx = { chainId: 31337, vault: VAULT };
let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("SQLite persistence", () => {
  it("survives closing and reopening the database file", () => {
    dir = mkdtempSync(path.join(tmpdir(), "mba-db-"));
    const file = path.join(dir, "nested", "bounties.sqlite");

    const first = openDb(file);
    applyVaultEvents(first.db, ctx, [createdEvent(1), fundedEvent(1, 100n, 100n, 1)]);
    first.close();

    const second = openDb(file);
    const b = getBounty(second.db, 1);
    second.close();
    expect(b).toMatchObject({ id: 1, funded: "100", vault: VAULT.toLowerCase(), chainId: 31337 });
  });

  it("migrations are idempotent across reopen", () => {
    dir = mkdtempSync(path.join(tmpdir(), "mba-db-"));
    const file = path.join(dir, "b.sqlite");
    openDb(file).close();
    expect(() => openDb(file).close()).not.toThrow();
  });
});

describe("applyVaultEvents", () => {
  it("replaying the same events leaves the same state", () => {
    const { db } = openDb(":memory:");
    const events = [createdEvent(1), fundedEvent(1, 100n, 100n, 1), fundedEvent(1, 50n, 150n, 2)];
    applyVaultEvents(db, ctx, events);
    applyVaultEvents(db, ctx, events);
    expect(getBounty(db, 1)?.funded).toBe("150");
    expect(db.select().from(fundings).all()).toHaveLength(2);
  });

  it("keeps off-chain metadata when the creation event is re-synced", async () => {
    const { db } = openDb(":memory:");
    applyVaultEvents(db, ctx, [createdEvent(1)]);
    const { bounties } = await import("../../src/db/schema.ts");
    db.update(bounties).set({ title: "Keep me" }).run();
    applyVaultEvents(db, ctx, [createdEvent(1)]);
    expect(getBounty(db, 1)?.title).toBe("Keep me");
  });

  it("applies mandate updates", () => {
    const { db } = openDb(":memory:");
    applyVaultEvents(db, ctx, [
      createdEvent(1),
      {
        kind: "mandateUpdated",
        id: 1n,
        mandate: { perPayoutCap: 300n, totalBudget: 900n, expiry: 2_100_000_000n, commitment: COMMITMENT },
        payees: ["0x000000000000000000000000000000000000BEEF"],
        txHash: `0x${"ab".repeat(32)}`,
        logIndex: 0,
        blockNumber: 500n,
      },
    ]);
    expect(getBounty(db, 1)?.mandate).toEqual({
      perPayoutCap: "300",
      totalBudget: "900",
      expiry: 2_100_000_000,
      allowedPayees: ["0x000000000000000000000000000000000000beef"],
      commitment: COMMITMENT,
    });
  });

  it("lists newest first", () => {
    const { db } = openDb(":memory:");
    applyVaultEvents(db, ctx, [createdEvent(1), createdEvent(2), createdEvent(3)]);
    expect(listBounties(db).map((b) => b.id)).toEqual([3, 2, 1]);
  });
});

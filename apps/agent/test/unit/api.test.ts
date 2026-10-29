import type { BountyDto } from "@mba/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { openDb } from "../../src/db/client.ts";
import { ALICE, createdEvent, fakeReader, fundedEvent, tx } from "./fixtures.ts";

const valid = { txHash: tx(1), title: "Fix widget overflow", acceptanceCriteria: "Widgets no longer overflow the grid on mobile." };

function setup() {
  const { db } = openDb(":memory:");
  const chain = fakeReader({
    [tx(1)]: [createdEvent(1), fundedEvent(1, 600_000_000n, 600_000_000n, 1)],
    [tx(2)]: [fundedEvent(1, 1n, 600_000_001n, 2)],
    [tx(3)]: null,
  });
  return createApp({ db, chain, corsOrigins: ["http://localhost:3000"] });
}

const post = (app: ReturnType<typeof setup>, body: unknown) =>
  app.request("/bounties", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("POST /bounties validation", () => {
  let app: ReturnType<typeof setup>;
  beforeEach(() => {
    app = setup();
  });

  it.each([
    ["missing body", undefined, "txHash"],
    ["malformed tx hash", { ...valid, txHash: "0x1234" }, "txHash"],
    ["short title", { ...valid, title: "ab" }, "title"],
    ["short acceptance criteria", { ...valid, acceptanceCriteria: "ok" }, "acceptanceCriteria"],
    ["oversized title", { ...valid, title: "x".repeat(201) }, "title"],
  ])("rejects %s with 400", async (_name, body, field) => {
    const res = await post(app, body);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; issues: { path: string }[] };
    expect(json.error).toBe("invalid request");
    if (body !== undefined) expect(json.issues.map((i) => i.path)).toContain(field);
  });

  it("rejects non-JSON bodies with 400", async () => {
    const res = await app.request("/bounties", { method: "POST", body: "not json" });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown or reverted tx with 422", async () => {
    const res = await post(app, { ...valid, txHash: tx(3) });
    expect(res.status).toBe(422);
  });

  it("rejects a tx that only funds, without creating, with 422", async () => {
    const res = await post(app, { ...valid, txHash: tx(2) });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toMatch(/did not create/);
  });

  it("rejects an on-chain bounty that breaks shared invariants", async () => {
    const { db } = openDb(":memory:");
    const chain = fakeReader({ [tx(9)]: [createdEvent(9, { repo: "not a repo" })] });
    const res = await post(createApp({ db, chain, corsOrigins: [] }), { ...valid, txHash: tx(9) });
    expect(res.status).toBe(422);
  });
});

describe("bounty routes", () => {
  it("registers from chain data, ignoring client-supplied money fields", async () => {
    const app = setup();
    const res = await post(app, { ...valid, payoutAmount: "999999999999" });
    expect(res.status).toBe(201);
    const b = (await res.json()) as BountyDto;
    expect(b).toMatchObject({
      id: 1,
      repo: "acme/widgets",
      issueNumber: 42,
      payoutAmount: "250000000",
      funded: "600000000",
      spent: "0",
      title: valid.title,
      acceptanceCriteria: valid.acceptanceCriteria,
      mandate: { perPayoutCap: "500000000", totalBudget: "1000000000", expiry: 2_000_000_000, allowedPayees: [ALICE.toLowerCase()] },
    });
  });

  it("lists and fetches registered bounties", async () => {
    const app = setup();
    await post(app, valid);
    const list = (await (await app.request("/bounties")).json()) as BountyDto[];
    expect(list.map((b) => b.id)).toEqual([1]);
    const one = await app.request("/bounties/1");
    expect(one.status).toBe(200);
    expect(((await one.json()) as BountyDto).title).toBe(valid.title);
  });

  it("returns 404 for a missing bounty and 400 for a bad id", async () => {
    const app = setup();
    expect((await app.request("/bounties/7")).status).toBe(404);
    expect((await app.request("/bounties/abc")).status).toBe(400);
    expect((await app.request("/bounties/-1")).status).toBe(400);
  });

  it("is idempotent when the same tx is registered twice", async () => {
    const app = setup();
    await post(app, valid);
    const again = await post(app, { ...valid, title: "Renamed bounty" });
    expect(again.status).toBe(201);
    const list = (await (await app.request("/bounties")).json()) as BountyDto[];
    expect(list).toHaveLength(1);
    expect(list[0]?.title).toBe("Renamed bounty");
    expect(list[0]?.funded).toBe("600000000");
  });

  it("allows the configured web origin via CORS", async () => {
    const res = await setup().request("/bounties", { headers: { origin: "http://localhost:3000" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });
});

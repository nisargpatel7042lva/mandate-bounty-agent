import { CreateBountyRequestSchema, type ApiError } from "@mba/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { BountyError, getBounty, listBounties, registerBounty, type VaultReader } from "./bounties.ts";
import type { Db } from "./db/client.ts";
import type { Watcher } from "./watcher.ts";

export interface AppDeps {
  db: Db;
  chain: VaultReader;
  /** Optional: without it, POST /bounties/:id/check returns 503. */
  watcher?: Watcher | undefined;
  /** Browser origins allowed to call the API (the web dashboard). */
  corsOrigins: string[];
}

const parseId = (raw: string) => {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

export function createApp({ db, chain, watcher, corsOrigins }: AppDeps) {
  const app = new Hono();
  app.use("*", cors({ origin: corsOrigins }));

  app.get("/health", (c) => c.json({ ok: true, chainId: chain.chainId, vault: chain.vault, watcher: Boolean(watcher) }));

  app.get("/bounties", (c) => c.json(listBounties(db)));

  app.get("/bounties/:id", (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return c.json<ApiError>({ error: "id must be a positive integer" }, 400);
    const bounty = getBounty(db, id);
    return bounty ? c.json(bounty) : c.json<ApiError>({ error: "bounty not found" }, 404);
  });

  app.post("/bounties", async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const parsed = CreateBountyRequestSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
      return c.json<ApiError>({ error: "invalid request", issues }, 400);
    }
    try {
      return c.json(await registerBounty(db, chain, parsed.data), 201);
    } catch (err) {
      if (err instanceof BountyError) return c.json<ApiError>({ error: err.message }, err.status);
      throw err;
    }
  });

  // Runs detection + review now instead of waiting for the next poll. Safe to call repeatedly.
  app.post("/bounties/:id/check", async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return c.json<ApiError>({ error: "id must be a positive integer" }, 400);
    if (!getBounty(db, id)) return c.json<ApiError>({ error: "bounty not found" }, 404);
    if (!watcher) return c.json<ApiError>({ error: "GitHub watcher is not configured on this agent" }, 503);
    try {
      const step = await watcher.check(id);
      return c.json({ step, bounty: getBounty(db, id) });
    } catch (err) {
      return c.json<ApiError>({ error: `check failed: ${(err as Error).message}` }, 502);
    }
  });

  return app;
}

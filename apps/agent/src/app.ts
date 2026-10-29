import { CreateBountyRequestSchema, type ApiError } from "@mba/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { BountyError, getBounty, listBounties, registerBounty, type VaultReader } from "./bounties.ts";
import type { Db } from "./db/client.ts";

export interface AppDeps {
  db: Db;
  chain: VaultReader;
  /** Browser origins allowed to call the API (the web dashboard). */
  corsOrigins: string[];
}

export function createApp({ db, chain, corsOrigins }: AppDeps) {
  const app = new Hono();
  app.use("*", cors({ origin: corsOrigins }));

  app.get("/health", (c) => c.json({ ok: true, chainId: chain.chainId, vault: chain.vault }));

  app.get("/bounties", (c) => c.json(listBounties(db)));

  app.get("/bounties/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isSafeInteger(id) || id <= 0) return c.json<ApiError>({ error: "id must be a positive integer" }, 400);
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

  return app;
}

import { expect, it } from "vitest";
import { app } from "../src/app.js";

it("GET /health returns ok", async () => {
  const res = await app.request("/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

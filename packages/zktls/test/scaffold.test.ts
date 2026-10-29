import { expect, it } from "vitest";
import { ZKTLS_PROVIDER } from "../src/index.js";

it("package is wired", () => {
  expect(ZKTLS_PROVIDER).toBe("reclaim-zkfetch");
});

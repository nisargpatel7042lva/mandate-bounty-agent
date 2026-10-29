import { expect, it } from "vitest";
import { ZKVERIFY_TESTNET } from "../src/index.ts";

it("package is wired", () => {
  expect(ZKVERIFY_TESTNET.rpc).toMatch(/^wss:\/\//);
});

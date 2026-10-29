import { expect, it } from "vitest";
import { PROOF_SYSTEM } from "../src/index.js";

it("package is wired", () => {
  expect(PROOF_SYSTEM.system).toBe("groth16");
});

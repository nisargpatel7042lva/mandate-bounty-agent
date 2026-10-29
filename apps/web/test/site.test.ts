import { expect, it } from "vitest";
import { SITE } from "../lib/site";

it("package is wired", () => {
  expect(SITE.tagline).toContain("proofs dispose");
});

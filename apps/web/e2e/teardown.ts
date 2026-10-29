import { spawnSync } from "node:child_process";
import { E2E } from "./ports.ts";

// Playwright kills the webServer process tree, but on Windows that does not always reach the
// anvil process running inside WSL.
export default function teardown() {
  if (process.platform === "win32") spawnSync("wsl", ["pkill", "-f", `anvil --port ${E2E.anvilPort}`], { stdio: "ignore" });
}

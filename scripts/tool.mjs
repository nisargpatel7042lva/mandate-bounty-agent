// Runs a native toolchain command (forge, circom) in the current package directory.
// On Windows it goes through WSL, where Foundry and circom are installed; elsewhere it runs directly.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toWsl = (p) => p.replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`).replaceAll("\\", "/");

const args = process.argv.slice(2);
const isWin = process.platform === "win32";
const helper = path.join(path.dirname(fileURLToPath(import.meta.url)), "wsl-exec.sh");
const [cmd, cmdArgs] = isWin
  ? ["wsl", ["bash", toWsl(helper), toWsl(process.cwd()), ...args]]
  : [args[0], args.slice(1)];

const result = spawnSync(cmd, cmdArgs, { stdio: "inherit" });
process.exit(result.status ?? 1);

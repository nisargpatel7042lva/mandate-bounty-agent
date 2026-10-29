import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Integration tests read real-service credentials (ANTHROPIC_API_KEY, GITHUB_*) from the repo-root
// .env when it exists. Variables already set in the shell take precedence.
const rootEnv = new URL("../../.env", import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({});

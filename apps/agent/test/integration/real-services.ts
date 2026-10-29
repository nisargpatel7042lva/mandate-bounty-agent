// Shared setup for integration tests that hit real GitHub and the real Claude API.
// Missing prerequisites fail the test with instructions; they are never skipped silently.
import { loadEnv, resolveGitHubToken } from "../../src/env.ts";
import { createReviewerFromEnv } from "../../src/review/index.ts";
import type { Reviewer } from "../../src/review/reviewer.ts";

export const DEMO_REPO = "nisargpatel7042lva/mba-demo";
/** Closed by merged PR #3 ("Wrap widgets on narrow screens"). */
export const DEMO_BOUNTY_ISSUE = 1;
export const DEMO_PR = 3;
/** Kept open on purpose. */
export const DEMO_OPEN_ISSUE = 2;
export const DEMO_CRITERIA = `- Widgets wrap onto new lines instead of overflowing on screens narrower than 400px.
- The 12px gap between widgets is kept when they wrap.
- No horizontal page scroll at 360px width.`;

const baseEnv = { RPC_URL: "http://unused.test", CHAIN_ID: "1", VAULT_ADDRESS: `0x${"0".repeat(40)}`, VAULT_DEPLOY_BLOCK: "0" };

export function githubToken(): string {
  const env = loadEnv({ ...baseEnv, ...process.env, GITHUB_TOKEN_COMMAND: process.env.GITHUB_TOKEN_COMMAND ?? "gh auth token" });
  const token = resolveGitHubToken(env);
  if (!token) throw new Error("GitHub integration tests need GITHUB_TOKEN, or the GitHub CLI logged in (`gh auth login`).");
  return token;
}

/** The reviewer the agent itself would use, chosen from the same environment variables. */
export function realReviewer(): { reviewer: Reviewer; label: string } {
  const choice = createReviewerFromEnv(loadEnv({ ...baseEnv, ...process.env }));
  if (!choice.reviewer) {
    throw new Error(`LLM review integration tests need a key: ${choice.reason}. Set GEMINI_API_KEY or ANTHROPIC_API_KEY in the root .env.`);
  }
  return choice;
}

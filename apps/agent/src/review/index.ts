import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../env.ts";
import { createGeminiReviewer, GEMINI_DEFAULT_MODEL } from "./gemini.ts";
import { createClaudeReviewer, REVIEW_MODEL, type Reviewer } from "./reviewer.ts";

export type ReviewerChoice = { reviewer: Reviewer; label: string } | { reviewer: undefined; reason: string };

type ReviewEnv = Pick<Env, "REVIEW_PROVIDER" | "ANTHROPIC_API_KEY" | "GEMINI_API_KEY" | "GEMINI_MODEL" | "GEMINI_BASE_URL">;

/** Picks the review provider from the environment. Returns a reason instead when no key is usable. */
export function createReviewerFromEnv(env: ReviewEnv): ReviewerChoice {
  const provider = env.REVIEW_PROVIDER ?? (env.ANTHROPIC_API_KEY ? "claude" : env.GEMINI_API_KEY ? "gemini" : undefined);
  if (provider === "claude") {
    if (!env.ANTHROPIC_API_KEY) return { reviewer: undefined, reason: "REVIEW_PROVIDER=claude but ANTHROPIC_API_KEY is not set" };
    return { reviewer: createClaudeReviewer(new Anthropic()), label: `claude (${REVIEW_MODEL})` };
  }
  if (provider === "gemini") {
    if (!env.GEMINI_API_KEY) return { reviewer: undefined, reason: "REVIEW_PROVIDER=gemini but GEMINI_API_KEY is not set" };
    const model = env.GEMINI_MODEL ?? GEMINI_DEFAULT_MODEL;
    return {
      reviewer: createGeminiReviewer({ apiKey: env.GEMINI_API_KEY, model, ...(env.GEMINI_BASE_URL ? { baseUrl: env.GEMINI_BASE_URL } : {}) }),
      label: `gemini (${model})`,
    };
  }
  return { reviewer: undefined, reason: "no review key set (GEMINI_API_KEY or ANTHROPIC_API_KEY)" };
}

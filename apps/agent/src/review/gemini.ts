// Gemini reviewer over the REST generateContent endpoint (no SDK dependency). Same prompt, same
// advisory-only contract and the same final schema gate as the Claude reviewer.
import { buildReviewMessage, checkVerdict, MAX_DIFF_CHARS, oversizedDiffOutcome, SYSTEM_PROMPT, type ReviewOutcome, type Reviewer } from "./reviewer.ts";

// Measured on 2026-10-29 with this project's key: gemini-3.8-flash is listed but never answered
// (75s+); gemini-3.5-flash answered in ~2s but returned 429/503 on 2 of 6 calls under demand;
// gemini-2.5-flash answered 6 of 6. So 3.5 is primary and 2.5 is the overload fallback.
export const GEMINI_DEFAULT_MODEL = "gemini-3.5-flash";
export const GEMINI_FALLBACK_MODEL = "gemini-2.5-flash";
const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";
/** A hung request must not stall the watcher; a timeout is reported as retryable. */
export const GEMINI_TIMEOUT_MS = 120_000;

/** OpenAPI-subset schema for responseSchema. Ranges and lengths are re-checked by checkVerdict. */
export const GEMINI_VERDICT_SCHEMA = {
  type: "OBJECT",
  properties: {
    recommendation: { type: "STRING", enum: ["approve", "reject", "needs_human"] },
    criteriaMet: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { criterion: { type: "STRING" }, met: { type: "BOOLEAN" }, evidence: { type: "STRING" } },
        required: ["criterion", "met", "evidence"],
      },
    },
    summary: { type: "STRING" },
    confidence: { type: "NUMBER" },
  },
  required: ["recommendation", "criteriaMet", "summary", "confidence"],
} as const;

interface GenerateContentResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  modelVersion?: string;
}

/** Exponential backoff (1s, 2s, ...) unless the server sends Retry-After; capped at 30s. */
export function backoffMs(attempt: number, retryAfter: string | null): number {
  const seconds = retryAfter !== null ? Number(retryAfter) : NaN;
  return Math.min(Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 1000 * 2 ** attempt, 30_000);
}

export interface GeminiReviewerOptions {
  apiKey: string;
  model?: string;
  /** Tried in order when the primary model stays overloaded. Default: [GEMINI_FALLBACK_MODEL]. */
  fallbackModels?: string[];
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export function createGeminiReviewer(opts: GeminiReviewerOptions): Reviewer {
  const primary = opts.model ?? GEMINI_DEFAULT_MODEL;
  // Overload (429 / 503) is per model; when the primary stays unavailable, ask the next one.
  const models = [primary, ...(opts.fallbackModels ?? [GEMINI_FALLBACK_MODEL])].filter((m, i, all) => all.indexOf(m) === i);
  const base = (opts.baseUrl ?? GEMINI_API).replace(/\/$/, "");
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? GEMINI_TIMEOUT_MS;
  const maxRetries = opts.maxRetries ?? 2;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const callModel = async (model: string, body: string): Promise<ReviewOutcome> => {
    // Like the Anthropic SDK's default, retry 429 / 5xx / connection errors twice before reporting.
    // Timeouts are not retried here: a hung model would hold the watcher for minutes.
    let res: Response | undefined;
    let lastError = "";
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        res = await doFetch(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          // Key in a header, never the URL, so it cannot end up in proxy or access logs.
          headers: { "content-type": "application/json", "x-goog-api-key": opts.apiKey },
          signal: AbortSignal.timeout(timeoutMs),
          body,
        });
      } catch (err) {
        const e = err as Error;
        if (e.name === "TimeoutError") return { ok: false, retryable: true, error: `Gemini (${model}) did not answer within ${Math.round(timeoutMs / 1000)}s` };
        lastError = `Gemini API unreachable: ${e.message}`;
        res = undefined;
        if (attempt < maxRetries) await sleep(backoffMs(attempt, null));
        continue;
      }
      if (res.ok) break;
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      lastError = `Gemini API error ${res.status}: ${detail}`.trim();
      if (res.status !== 429 && res.status < 500) return { ok: false, retryable: false, error: lastError };
      if (attempt < maxRetries) await sleep(backoffMs(attempt, res.headers.get("retry-after")));
    }
    if (!res?.ok) return { ok: false, retryable: true, error: lastError };

    const json = (await res.json()) as GenerateContentResponse;
    if (json.promptFeedback?.blockReason) return { ok: false, retryable: false, error: `Gemini declined the prompt (${json.promptFeedback.blockReason})` };

    const candidate = json.candidates?.[0];
    const reason = candidate?.finishReason;
    if (reason === "MAX_TOKENS") return { ok: false, retryable: false, error: "review hit the output token limit before finishing" };
    if (reason && reason !== "STOP") return { ok: false, retryable: false, error: `Gemini stopped early (${reason})` };

    const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, retryable: false, error: "review did not return parseable JSON" };
    }
    return checkVerdict(parsed, json.modelVersion ?? model);
  };

  return {
    async review(input) {
      if (input.diff.length > MAX_DIFF_CHARS) return oversizedDiffOutcome(input.diff.length);

      const body = JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: buildReviewMessage(input) }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: GEMINI_VERDICT_SCHEMA, maxOutputTokens: 16000 },
      });

      const errors: string[] = [];
      for (const model of models) {
        const out = await callModel(model, body);
        // A definite answer (verdict, refusal, bad output, bad key) ends the chain; only
        // "temporarily unavailable" moves on to the next model.
        if (out.ok || !out.retryable) return out;
        errors.push(`${model}: ${out.error}`);
      }
      return { ok: false, retryable: true, error: `all Gemini models unavailable (${errors.join("; ")})` };
    },
  };
}

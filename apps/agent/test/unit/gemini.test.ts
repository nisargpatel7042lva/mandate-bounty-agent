import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/env.ts";
import { backoffMs, createGeminiReviewer, GEMINI_DEFAULT_MODEL, GEMINI_FALLBACK_MODEL, GEMINI_VERDICT_SCHEMA } from "../../src/review/gemini.ts";
import { createReviewerFromEnv } from "../../src/review/index.ts";
import { MAX_DIFF_CHARS, SYSTEM_PROMPT, type ReviewInput } from "../../src/review/reviewer.ts";
import { SAMPLE_DIFF } from "./github-fixtures.ts";

const input: ReviewInput = {
  repo: "acme/widgets",
  issueNumber: 42,
  issueTitle: "Widgets overflow on mobile",
  issueBody: "Below 400px the grid overflows.",
  acceptanceCriteria: "Widgets wrap instead of overflowing below 400px.",
  pr: { number: 7, title: "Wrap widgets", body: "Closes #42", author: "octocat" },
  diff: SAMPLE_DIFF,
};

const verdict = {
  recommendation: "approve",
  criteriaMet: [{ criterion: "Widgets wrap below 400px", met: true, evidence: "grid.css adds flex-wrap" }],
  summary: "Adds flex-wrap.",
  confidence: 0.8,
};

const noSleep = async () => undefined;

/** Response shaped like generateContent's GenerateContentResponse. */
const ok = (text: string, finishReason = "STOP") =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason }], modelVersion: "gemini-3.8-flash-001" }), { status: 200 });

function fake(respond: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond();
  }) as typeof fetch;
  return { fn, calls };
}

describe("Gemini reviewer", () => {
  it("calls generateContent with the key in a header and JSON mode, and validates the verdict", async () => {
    const f = fake(() => ok(JSON.stringify(verdict)));
    const out = await createGeminiReviewer({ apiKey: "g-key", fetch: f.fn }).review(input);
    expect(out).toEqual({ ok: true, verdict, model: "gemini-3.8-flash-001" });

    const call = f.calls[0];
    expect(call?.url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_DEFAULT_MODEL}:generateContent`);
    expect(call?.url).not.toContain("g-key");
    expect((call?.init.headers as Record<string, string>)["x-goog-api-key"]).toBe("g-key");
    const body = JSON.parse(String(call?.init.body)) as {
      systemInstruction: { parts: { text: string }[] };
      contents: { parts: { text: string }[] }[];
      generationConfig: { responseMimeType: string; responseSchema: unknown };
    };
    expect(body.systemInstruction.parts[0]?.text).toBe(SYSTEM_PROMPT);
    expect(body.contents[0]?.parts[0]?.text).toContain("<acceptance_criteria>");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema).toEqual(GEMINI_VERDICT_SCHEMA);
  });

  it("fails closed when the JSON breaks the shared schema", async () => {
    const out = await createGeminiReviewer({ apiKey: "k", fetch: fake(() => ok(JSON.stringify({ ...verdict, confidence: 7 }))).fn }).review(input);
    expect(out).toMatchObject({ ok: false, retryable: false, error: expect.stringMatching(/confidence/) });
  });

  it.each([
    ["unparseable text", () => ok("not json"), false, /parseable/],
    ["MAX_TOKENS", () => ok("{", "MAX_TOKENS"), false, /token limit/],
    ["SAFETY stop", () => ok("", "SAFETY"), false, /SAFETY/],
    ["blocked prompt", () => new Response(JSON.stringify({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } })), false, /declined/],
    ["rate limit", () => new Response("quota", { status: 429 }), true, /429/],
    ["server error", () => new Response("oops", { status: 503 }), true, /503/],
    ["bad key", () => new Response("API key not valid", { status: 400 }), false, /400/],
  ])("handles %s", async (_n, respond, retryable, msg) => {
    const out = await createGeminiReviewer({ apiKey: "k", fetch: fake(respond).fn, sleep: noSleep }).review(input);
    expect(out).toMatchObject({ ok: false, retryable, error: expect.stringMatching(msg) });
  });

  it("treats a network failure as retryable", async () => {
    const out = await createGeminiReviewer({ apiKey: "k", fetch: fake(() => Promise.reject(new Error("ECONNRESET"))).fn, sleep: noSleep }).review(input);
    expect(out).toMatchObject({ ok: false, retryable: true });
  });

  it("retries a transient 503 and then succeeds", async () => {
    const responses = [new Response("overloaded", { status: 503 }), ok(JSON.stringify(verdict))];
    const f = fake(() => responses.shift() as Response);
    const waits: number[] = [];
    const out = await createGeminiReviewer({ apiKey: "k", fetch: f.fn, sleep: async (ms) => void waits.push(ms) }).review(input);
    expect(out.ok).toBe(true);
    expect(f.calls).toHaveLength(2);
    expect(waits).toEqual([1000]);
  });

  it("stops after two retries, and never retries a client error", async () => {
    const busy = fake(() => new Response("busy", { status: 429, headers: { "retry-after": "3" } }));
    const waits: number[] = [];
    const out = await createGeminiReviewer({ apiKey: "k", fetch: busy.fn, fallbackModels: [], sleep: async (ms) => void waits.push(ms) }).review(input);
    expect(out).toMatchObject({ ok: false, retryable: true });
    expect(busy.calls).toHaveLength(3);
    expect(waits).toEqual([3000, 3000]);

    const bad = fake(() => new Response("API key not valid", { status: 400 }));
    await createGeminiReviewer({ apiKey: "k", fetch: bad.fn, sleep: noSleep }).review(input);
    expect(bad.calls).toHaveLength(1);
  });

  it("falls back to the next model when the primary stays overloaded", async () => {
    const f = fake(() => new Response("high demand", { status: 503 }));
    const fallback = fake(() => ok(JSON.stringify(verdict)));
    const route = (async (url: string | URL | Request, init?: RequestInit) =>
      String(url).includes("gemini-2.5-flash") ? fallback.fn(url, init) : f.fn(url, init)) as typeof fetch;

    const out = await createGeminiReviewer({ apiKey: "k", fetch: route, sleep: noSleep }).review(input);
    expect(out.ok).toBe(true);
    expect(f.calls).toHaveLength(3); // primary: first try + 2 retries
    expect(f.calls[0]?.url).toContain(`/models/${GEMINI_DEFAULT_MODEL}:`);
    expect(fallback.calls).toHaveLength(1);
    expect(fallback.calls[0]?.url).toContain(`/models/${GEMINI_FALLBACK_MODEL}:`);
  });

  it("does not fall back on a definite answer, and reports every model when all are down", async () => {
    const reject = fake(() => ok(JSON.stringify({ ...verdict, recommendation: "reject" })));
    const out = await createGeminiReviewer({ apiKey: "k", fetch: reject.fn, sleep: noSleep }).review(input);
    expect(out.ok && out.verdict.recommendation).toBe("reject");
    expect(reject.calls).toHaveLength(1);

    const down = fake(() => new Response("high demand", { status: 503 }));
    const all = await createGeminiReviewer({ apiKey: "k", fetch: down.fn, sleep: noSleep, fallbackModels: ["m2", "m3"] }).review(input);
    expect(all).toMatchObject({ ok: false, retryable: true, error: expect.stringMatching(/all Gemini models unavailable.*m2.*m3/) });
    expect(down.calls).toHaveLength(9);
  });

  it("backs off exponentially, honours Retry-After, and caps the wait", () => {
    expect([0, 1, 2].map((a) => backoffMs(a, null))).toEqual([1000, 2000, 4000]);
    expect(backoffMs(0, "7")).toBe(7000);
    expect(backoffMs(0, "600")).toBe(30_000);
    expect(backoffMs(1, "soon")).toBe(2000);
  });

  it("gives up on a hung request after the timeout and marks it retryable", async () => {
    // Honour the abort signal like real fetch does.
    const hang = (async (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)))) as typeof fetch;
    const out = await createGeminiReviewer({ apiKey: "k", fetch: hang, timeoutMs: 50 }).review(input);
    expect(out).toMatchObject({ ok: false, retryable: true, error: expect.stringMatching(/did not answer within/) });
  });

  it("does not call the API for an oversized diff", async () => {
    const f = fake(() => ok(JSON.stringify(verdict)));
    const out = await createGeminiReviewer({ apiKey: "k", fetch: f.fn }).review({ ...input, diff: "x".repeat(MAX_DIFF_CHARS + 1) });
    expect(f.calls).toHaveLength(0);
    expect(out.ok && out.verdict.recommendation).toBe("needs_human");
  });
});

describe("createReviewerFromEnv", () => {
  const base = { RPC_URL: "http://x.test", CHAIN_ID: "1", VAULT_ADDRESS: `0x${"1".repeat(40)}`, VAULT_DEPLOY_BLOCK: "0" };
  const pick = (extra: Record<string, string>) => createReviewerFromEnv(loadEnv({ ...base, ...extra }));

  it("uses Gemini when only a Gemini key is set, with the default or configured model", () => {
    expect(pick({ GEMINI_API_KEY: "g" })).toMatchObject({ label: `gemini (${GEMINI_DEFAULT_MODEL})` });
    expect(pick({ GEMINI_API_KEY: "g", GEMINI_MODEL: "gemini-4-argon" })).toMatchObject({ label: "gemini (gemini-4-argon)" });
  });

  it("prefers Claude when both keys are set, unless REVIEW_PROVIDER says otherwise", () => {
    expect(pick({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" })).toMatchObject({ label: expect.stringMatching(/^claude/) });
    expect(pick({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a", REVIEW_PROVIDER: "gemini" })).toMatchObject({ label: expect.stringMatching(/^gemini/) });
  });

  it("explains why there is no reviewer", () => {
    expect(pick({})).toMatchObject({ reviewer: undefined, reason: expect.stringMatching(/no review key/) });
    expect(pick({ GEMINI_API_KEY: "placeholder" })).toMatchObject({ reviewer: undefined });
    expect(pick({ REVIEW_PROVIDER: "gemini" })).toMatchObject({ reason: expect.stringMatching(/GEMINI_API_KEY is not set/) });
  });
});

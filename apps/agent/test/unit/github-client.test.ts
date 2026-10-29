import { describe, expect, it } from "vitest";
import { createGitHubClient, GitHubError, ISSUE_CLOSE_QUERY } from "../../src/github/client.ts";
import { resolveGitHubToken, loadEnv } from "../../src/env.ts";
import { closedIssue, mergedPr, SAMPLE_DIFF } from "./github-fixtures.ts";

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("GitHub client", () => {
  it("queries GraphQL with the bearer token and parses the issue", async () => {
    const f = fakeFetch(() => json({ data: { repository: { issue: closedIssue(mergedPr()) } } }));
    const gh = createGitHubClient({ token: "t0k3n", apiUrl: "https://gh.test/", fetch: f.fn });
    const issue = await gh.issueCloseInfo("acme/widgets", 42);

    expect(issue.state).toBe("CLOSED");
    expect(f.calls[0]?.url).toBe("https://gh.test/graphql");
    const headers = f.calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer t0k3n");
    const body = JSON.parse(String(f.calls[0]?.init.body)) as { query: string; variables: unknown };
    expect(body.query).toBe(ISSUE_CLOSE_QUERY);
    expect(body.variables).toEqual({ owner: "acme", name: "widgets", number: 42 });
  });

  it("requests the diff media type", async () => {
    const f = fakeFetch(() => new Response(SAMPLE_DIFF));
    const gh = createGitHubClient({ token: "t", apiUrl: "https://gh.test", fetch: f.fn });
    expect(await gh.pullDiff("acme/widgets", 7)).toBe(SAMPLE_DIFF);
    expect(f.calls[0]?.url).toBe("https://gh.test/repos/acme/widgets/pulls/7");
    expect((f.calls[0]?.init.headers as Record<string, string>).accept).toBe("application/vnd.github.diff");
  });

  it.each([
    [401, /check GITHUB_TOKEN/],
    [403, /rate limited/],
    [500, /HTTP 500/],
  ])("surfaces HTTP %i as a GitHubError", async (status, msg) => {
    const gh = createGitHubClient({ token: "t", fetch: fakeFetch(() => json({ message: "nope" }, status)).fn });
    const err = await gh.issueCloseInfo("acme/widgets", 1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect((err as GitHubError).status).toBe(status);
    expect((err as Error).message).toMatch(msg);
  });

  it("treats GraphQL errors and missing issues as failures", async () => {
    const withErrors = createGitHubClient({ token: "t", fetch: fakeFetch(() => json({ errors: [{ message: "Could not resolve" }] })).fn });
    await expect(withErrors.issueCloseInfo("acme/widgets", 1)).rejects.toThrow(/Could not resolve/);
    const missing = createGitHubClient({ token: "t", fetch: fakeFetch(() => json({ data: { repository: { issue: null } } })).fn });
    await expect(missing.issueCloseInfo("acme/widgets", 1)).rejects.toThrow(/not found/);
  });
});

describe("resolveGitHubToken", () => {
  const base = { RPC_URL: "http://x.test", CHAIN_ID: "1", VAULT_ADDRESS: `0x${"1".repeat(40)}`, VAULT_DEPLOY_BLOCK: "0" };

  it("prefers GITHUB_TOKEN and ignores .env.example placeholders", () => {
    expect(resolveGitHubToken(loadEnv({ ...base, GITHUB_TOKEN: "real" }))).toBe("real");
    expect(resolveGitHubToken(loadEnv({ ...base, GITHUB_TOKEN: "ghp_placeholder" }))).toBeUndefined();
  });

  it("runs the token command without GITHUB_TOKEN in its environment", () => {
    // `gh auth token` echoes GITHUB_TOKEN when set, so a .env placeholder would leak through.
    const prev = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "ghp_placeholder";
    try {
      const env = loadEnv({ ...base, GITHUB_TOKEN_COMMAND: `node -e "process.stdout.write(process.env.GITHUB_TOKEN ?? 'stripped')"` });
      expect(resolveGitHubToken(env)).toBe("stripped");
    } finally {
      if (prev === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = prev;
    }
  });

  it("falls back to GITHUB_TOKEN_COMMAND output", () => {
    const env = loadEnv({ ...base, GITHUB_TOKEN_COMMAND: "gh auth token" });
    expect(resolveGitHubToken(env, () => "from-gh\n")).toBe("from-gh");
    expect(
      resolveGitHubToken(env, () => {
        throw new Error("gh missing");
      }),
    ).toBeUndefined();
  });
});

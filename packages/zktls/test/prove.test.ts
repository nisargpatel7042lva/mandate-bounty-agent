import { describe, expect, it } from "vitest";
import { loadTrustedAttestors } from "../src/attestors.ts";
import { GITHUB_GRAPHQL_URL, PAYEE_REGEX, PR_RESPONSE_REGEX, PROOF_MATCHES, prQueryBody } from "../src/github-pr.ts";
import { proveMergedPr, type ZkFetchClient } from "../src/prove.ts";
import { binding, signedProof } from "./fixtures.ts";

describe("proveMergedPr", () => {
  it("sends the token only privately and binds the request to the bounty", async () => {
    const calls: Parameters<ZkFetchClient["zkFetch"]>[] = [];
    const proof = await signedProof();
    const client: ZkFetchClient = { zkFetch: async (...args) => (calls.push(args), proof) };

    expect(await proveMergedPr(client, { repo: "nisargpatel7042lva/mba-demo", prNumber: 3, githubToken: "gho_secret", binding })).toBe(proof);
    const [url, pub, priv] = calls[0] ?? [];
    expect(url).toBe(GITHUB_GRAPHQL_URL);
    expect(pub).toMatchObject({ method: "POST", body: prQueryBody("nisargpatel7042lva/mba-demo", 3) });
    expect(pub?.context?.contextMessage).toContain("bounty=2");
    expect(JSON.stringify(pub)).not.toContain("gho_secret");
    expect(priv?.headers).toEqual({ authorization: "Bearer gho_secret" });
    expect(priv?.responseMatches).toEqual(PROOF_MATCHES);
    expect(priv?.responseMatches?.map((m) => m.value)).toEqual([PR_RESPONSE_REGEX, PAYEE_REGEX]);
  });

  it("fails loudly when zkFetch returns nothing", async () => {
    const client: ZkFetchClient = { zkFetch: async () => undefined };
    await expect(proveMergedPr(client, { repo: "a/b", prNumber: 1, githubToken: "t", binding })).rejects.toThrow(/no proof/);
  });
});

describe("loadTrustedAttestors", () => {
  it("prefers an explicit list and normalises it", async () => {
    const list = await loadTrustedAttestors(" 0xAbC0000000000000000000000000000000000001 ,junk", async () => {
      throw new Error("should not fetch");
    });
    expect(list).toEqual(["0xabc0000000000000000000000000000000000001"]);
  });

  it("falls back to Reclaim's published list, and refuses an empty one", async () => {
    expect(await loadTrustedAttestors(undefined, async () => [{ id: "0x244897572368EADF65BFBC5AEC98D8E5443A9072" }])).toEqual([
      "0x244897572368eadf65bfbc5aec98d8e5443a9072",
    ]);
    await expect(loadTrustedAttestors("", async () => [])).rejects.toThrow(/no attestor/);
  });
});

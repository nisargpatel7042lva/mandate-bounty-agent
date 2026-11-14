import { describe, expect, it } from "vitest";
import { findPayees, PAYEE_REGEX, parseEditor, PR_RESPONSE_REGEX, prQueryBody } from "../src/github-pr.ts";
import { verifyMergedPrProof } from "../src/verify.ts";
import { attestor, AUTHOR, binding, expectation, GITHUB_RESPONSE, PAYEE, PAYEE_CHECKSUMMED, PR, REPO, signedProof, trusted } from "./fixtures.ts";

describe("PR response pattern", () => {
  it("captures every attested field from GitHub's real response", () => {
    const g = new RegExp(PR_RESPONSE_REGEX).exec(GITHUB_RESPONSE)?.groups;
    expect(g).toEqual({
      number: "3",
      merged: "true",
      mergedAt: '"2026-10-29T10:10:19Z"',
      baseRef: "main",
      author: "nisargpatel7042lva",
      editor: "null",
      repo: "nisargpatel7042lva/mba-demo",
    });
    expect(new RegExp(PAYEE_REGEX).exec(GITHUB_RESPONSE)?.groups).toEqual({ payee: PAYEE_CHECKSUMMED });
  });

  it("captures the last editor of the description", () => {
    const edited = GITHUB_RESPONSE.replace('"editor":null', '"editor":{"login":"maintainer"}');
    const g = new RegExp(PR_RESPONSE_REGEX).exec(edited)?.groups;
    expect(parseEditor(g?.editor)).toBe("maintainer");
    expect(parseEditor("null")).toBeNull();
  });

  it("finds every distinct payee named in a description", () => {
    expect(findPayees(`Closes #1
mba-payee: ${PAYEE_CHECKSUMMED}
again mba-payee:${PAYEE}`)).toEqual([PAYEE]);
    expect(findPayees("mba-payee: 0x1111111111111111111111111111111111111111 mba-payee: 0x2222222222222222222222222222222222222222")).toHaveLength(2);
    expect(findPayees("no payee here, mba-payee: 0x123")).toEqual([]);
  });

  it("still matches an unmerged PR, so 'not merged' is provable rather than unprovable", () => {
    const unmerged = GITHUB_RESPONSE.replace('"merged":true,"mergedAt":"2026-10-29T10:10:19Z"', '"merged":false,"mergedAt":null');
    expect(new RegExp(PR_RESPONSE_REGEX).exec(unmerged)?.groups).toMatchObject({ merged: "false", mergedAt: "null" });
  });

  it("builds a stable request body", () => {
    expect(prQueryBody(REPO, PR)).toBe(prQueryBody(REPO, PR));
    expect(JSON.parse(prQueryBody(REPO, PR)).variables).toEqual({ owner: "nisargpatel7042lva", name: "mba-demo", number: 3 });
    expect(() => prQueryBody("no-slash", 1)).toThrow();
  });
});

describe("verifyMergedPrProof", () => {
  it("accepts a proof signed by a trusted attestor for this bounty, repo, PR and author", async () => {
    const r = verifyMergedPrProof(await signedProof(), trusted, expectation);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.claim).toEqual({
      repo: REPO,
      prNumber: 3,
      merged: true,
      mergedAt: "2026-10-29T10:10:19Z",
      baseRef: "main",
      author: "nisargpatel7042lva",
      payee: PAYEE,
      lastEditor: null,
    });
    expect(r.signers).toEqual([attestor.address.toLowerCase()]);
    expect(r.attestedAt).toBe(1_793_270_000);
  });

  it.each([
    ["merged = false", { extracted: { merged: "false", mergedAt: "null" } }, "NOT_MERGED"],
    ["a different repo in the response", { extracted: { repo: "evil/fork" } }, "WRONG_REPO"],
    ["a different author", { extracted: { author: "someone-else" } }, "WRONG_AUTHOR"],
    ["a different PR number in the response", { extracted: { number: "4" } }, "WRONG_PR"],
    ["a query for another repo", { body: prQueryBody("evil/fork", PR) }, "WRONG_REQUEST"],
    ["a query for another PR", { body: prQueryBody(REPO, 4) }, "WRONG_REQUEST"],
    ["another endpoint", { url: "https://evil.test/graphql" }, "WRONG_REQUEST"],
    ["another bounty", { binding: { ...binding, bountyId: 3 } }, "WRONG_BINDING"],
    ["another vault", { binding: { ...binding, vault: "0x000000000000000000000000000000000000dEaD" as const } }, "WRONG_BINDING"],
    ["an untrusted signer", { signer: "untrusted" }, "UNTRUSTED_ATTESTOR"],
    ["no payee line in the description", { noPayee: true }, "NO_PAYEE"],
    ["a malformed payee", { extracted: { payee: "0x1234" } }, "NO_PAYEE"],
    ["a description last edited by someone else", { extracted: { editor: '{"login":"maintainer"}' } }, "PAYEE_EDITED_BY_OTHER"],
  ] as const)("rejects a correctly signed proof of %s", async (_name, opts, code) => {
    const r = verifyMergedPrProof(await signedProof(opts), trusted, expectation);
    expect(r).toMatchObject({ ok: false, code });
  });
});

describe("payee edits", () => {
  it("accepts a description the author edited themselves", async () => {
    const r = verifyMergedPrProof(await signedProof({ extracted: { editor: `{"login":"${AUTHOR}"}` } }), trusted, expectation);
    expect(r.ok && r.claim.lastEditor).toBe(AUTHOR);
  });
});

describe("tampering after signing", () => {
  it.each([
    ["author", (p: Awaited<ReturnType<typeof signedProof>>) => (p.claimData.context = p.claimData.context.replace('"author":"nisargpatel7042lva"', '"author":"attacker"'))],
    ["payee", (p: Awaited<ReturnType<typeof signedProof>>) => (p.claimData.context = p.claimData.context.replace("0x1890d4b70874e92530Faa5cf1599f4c2f01aefE2", "0x000000000000000000000000000000000000dEaD"))],
    ["merged flag", (p: Awaited<ReturnType<typeof signedProof>>) => (p.claimData.context = p.claimData.context.replace('"merged":"true"', '"merged":"false"'))],
    ["bounty binding", (p: Awaited<ReturnType<typeof signedProof>>) => (p.claimData.context = p.claimData.context.replace("bounty=2", "bounty=9"))],
    ["request URL", (p: Awaited<ReturnType<typeof signedProof>>) => (p.claimData.parameters = p.claimData.parameters.replace("api.github.com", "api.github.co"))],
    ["timestamp", (p: Awaited<ReturnType<typeof signedProof>>) => (p.claimData.timestampS += 1)],
  ])("fails when the %s is edited", async (_field, tamper) => {
    const proof = await signedProof();
    tamper(proof);
    const r = verifyMergedPrProof(proof, trusted, expectation);
    expect(r.ok).toBe(false);
    // The signature no longer recovers to the attestor, whatever field was changed.
    expect(r).toMatchObject({ code: "UNTRUSTED_ATTESTOR" });
  });

  it("fails when the identifier is swapped for another claim's", async () => {
    const proof = await signedProof();
    proof.identifier = (await signedProof({ binding: { ...binding, bountyId: 3 } })).identifier;
    expect(verifyMergedPrProof(proof, trusted, expectation)).toMatchObject({ ok: false, code: "IDENTIFIER_MISMATCH" });
  });

  it("fails on a corrupted or missing signature", async () => {
    const proof = await signedProof();
    proof.signatures = ["0xnot-hex"];
    expect(verifyMergedPrProof(proof, trusted, expectation)).toMatchObject({ ok: false, code: "BAD_SIGNATURE" });
    proof.signatures = [];
    expect(verifyMergedPrProof(proof, trusted, expectation)).toMatchObject({ ok: false, code: "MALFORMED" });
  });

  it("treats the extractedParameterValues convenience copy as untrusted", async () => {
    // Only the signed context counts; editing the unsigned copy changes nothing.
    const proof = await signedProof();
    proof.extractedParameterValues = { ...proof.extractedParameterValues, author: "attacker" };
    const r = verifyMergedPrProof(proof, trusted, expectation);
    expect(r.ok && r.claim.author).toBe("nisargpatel7042lva");
  });
});

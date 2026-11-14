import { getIdentifierFromClaimInfo, recoverSignersOfSignedClaim, type Proof } from "@reclaimprotocol/js-sdk";
import { bountyContext, GITHUB_GRAPHQL_URL, parseEditor, PROOF_MATCHES, prQueryBody, type BountyBinding, type MergedPrClaim } from "./github-pr.ts";

export type ProofFailureCode =
  | "MALFORMED"
  | "BAD_SIGNATURE"
  | "UNTRUSTED_ATTESTOR"
  | "IDENTIFIER_MISMATCH"
  | "WRONG_REQUEST"
  | "WRONG_BINDING"
  | "WRONG_REPO"
  | "WRONG_PR"
  | "NOT_MERGED"
  | "WRONG_AUTHOR"
  | "NO_PAYEE"
  | "PAYEE_EDITED_BY_OTHER";

export type VerifyResult =
  | { ok: true; claim: MergedPrClaim; identifier: string; signers: string[]; attestedAt: number }
  | { ok: false; code: ProofFailureCode; reason: string };

export interface Expectation extends BountyBinding {
  repo: string;
  prNumber: number;
  /** GitHub login recorded when the PR was detected; the proof must name the same author. */
  author: string;
}

const fail = (code: ProofFailureCode, reason: string): VerifyResult => ({ ok: false, code, reason });

/**
 * Verifies a zkTLS proof of a merged PR, fully offline:
 *  1. at least one signature recovers to a trusted Reclaim attestor (signatures cover the content);
 *  2. the claim's identifier matches its content;
 *  3. the claim is about exactly our GitHub request (URL, method, body, match pattern);
 *  4. the claim is bound to this bounty;
 *  5. the attested fields say: this repo, this PR, merged, this author, and a payee line that only
 *     the author wrote or last edited.
 * Any edit to the proof after signing fails step 1 or 2.
 */
export function verifyMergedPrProof(proof: Proof, trustedAttestors: string[], expected: Expectation): VerifyResult {
  const claimData = proof?.claimData;
  if (!claimData || typeof claimData.parameters !== "string" || !Array.isArray(proof.signatures) || proof.signatures.length === 0) {
    return fail("MALFORMED", "proof is missing claim data or signatures");
  }

  let signers: string[];
  try {
    signers = recoverSignersOfSignedClaim({ claim: claimData, signatures: proof.signatures.map(hexToBytes) });
  } catch (err) {
    return fail("BAD_SIGNATURE", `could not recover a signer: ${(err as Error).message}`);
  }
  const trusted = new Set(trustedAttestors.map((a) => a.toLowerCase()));
  if (!signers.some((s) => trusted.has(s))) return fail("UNTRUSTED_ATTESTOR", `signed by ${signers.join(", ")}, none of which is a trusted attestor`);

  let identifier: string;
  try {
    identifier = getIdentifierFromClaimInfo(claimData);
  } catch (err) {
    return fail("MALFORMED", `claim context is not valid JSON: ${(err as Error).message}`);
  }
  if (identifier !== claimData.identifier?.toLowerCase() || identifier !== proof.identifier?.toLowerCase()) {
    return fail("IDENTIFIER_MISMATCH", "proof identifier does not match its claim content");
  }

  let params: { url?: string; method?: string; body?: string; responseMatches?: { type?: string; value?: string }[] };
  let context: { contextAddress?: string; contextMessage?: string; extractedParameters?: Record<string, string> };
  try {
    params = JSON.parse(claimData.parameters);
    context = JSON.parse(claimData.context || "{}");
  } catch {
    return fail("MALFORMED", "claim parameters or context are not JSON");
  }

  if (claimData.provider !== "http" || params.url !== GITHUB_GRAPHQL_URL || params.method !== "POST") {
    return fail("WRONG_REQUEST", `proof is for ${params.method} ${params.url} (${claimData.provider}), not the GitHub GraphQL API`);
  }
  if (params.body !== prQueryBody(expected.repo, expected.prNumber)) {
    return fail("WRONG_REQUEST", "proof was made for a different GitHub query");
  }
  const matches = params.responseMatches ?? [];
  const sameMatches = matches.length === PROOF_MATCHES.length && PROOF_MATCHES.every((m, i) => matches[i]?.type === m.type && matches[i]?.value === m.value);
  if (!sameMatches) return fail("WRONG_REQUEST", "proof uses different response patterns");

  const binding = bountyContext(expected);
  if (context.contextAddress?.toLowerCase() !== binding.contextAddress || context.contextMessage !== binding.contextMessage) {
    return fail("WRONG_BINDING", `proof is bound to "${context.contextMessage ?? "nothing"}", not this bounty`);
  }

  const x = context.extractedParameters ?? {};
  const claim: MergedPrClaim = {
    repo: x.repo ?? "",
    prNumber: Number(x.number),
    merged: x.merged === "true",
    mergedAt: x.mergedAt && x.mergedAt !== "null" ? x.mergedAt.replace(/^"|"$/g, "") : null,
    baseRef: x.baseRef ?? "",
    author: x.author ?? "",
    payee: (x.payee ?? "").toLowerCase() as `0x${string}`,
    lastEditor: parseEditor(x.editor),
  };
  if (claim.repo.toLowerCase() !== expected.repo.toLowerCase()) return fail("WRONG_REPO", `proof is for ${claim.repo || "no repo"}, not ${expected.repo}`);
  if (claim.prNumber !== expected.prNumber) return fail("WRONG_PR", `proof is for PR #${x.number}, not #${expected.prNumber}`);
  if (!claim.merged || !claim.mergedAt) return fail("NOT_MERGED", `GitHub reported PR #${claim.prNumber} as not merged`);
  if (claim.author.toLowerCase() !== expected.author.toLowerCase()) return fail("WRONG_AUTHOR", `proof names @${claim.author}, not @${expected.author}`);
  if (!/^0x[0-9a-f]{40}$/.test(claim.payee)) return fail("NO_PAYEE", "the PR description names no payee wallet (mba-payee: 0x...)");
  // Maintainers can edit a PR description after merge; only the author may set the payee.
  if (claim.lastEditor && claim.lastEditor.toLowerCase() !== claim.author.toLowerCase()) {
    return fail("PAYEE_EDITED_BY_OTHER", `the PR description was last edited by @${claim.lastEditor}, not the author @${claim.author}`);
  }

  return { ok: true, claim, identifier, signers, attestedAt: claimData.timestampS };
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) throw new Error("signature is not hex");
  return Uint8Array.from(clean.match(/../g) ?? [], (b) => parseInt(b, 16));
}

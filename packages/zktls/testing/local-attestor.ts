// Test-only stand-in for a Reclaim attestor: produces proofs in zkFetch's shape, signed exactly the
// way attestors sign (EIP-191 over createSignDataForClaim). Lets tests and the E2E stack exercise
// real signature verification without network access or Reclaim credentials.
import { createSignDataForClaim, getIdentifierFromClaimInfo, type Proof } from "@reclaimprotocol/js-sdk";
import { privateKeyToAccount } from "viem/accounts";
import { bountyContext, GITHUB_GRAPHQL_URL, PROOF_MATCHES, prQueryBody, type BountyBinding } from "../src/github-pr.ts";

export interface LocalClaimInput {
  repo: string;
  prNumber: number;
  binding: BountyBinding;
  /** Values the "attested" response contained, as the regex captures them. */
  extracted: Record<"number" | "merged" | "mergedAt" | "baseRef" | "author" | "editor" | "repo", string> & { payee?: string };
  /** Overrides for negative tests. */
  body?: string;
  url?: string;
  timestampS?: number;
}

export async function signLocalClaim(privateKey: `0x${string}`, input: LocalClaimInput): Promise<Proof> {
  const signer = privateKeyToAccount(privateKey);
  const parameters = JSON.stringify({
    body: input.body ?? prQueryBody(input.repo, input.prNumber),
    method: "POST",
    responseMatches: PROOF_MATCHES,
    responseRedactions: PROOF_MATCHES.map((m) => ({ regex: m.value })),
    url: input.url ?? GITHUB_GRAPHQL_URL,
  });
  const base = {
    provider: "http",
    parameters,
    owner: "0x96faf173bb7171a530b3e44f35f32d1307bda4fa",
    timestampS: input.timestampS ?? Math.floor(Date.now() / 1000),
    context: JSON.stringify({ ...bountyContext(input.binding), extractedParameters: input.extracted }),
    epoch: 1,
  };
  const identifier = getIdentifierFromClaimInfo(base);
  const claimData = { ...base, identifier };
  const signature = await signer.signMessage({ message: createSignDataForClaim(claimData) });
  return {
    identifier,
    claimData,
    signatures: [signature],
    witnesses: [{ id: signer.address.toLowerCase(), url: "local-attestor" }],
    extractedParameterValues: input.extracted,
  };
}

/** Address a test verifier should trust for proofs from `signLocalClaim(privateKey, ...)`. */
export const localAttestorAddress = (privateKey: `0x${string}`) => privateKeyToAccount(privateKey).address.toLowerCase();

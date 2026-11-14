import type { Proof } from "@reclaimprotocol/js-sdk";
import { bountyContext, GITHUB_GRAPHQL_URL, PROOF_MATCHES, PUBLIC_HEADERS, prQueryBody, type BountyBinding } from "./github-pr.ts";

/** The part of ReclaimClient this module uses, so tests can pass a fake. */
export interface ZkFetchClient {
  zkFetch(
    url: string,
    options: {
      method: string;
      body?: string;
      headers?: Record<string, string>;
      context?: { contextAddress: string; contextMessage: string };
    },
    secretOptions: {
      headers?: Record<string, string>;
      responseMatches?: { type: "regex" | "contains"; value: string }[];
      responseRedactions?: { regex?: string; jsonPath?: string }[];
    },
    retries?: number,
    retryInterval?: number,
  ): Promise<Proof | undefined>;
}

export interface ProveMergedPrInput {
  repo: string;
  prNumber: number;
  /** Sent only through Reclaim's private options: it never appears in the proof. */
  githubToken: string;
  binding: BountyBinding;
}

/**
 * Fetches the PR from GitHub over zkTLS. The proof attests that api.github.com returned the matched
 * fields for this exact request, without revealing the token or anything outside the match.
 */
export async function proveMergedPr(client: ZkFetchClient, input: ProveMergedPrInput): Promise<Proof> {
  const proof = await client.zkFetch(
    GITHUB_GRAPHQL_URL,
    {
      method: "POST",
      body: prQueryBody(input.repo, input.prNumber),
      headers: { ...PUBLIC_HEADERS },
      context: bountyContext(input.binding),
    },
    {
      headers: { authorization: `Bearer ${input.githubToken}` },
      responseMatches: PROOF_MATCHES,
      // Reveal only the matched spans; the rest of the response (most of the description) stays hidden.
      responseRedactions: PROOF_MATCHES.map((m) => ({ regex: m.value })),
    },
    2,
    3_000,
  );
  if (!proof) throw new Error("zkFetch returned no proof");
  return proof;
}

// The exact HTTPS request whose response the zkTLS proof attests to, and how the proof is bound to
// one bounty. Prover and verifier both build these from the same functions, so the verifier can
// check the signed claim describes this request and nothing else.

export const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

/** Public request headers (visible in the proof). The Authorization header is sent privately. */
export const PUBLIC_HEADERS = { "content-type": "application/json", "user-agent": "mandate-bounty-agent" } as const;

// `editor` is whoever last edited the PR description (null if never edited). It matters because the
// description carries the payee line, and maintainers can edit descriptions after a merge.
const PR_QUERY =
  "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){number merged mergedAt baseRefName author{login} editor{login} repository{nameWithOwner} body}}}";

/** Deterministic request body for one PR. GitHub answers with these fields in this order. */
export function prQueryBody(repo: string, prNumber: number): string {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`repo must be owner/name, got "${repo}"`);
  return JSON.stringify({ query: PR_QUERY, variables: { owner, name, number: prNumber } });
}

/**
 * Matches GitHub's compact GraphQL response and names every attested field. `merged` and
 * `mergedAt` accept the unmerged values too, so an unmerged PR yields a valid proof of "not merged"
 * that the verifier then rejects, instead of a proof that cannot be generated at all.
 */
export const PR_RESPONSE_REGEX =
  '"pullRequest":\\{"number":(?<number>\\d+),"merged":(?<merged>true|false),"mergedAt":(?<mergedAt>"[^"]*"|null),"baseRefName":"(?<baseRef>[^"]+)","author":\\{"login":"(?<author>[^"]+)"\\},"editor":(?<editor>null|\\{"login":"[^"]+"\\}),"repository":\\{"nameWithOwner":"(?<repo>[^"]+)"\\}';

/**
 * The contributor names their payee wallet with a line `mba-payee: 0x...` in the PR description.
 * Only the description field can contain this text, and only the first occurrence is attested.
 */
export const PAYEE_LINE = "mba-payee:";
export const PAYEE_REGEX = "mba-payee:\\s*(?<payee>0x[0-9a-fA-F]{40})";

/** Every distinct payee address named in a description, lowercased, in order of appearance. */
export function findPayees(description: string): `0x${string}`[] {
  const found = [...description.matchAll(new RegExp(PAYEE_REGEX, "g"))].map((m) => m.groups?.payee?.toLowerCase() as `0x${string}`);
  return [...new Set(found)];
}

/** Parses the `editor` capture: null (never edited) or the login of the last editor. */
export function parseEditor(raw: string | undefined): string | null {
  if (!raw || raw === "null") return null;
  const m = /^\{"login":"([^"]+)"\}$/.exec(raw);
  return m?.[1] ?? null;
}

export interface BountyBinding {
  chainId: number;
  vault: `0x${string}`;
  bountyId: number;
}

/** Signed into the claim context, so a proof made for one bounty cannot be replayed for another. */
export function bountyContext(b: BountyBinding): { contextAddress: string; contextMessage: string } {
  return {
    contextAddress: b.vault.toLowerCase(),
    contextMessage: `mandate-bounty-agent:v1:chain=${b.chainId}:vault=${b.vault.toLowerCase()}:bounty=${b.bountyId}`,
  };
}

/** The facts the proof establishes, in the plain types the agent stores. */
export interface MergedPrClaim {
  repo: string;
  prNumber: number;
  merged: boolean;
  mergedAt: string | null;
  baseRef: string;
  author: string;
  /** Wallet named by the `mba-payee:` line in the PR description, lowercased. */
  payee: `0x${string}`;
  /** Who last edited the description; null if never edited. Accepted only if null or the author. */
  lastEditor: string | null;
}

/** The response patterns every proof must use, in this order. Verified exactly. */
export const PROOF_MATCHES = [
  { type: "regex" as const, value: PR_RESPONSE_REGEX },
  { type: "regex" as const, value: PAYEE_REGEX },
];

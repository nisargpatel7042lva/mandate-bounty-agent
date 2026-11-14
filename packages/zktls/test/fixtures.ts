import type { Proof } from "@reclaimprotocol/js-sdk";
import { privateKeyToAccount } from "viem/accounts";
import type { BountyBinding } from "../src/github-pr.ts";
import { signLocalClaim } from "../testing/local-attestor.ts";

// Anvil dev keys 1 and 2: public test keys, used here as a trusted and an untrusted "attestor".
const ATTESTOR_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const OTHER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
export const attestor = privateKeyToAccount(ATTESTOR_KEY);
export const otherSigner = privateKeyToAccount(OTHER_KEY);

export const binding: BountyBinding = { chainId: 11155111, vault: "0xbe34D63C55FbE509d5196857ed23B461eA314f79", bountyId: 2 };
export const REPO = "nisargpatel7042lva/mba-demo";
export const PR = 3;
export const AUTHOR = "nisargpatel7042lva";
/** The Sepolia deployer, the only allowed payee on bounty #2 (checksummed as a contributor would write it). */
export const PAYEE_CHECKSUMMED = "0x1890d4b70874e92530Faa5cf1599f4c2f01aefE2";
export const PAYEE = PAYEE_CHECKSUMMED.toLowerCase();

/** GitHub's answer for mba-demo PR #3 (shape captured 2026-10-29), with a payee line in the description. */
export const GITHUB_RESPONSE = JSON.stringify({
  data: {
    repository: {
      pullRequest: {
        number: 3,
        merged: true,
        mergedAt: "2026-10-29T10:10:19Z",
        baseRefName: "main",
        author: { login: AUTHOR },
        editor: null,
        repository: { nameWithOwner: REPO },
        body: `Closes #1\n\nmba-payee: ${PAYEE_CHECKSUMMED}\n\n- \`flex-wrap: wrap\` on the grid.`,
      },
    },
  },
});

export interface FixtureOptions {
  extracted?: Partial<Record<"number" | "merged" | "mergedAt" | "baseRef" | "author" | "editor" | "repo" | "payee", string>>;
  /** Simulates a description with no payee line (the attested context has no payee). */
  noPayee?: boolean;
  body?: string;
  url?: string;
  binding?: BountyBinding;
  signer?: "trusted" | "untrusted";
}

/** A proof shaped like zkFetch output for mba-demo PR #3, signed by the trusted test attestor by default. */
export function signedProof(opts: FixtureOptions = {}): Promise<Proof> {
  return signLocalClaim(opts.signer === "untrusted" ? OTHER_KEY : ATTESTOR_KEY, {
    repo: REPO,
    prNumber: PR,
    binding: opts.binding ?? binding,
    extracted: {
      number: String(PR),
      merged: "true",
      mergedAt: '"2026-10-29T10:10:19Z"',
      baseRef: "main",
      author: AUTHOR,
      editor: "null",
      repo: REPO,
      ...(opts.noPayee ? {} : { payee: PAYEE_CHECKSUMMED }),
      ...opts.extracted,
    },
    timestampS: 1_793_270_000,
    ...(opts.body ? { body: opts.body } : {}),
    ...(opts.url ? { url: opts.url } : {}),
  });
}

export const expectation = { ...binding, repo: REPO, prNumber: PR, author: AUTHOR };
export const trusted = [attestor.address];

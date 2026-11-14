// Starts the real agent for E2E with one substitution: work proofs come from a local test attestor
// instead of Reclaim's network. The agent still verifies every proof (signature, request, binding,
// fields) exactly as in production; only the trusted attestor address differs.
import { loadEnv } from "@mba/agent/env";
import { startAgent } from "@mba/agent/main";
import { localAttestorAddress, signLocalClaim } from "@mba/zktls/testing";
import { E2E_MERGED_AT, E2E_PAYEE, E2E_PR_AUTHOR } from "./stubs.ts";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // anvil dev key 1

await startAgent(loadEnv(), {
  prover: {
    trustedAttestors: [localAttestorAddress(KEY)],
    prove: ({ repo, prNumber, binding }) =>
      signLocalClaim(KEY, {
        repo,
        prNumber,
        binding,
        extracted: {
          number: String(prNumber),
          merged: "true",
          mergedAt: `"${E2E_MERGED_AT}"`,
          baseRef: "main",
          author: E2E_PR_AUTHOR,
          editor: "null",
          repo,
          payee: E2E_PAYEE,
        },
      }),
  },
});

import { loadTrustedAttestors, proveMergedPr } from "@mba/zktls";
import { ReclaimClient } from "@reclaimprotocol/zk-fetch";
import type { Env } from "./env.ts";
import type { WorkProver } from "./watcher.ts";

export type ProverChoice = { prover: WorkProver } | { prover: undefined; reason: string };

/** Reclaim zkFetch prover from the environment, with the trusted attestor list loaded once. */
export async function createProverFromEnv(env: Pick<Env, "RECLAIM_APP_ID" | "RECLAIM_APP_SECRET" | "RECLAIM_ATTESTORS">, githubToken: string | undefined): Promise<ProverChoice> {
  if (!env.RECLAIM_APP_ID || !env.RECLAIM_APP_SECRET) return { prover: undefined, reason: "RECLAIM_APP_ID and RECLAIM_APP_SECRET are not set" };
  if (!githubToken) return { prover: undefined, reason: "no GitHub token to fetch the PR with" };

  let trustedAttestors: string[];
  try {
    trustedAttestors = await loadTrustedAttestors(env.RECLAIM_ATTESTORS);
  } catch (err) {
    return { prover: undefined, reason: `could not load Reclaim attestors: ${(err as Error).message}` };
  }

  const client = new ReclaimClient(env.RECLAIM_APP_ID, env.RECLAIM_APP_SECRET);
  return {
    prover: {
      trustedAttestors,
      prove: ({ repo, prNumber, binding }) => proveMergedPr(client, { repo, prNumber, githubToken, binding }),
    },
  };
}

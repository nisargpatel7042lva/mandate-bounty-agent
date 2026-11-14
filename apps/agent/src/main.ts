import { serve } from "@hono/node-server";
import { createPublicClient, http } from "viem";
import { createApp } from "./app.ts";
import { createVaultReader } from "./chain/reader.ts";
import { syncVault } from "./chain/sync.ts";
import { openDb } from "./db/client.ts";
import { resolveGitHubToken, type Env } from "./env.ts";
import { createGitHubClient } from "./github/client.ts";
import { createProverFromEnv } from "./prover.ts";
import { createReviewerFromEnv } from "./review/index.ts";
import { Watcher, type WorkProver } from "./watcher.ts";

/** Lets a test harness supply its own prover (e.g. a local attestor) instead of Reclaim. */
export interface AgentOverrides {
  prover?: WorkProver;
}

/** Runs `fn` on an interval, skipping a beat if the previous run is still going. */
function every(ms: number, name: string, fn: () => Promise<void>) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await fn();
    } catch (err) {
      console.error(`${name} failed:`, err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  };
  setInterval(run, ms);
  return run;
}

export async function startAgent(env: Env, overrides: AgentOverrides = {}) {
  const { db } = openDb(env.DATABASE_PATH);
  const client = createPublicClient({ transport: http(env.RPC_URL) });
  const ctx = { client, chainId: env.CHAIN_ID, vault: env.VAULT_ADDRESS, deployBlock: env.VAULT_DEPLOY_BLOCK };

  // Each stage degrades on its own: no GitHub token, no claims; no LLM key, claims wait for review;
  // no Reclaim credentials, reviewed bounties wait for their work proof.
  const githubToken = resolveGitHubToken(env);
  const review = createReviewerFromEnv(env);
  const proving = overrides.prover ? { prover: overrides.prover } : await createProverFromEnv(env, githubToken);
  const watcher = githubToken
    ? new Watcher(db, {
        github: createGitHubClient({ token: githubToken, apiUrl: env.GITHUB_API_URL }),
        reviewer: review.reviewer,
        prover: proving.prover,
      })
    : undefined;

  if (!watcher) console.warn("watcher disabled: set GITHUB_TOKEN or GITHUB_TOKEN_COMMAND");
  else {
    if (review.reviewer) console.log(`reviews by ${review.label}`);
    else console.warn(`reviews disabled: ${review.reason}; claims will wait for review`);
    if (proving.prover) console.log(`work proofs by zkTLS (${proving.prover.trustedAttestors.length} trusted attestors)`);
    else console.warn(`work proofs disabled: ${"reason" in proving ? proving.reason : "no prover"}; reviewed bounties will wait`);
  }

  const app = createApp({ db, chain: createVaultReader(client, env.CHAIN_ID, env.VAULT_ADDRESS), watcher, corsOrigins: env.CORS_ORIGINS });

  await every(env.SYNC_INTERVAL_MS, "sync", async () => {
    const r = await syncVault(db, ctx);
    if (r.events > 0) console.log(`sync: ${r.events} events in blocks ${r.from}..${r.to}`);
  })();

  if (watcher) {
    void every(env.GITHUB_POLL_INTERVAL_MS, "watcher", async () => {
      for (const r of await watcher.tick()) {
        if (r.error) console.error(`watcher: bounty ${r.id}: ${r.error}`);
        else if (r.result && r.result.action !== "waiting" && r.result.action !== "skipped") console.log(`watcher: bounty ${r.id}:`, r.result);
      }
    })();
  }

  serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`agent listening on :${info.port} (chain ${env.CHAIN_ID}, vault ${env.VAULT_ADDRESS}, watcher ${watcher ? "on" : "off"})`);
  });
}

import { execSync } from "node:child_process";
import { z } from "zod";

const Address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((s) => s as `0x${string}`);

/** Values copied unchanged from .env.example count as unset. */
const Secret = z
  .string()
  .optional()
  .transform((s) => (s && !/placeholder/i.test(s) ? s : undefined));

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  DATABASE_PATH: z.string().default("./data/mandate-bounty.sqlite"),
  RPC_URL: z.url(),
  CHAIN_ID: z.coerce.number().int().positive(),
  VAULT_ADDRESS: Address,
  VAULT_DEPLOY_BLOCK: z.coerce.bigint().nonnegative(),
  SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(10_000),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000")
    .transform((s) => s.split(",").map((o) => o.trim()).filter(Boolean)),

  GITHUB_TOKEN: Secret,
  /** Local dev alternative to a stored token, e.g. "gh auth token". Run once at startup. */
  GITHUB_TOKEN_COMMAND: z.string().optional(),
  GITHUB_API_URL: z.url().default("https://api.github.com"),
  GITHUB_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  /** Which LLM writes the advisory review. Unset: Claude if ANTHROPIC_API_KEY is set, else Gemini. */
  REVIEW_PROVIDER: z.enum(["claude", "gemini"]).optional(),
  /** Read by the Anthropic SDK itself; checked here only so the watcher can report it missing. */
  ANTHROPIC_API_KEY: Secret,
  ANTHROPIC_BASE_URL: z.url().optional(),
  GEMINI_API_KEY: Secret,
  GEMINI_MODEL: z.string().min(1).optional(),
  GEMINI_BASE_URL: z.url().optional(),

  /** Reclaim zkFetch app credentials (dev.reclaimprotocol.org). Without them, work proofs wait. */
  RECLAIM_APP_ID: Secret,
  RECLAIM_APP_SECRET: Secret,
  /** Comma-separated trusted attestor addresses. Unset: fetched from Reclaim's published list. */
  RECLAIM_ATTESTORS: z.string().optional(),

  /** Kurier (zkVerify relayer). Without a key, mandate proofs are made locally and wait for zkVerify. */
  KURIER_API_URL: z.url().default("https://api-testnet.kurier.xyz/api/v1"),
  KURIER_API_KEY: Secret,
  /** Must match the vault: true means payouts need zkVerify's on-chain aggregation check. */
  ZKVERIFY_AGGREGATION_REQUIRED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  /** zkVerify domain the aggregation is published under (passed to verifyProofAggregation). */
  ZKVERIFY_DOMAIN_ID: z.coerce.number().int().nonnegative().default(0),

  /** The agent's release signer (BountyVault.agent). Without it, verified payouts wait. Testnet only. */
  AGENT_PRIVATE_KEY: Secret.refine((v) => v === undefined || /^0x[0-9a-fA-F]{64}$/.test(v), "must be 0x + 64 hex").transform((v) => v as `0x${string}` | undefined),
});
export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`invalid agent environment:\n${lines}`);
  }
  return parsed.data;
}

/**
 * Runs the token command without GITHUB_TOKEN / GH_TOKEN in its environment: `gh auth token`
 * echoes those variables when set, so a placeholder loaded from .env would come straight back.
 */
function runTokenCommand(cmd: string): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "GITHUB_TOKEN" && k !== "GH_TOKEN"));
  return execSync(cmd, { encoding: "utf8", env });
}

/** GITHUB_TOKEN if set, otherwise the output of GITHUB_TOKEN_COMMAND; undefined if neither works. */
export function resolveGitHubToken(env: Env, run: (cmd: string) => string = runTokenCommand): string | undefined {
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN;
  if (!env.GITHUB_TOKEN_COMMAND) return undefined;
  try {
    const out = run(env.GITHUB_TOKEN_COMMAND).trim();
    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

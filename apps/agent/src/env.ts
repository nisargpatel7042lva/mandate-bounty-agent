import { z } from "zod";

const Address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((s) => s as `0x${string}`);

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

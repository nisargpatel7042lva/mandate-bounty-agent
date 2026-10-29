import { eq } from "drizzle-orm";
import type { PublicClient } from "viem";
import type { Db } from "../db/client.ts";
import { syncState } from "../db/schema.ts";
import { applyVaultEvents, decodeVaultLogs } from "./events.ts";

export interface ChainCtx {
  client: PublicClient;
  chainId: number;
  vault: `0x${string}`;
  /** Block the vault was deployed in; the first sync starts here. */
  deployBlock: bigint;
  /** Max blocks per eth_getLogs call; public RPCs cap the range. */
  chunkSize?: bigint;
}

const cursorKey = (ctx: ChainCtx) => `cursor:${ctx.chainId}:${ctx.vault.toLowerCase()}`;

/** Pulls vault logs from the last synced block to `toBlock` (default: latest) and applies them. */
export async function syncVault(db: Db, ctx: ChainCtx, toBlock?: bigint): Promise<{ from: bigint; to: bigint; events: number }> {
  const key = cursorKey(ctx);
  const saved = db.select().from(syncState).where(eq(syncState.key, key)).get();
  const from = saved ? BigInt(saved.value) + 1n : ctx.deployBlock;
  // cacheTime 0: viem otherwise reuses a block number up to ~4s old and the sync would miss fresh blocks.
  const to = toBlock ?? (await ctx.client.getBlockNumber({ cacheTime: 0 }));
  const chunk = ctx.chunkSize ?? 2_000n;

  let events = 0;
  for (let start = from; start <= to; start += chunk) {
    const end = start + chunk - 1n < to ? start + chunk - 1n : to;
    const logs = await ctx.client.getLogs({ address: ctx.vault, fromBlock: start, toBlock: end });
    const decoded = decodeVaultLogs(logs);
    applyVaultEvents(db, ctx, decoded);
    db.insert(syncState)
      .values({ key, value: end.toString() })
      .onConflictDoUpdate({ target: syncState.key, set: { value: end.toString() } })
      .run();
    events += decoded.length;
  }
  return { from, to, events };
}

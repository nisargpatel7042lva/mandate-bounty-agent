import { bountyVaultAbi } from "@mba/contracts";
import { eq, sql } from "drizzle-orm";
import { parseEventLogs, type Log } from "viem";
import type { Db } from "../db/client.ts";
import { bounties, fundings } from "../db/schema.ts";

interface Meta {
  txHash: `0x${string}`;
  logIndex: number;
  blockNumber: bigint;
}

interface MandateFields {
  perPayoutCap: bigint;
  totalBudget: bigint;
  expiry: bigint;
  commitment: `0x${string}`;
}

export type VaultEvent =
  | (Meta & {
      kind: "created";
      id: bigint;
      funder: `0x${string}`;
      repo: string;
      issueNumber: bigint;
      payoutAmount: bigint;
      mandate: MandateFields;
      payees: readonly `0x${string}`[];
    })
  | (Meta & { kind: "funded"; id: bigint; from: `0x${string}`; amount: bigint; totalFunded: bigint })
  | (Meta & { kind: "mandateUpdated"; id: bigint; mandate: MandateFields; payees: readonly `0x${string}`[] });

/** Decodes raw vault logs into VaultEvents, sorted by chain order. Unknown logs are dropped. */
export function decodeVaultLogs(logs: Log[]): VaultEvent[] {
  const out: VaultEvent[] = [];
  for (const log of parseEventLogs({ abi: bountyVaultAbi, logs })) {
    if (log.transactionHash === null || log.logIndex === null || log.blockNumber === null) continue;
    const meta: Meta = { txHash: log.transactionHash, logIndex: log.logIndex, blockNumber: log.blockNumber };
    switch (log.eventName) {
      case "BountyCreated":
        out.push({ ...meta, kind: "created", ...log.args, issueNumber: BigInt(log.args.issueNumber) });
        break;
      case "BountyFunded":
        out.push({ ...meta, kind: "funded", ...log.args });
        break;
      case "MandateUpdated":
        out.push({ ...meta, kind: "mandateUpdated", ...log.args });
        break;
    }
  }
  return out.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
}

/**
 * Applies decoded events to the mirror. Idempotent: replaying any range leaves the same state,
 * because funding writes the absolute `totalFunded` from the event and creation upserts.
 */
export function applyVaultEvents(db: Db, ctx: { chainId: number; vault: `0x${string}` }, events: VaultEvent[]): void {
  const now = Math.floor(Date.now() / 1000);
  db.transaction((tx) => {
    for (const e of events) {
      const id = Number(e.id);
      if (e.kind === "created") {
        const row = {
          id,
          chainId: ctx.chainId,
          vault: ctx.vault.toLowerCase(),
          funder: e.funder.toLowerCase(),
          repo: e.repo,
          issueNumber: Number(e.issueNumber),
          payoutAmount: e.payoutAmount.toString(),
          perPayoutCap: e.mandate.perPayoutCap.toString(),
          totalBudget: e.mandate.totalBudget.toString(),
          expiry: Number(e.mandate.expiry),
          mandateCommitment: e.mandate.commitment,
          payees: e.payees.map((p) => p.toLowerCase()),
          createdTx: e.txHash,
          createdBlock: Number(e.blockNumber),
          updatedAt: now,
        };
        // Metadata (title, criteria) may already exist if POST /bounties raced the sync loop; keep it.
        tx.insert(bounties)
          .values(row)
          .onConflictDoUpdate({
            target: bounties.id,
            set: { ...row, title: sql`${bounties.title}`, acceptanceCriteria: sql`${bounties.acceptanceCriteria}` },
          })
          .run();
      } else if (e.kind === "funded") {
        tx.insert(fundings)
          .values({
            txHash: e.txHash,
            logIndex: e.logIndex,
            bountyId: id,
            from: e.from.toLowerCase(),
            amount: e.amount.toString(),
            blockNumber: Number(e.blockNumber),
          })
          .onConflictDoNothing()
          .run();
        tx.update(bounties).set({ funded: e.totalFunded.toString(), updatedAt: now }).where(eq(bounties.id, id)).run();
      } else {
        tx.update(bounties)
          .set({
            perPayoutCap: e.mandate.perPayoutCap.toString(),
            totalBudget: e.mandate.totalBudget.toString(),
            expiry: Number(e.mandate.expiry),
            mandateCommitment: e.mandate.commitment,
            payees: e.payees.map((p) => p.toLowerCase()),
            updatedAt: now,
          })
          .where(eq(bounties.id, id))
          .run();
      }
    }
  });
}

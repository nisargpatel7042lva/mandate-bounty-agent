import type { VaultReader } from "../../src/bounties.ts";
import type { VaultEvent } from "../../src/chain/events.ts";

export const VAULT = "0x00000000000000000000000000000000000Fa017" as const;
export const FUNDER = "0x000000000000000000000000000000000000F00D" as const;
/** Any non-zero bytes32 works for event-level tests; packages/circuits computes real ones. */
export const COMMITMENT = `0x${"c0".repeat(32)}` as const;
export const ALICE = "0x00000000000000000000000000000000000A11cE" as const;

export const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;

export function createdEvent(id: number, over: Partial<Extract<VaultEvent, { kind: "created" }>> = {}): VaultEvent {
  return {
    kind: "created",
    id: BigInt(id),
    funder: FUNDER,
    repo: "acme/widgets",
    issueNumber: 42n,
    payoutAmount: 250_000_000n,
    mandate: { perPayoutCap: 500_000_000n, totalBudget: 1_000_000_000n, expiry: 2_000_000_000n, commitment: COMMITMENT },
    payees: [ALICE],
    txHash: tx(id),
    logIndex: 0,
    blockNumber: BigInt(100 + id),
    ...over,
  };
}

export function fundedEvent(id: number, amount: bigint, totalFunded: bigint, n: number, logIndex = 1): VaultEvent {
  return {
    kind: "funded",
    id: BigInt(id),
    from: FUNDER,
    amount,
    totalFunded,
    txHash: tx(n),
    logIndex,
    blockNumber: BigInt(100 + n),
  };
}

/** A VaultReader backed by a fixed map of tx hash to events. */
export function fakeReader(byTx: Record<string, VaultEvent[] | null>): VaultReader {
  return {
    chainId: 31337,
    vault: VAULT,
    eventsForTx: async (hash) => byTx[hash] ?? null,
  };
}

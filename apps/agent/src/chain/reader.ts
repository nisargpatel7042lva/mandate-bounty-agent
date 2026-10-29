import type { PublicClient } from "viem";
import type { VaultReader } from "../bounties.ts";
import { decodeVaultLogs } from "./events.ts";

export function createVaultReader(client: PublicClient, chainId: number, vault: `0x${string}`): VaultReader {
  return {
    chainId,
    vault,
    async eventsForTx(txHash) {
      const receipt = await client
        .waitForTransactionReceipt({ hash: txHash, timeout: 30_000 })
        .catch(() => null);
      if (!receipt || receipt.status !== "success") return null;
      const own = receipt.logs.filter((l) => l.address.toLowerCase() === vault.toLowerCase());
      return decodeVaultLogs(own);
    },
  };
}

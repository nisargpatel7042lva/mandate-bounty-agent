import { z } from "zod";

export const TxHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed 32-byte tx hash");

/**
 * Registers a bounty the funder already created on-chain. The agent never trusts the client for
 * money fields: it reads them from the BountyCreated event in this transaction.
 */
export const CreateBountyRequestSchema = z.object({
  txHash: TxHash,
  title: z.string().trim().min(3).max(200),
  acceptanceCriteria: z.string().trim().min(10).max(5000),
});
export type CreateBountyRequest = z.infer<typeof CreateBountyRequestSchema>;

/** Wire shape of a bounty. Amounts are decimal strings of tUSDC base units (6 decimals). */
export interface BountyDto {
  id: number;
  chainId: number;
  vault: string;
  funder: string;
  repo: string;
  issueNumber: number;
  payoutAmount: string;
  mandate: {
    perPayoutCap: string;
    totalBudget: string;
    expiry: number;
    allowedPayees: string[];
  };
  funded: string;
  spent: string;
  createdTx: string;
  createdBlock: number;
  title: string | null;
  acceptanceCriteria: string | null;
}

export interface ApiError {
  error: string;
  issues?: { path: string; message: string }[];
}

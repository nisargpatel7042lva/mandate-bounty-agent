/** zkVerify submission (via Kurier) and status polling. */
export const ZKVERIFY_TESTNET = {
  name: "Volta",
  rpc: "wss://zkverify-volta-rpc.zkverify.io",
  explorer: "https://zkverify-testnet.subscan.io",
  kurierApi: "https://api-testnet.kurier.xyz/api/v1",
} as const;

/** zkVerify explorer link for a verification transaction. */
export const zkVerifyTxUrl = (txHash: string) => `${ZKVERIFY_TESTNET.explorer}/extrinsic/${txHash}`;

export * from "./kurier.ts";
export * from "./leaf.ts";
export type * from "./types.ts";

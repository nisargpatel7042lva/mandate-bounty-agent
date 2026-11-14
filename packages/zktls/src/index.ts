/** zkTLS proof that a GitHub PR was merged, via Reclaim zkFetch (chosen in Phase 0). */
export const ZKTLS_PROVIDER = "reclaim-zkfetch" as const;

export type { Proof as ZkTlsProof } from "@reclaimprotocol/js-sdk";
export * from "./github-pr.ts";
export * from "./prove.ts";
export * from "./verify.ts";
export * from "./attestors.ts";

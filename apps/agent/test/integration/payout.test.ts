import { mandateCommitmentHex, type MandateProof } from "@mba/circuits";
import { bountyVaultAbi, mockUSDCAbi, mockZkVerifyAbi } from "@mba/contracts";
import { ANVIL_ACCOUNTS, deployLocal, startAnvil, type Deployment, type LocalChain } from "@mba/contracts/testing";
import { statementLeaf, type JobState } from "@mba/zkverify";
import { eq } from "drizzle-orm";
import { createPublicClient, http, type Hex } from "viem";
import { foundry } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getBounty } from "../../src/bounties.ts";
import { createPayer } from "../../src/chain/payer.ts";
import { syncVault } from "../../src/chain/sync.ts";
import { openDb, type Db } from "../../src/db/client.ts";
import { bounties, claims, workProofs } from "../../src/db/schema.ts";
import type { ZkVerifier } from "../../src/mandate-step.ts";
import type { Payer } from "../../src/payout-step.ts";
import { processBounty } from "../../src/watcher.ts";

// Full payout path on a local chain: real Groth16 mandate proof, a local zkVerify stand-in that marks
// the TS-computed leaf on MockZkVerify (so the vault's Solidity leaf must match it), and the real
// viem payer signing BountyVault.release with the agent key.

const AGENT_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // anvil dev key 0 (public)
const VK_HASH = `0x${"5a".repeat(32)}` as Hex;
const FUNDER = ANVIL_ACCOUNTS[1];
const PAYEE = ANVIL_ACCOUNTS[2];

let chain: LocalChain;
let d: Deployment;

beforeAll(async () => {
  chain = await startAnvil(18547);
  d = await deployLocal(chain.rpcUrl, { vkHash: VK_HASH, aggregationRequired: true });
  for (const [fn, args] of [
    ["faucet", [10_000_000_000n]],
    ["approve", [d.bountyVault, 2n ** 256n - 1n]],
  ] as const) {
    const hash = await d.wallet.writeContract({ address: d.mockUsdc, abi: mockUSDCAbi, functionName: fn, args: args as never, account: FUNDER, chain: foundry });
    await d.publicClient.waitForTransactionReceipt({ hash });
  }
}, 60_000);

afterAll(() => chain?.stop());

/** Local zkVerify: "aggregates" a proof by marking its statement leaf on MockZkVerify. */
function localZk(): ZkVerifier {
  const jobs = new Map<string, Hex>();
  return {
    target: "AggregationPublished",
    domainId: 0,
    async submit(p: MandateProof) {
      const leaf = statementLeaf(VK_HASH, p.publicSignals);
      const hash = await d.wallet.writeContract({ address: d.zkVerify, abi: mockZkVerifyAbi, functionName: "markAggregated", args: [0n, 1n, leaf], account: ANVIL_ACCOUNTS[0], chain: foundry });
      await d.publicClient.waitForTransactionReceipt({ hash });
      const jobId = `local-${jobs.size + 1}`;
      jobs.set(jobId, leaf);
      return { jobId };
    },
    async status(jobId): Promise<JobState> {
      const leaf = jobs.get(jobId) as Hex;
      return {
        jobId,
        status: "AggregationPublished",
        chainId: 31337,
        txHash: `0x${"7a".repeat(32)}`,
        aggregationId: 1,
        statement: leaf,
        aggregationDetails: { receipt: "0x", receiptBlockHash: "0x", root: "0x", leaf, leafIndex: 0, numberOfLeaves: 1, merkleProof: [] },
      };
    },
  };
}

async function newBounty(db: Db, issue: number, pr: number): Promise<number> {
  const mandate = { perPayoutCap: 500_000_000n, totalBudget: 1_000_000_000n, expiry: BigInt(Math.floor(Date.now() / 1000) + 7 * 86_400) };
  const commitment = await mandateCommitmentHex({ ...mandate, allowedPayees: [PAYEE] });
  const hash = await d.wallet.writeContract({
    address: d.bountyVault,
    abi: bountyVaultAbi,
    functionName: "createAndFund",
    args: ["acme/widgets", BigInt(issue), 250_000_000n, { ...mandate, commitment }, [PAYEE], 400_000_000n],
    account: FUNDER,
    chain: foundry,
  });
  await d.publicClient.waitForTransactionReceipt({ hash });
  await syncVault(db, { client: d.publicClient, chainId: foundry.id, vault: d.bountyVault, deployBlock: d.deployBlock });
  const id = Number(await d.publicClient.readContract({ address: d.bountyVault, abi: bountyVaultAbi, functionName: "bountyCount" }));

  // Earlier stages (claim, approving review, verified zkTLS proof) as the watcher would leave them.
  db.insert(claims)
    .values({
      bountyId: id,
      repo: "acme/widgets",
      prNumber: pr,
      prUrl: `https://github.com/acme/widgets/pull/${pr}`,
      prTitle: "Wrap widgets",
      prBody: `mba-payee: ${PAYEE}`,
      author: "octocat",
      mergedAt: "2026-11-14T10:00:00Z",
      baseRef: "main",
      headSha: "a".repeat(40),
      closedAt: "2026-11-14T10:00:05Z",
      detectedAt: 1,
      verdict: { recommendation: "approve", criteriaMet: [{ criterion: "wraps", met: true, evidence: "css" }], summary: "ok", confidence: 0.9 },
      reviewAttempts: 1,
    })
    .run();
  db.insert(workProofs)
    .values({
      bountyId: id,
      claim: { repo: "acme/widgets", prNumber: pr, merged: true, mergedAt: "2026-11-14T10:00:00Z", baseRef: "main", author: "octocat", payee: PAYEE.toLowerCase() as Hex, lastEditor: null },
      identifier: `0x${pr.toString(16).padStart(2, "0").repeat(32)}`,
      signers: ["0xattestor"],
      verifiedAt: 1,
      attempts: 1,
    })
    .run();
  db.update(bounties).set({ status: "work_proven" }).where(eq(bounties.id, id)).run();
  return id;
}

const balance = (who: Hex) => d.publicClient.readContract({ address: d.mockUsdc, abi: mockUSDCAbi, functionName: "balanceOf", args: [who] });
const chainNow = async () => Number((await d.publicClient.getBlock()).timestamp);

describe("gated payout on a local chain", () => {
  it("proves the mandate, passes the vault's on-chain zkVerify check, and pays the payee once", async () => {
    const { db } = openDb(":memory:");
    const id = await newBounty(db, 1, 11);
    const payer = createPayer(createPublicClient({ chain: foundry, transport: http(chain.rpcUrl) }), { rpcUrl: chain.rpcUrl, chainId: foundry.id, vault: d.bountyVault, agentKey: AGENT_KEY });
    const before = await balance(PAYEE);

    // Use chain time so the vault's freshness check (checkedAt <= block.timestamp) holds.
    let nowCache = await chainNow();
    const deps = { github: undefined as never, zkverify: localZk(), payer, now: () => nowCache };
    const step = await processBounty(db, deps, id);
    expect(step).toMatchObject({ action: "paid" });

    expect((await balance(PAYEE)) - before).toBe(250_000_000n);
    const onChain = await d.publicClient.readContract({ address: d.bountyVault, abi: bountyVaultAbi, functionName: "getBounty", args: [BigInt(id)] });
    expect(onChain.paid).toBe(true);
    expect(onChain.spent).toBe(250_000_000n);
    expect(getBounty(db, id)).toMatchObject({ status: "paid", payout: { state: "paid" }, mandateProof: { state: "verified", zkVerify: { aggregationId: 1 } } });

    // Running the watcher again pays nothing more.
    nowCache = await chainNow();
    expect((await processBounty(db, deps, id)).action).toBe("done");
    expect((await balance(PAYEE)) - before).toBe(250_000_000n);
  }, 120_000);

  it("crash after broadcasting: the restarted agent reconciles with the vault and never pays twice", async () => {
    const { db } = openDb(":memory:");
    const id = await newBounty(db, 2, 12);
    const real = createPayer(createPublicClient({ chain: foundry, transport: http(chain.rpcUrl) }), { rpcUrl: chain.rpcUrl, chainId: foundry.id, vault: d.bountyVault, agentKey: AGENT_KEY });
    let sends = 0;
    const crashing: Payer = {
      ...real,
      async release(input) {
        sends++;
        const hash = await real.release(input);
        await d.publicClient.waitForTransactionReceipt({ hash });
        throw new Error("agent crashed before storing the tx hash");
      },
    };
    const before = await balance(PAYEE);
    const nowCache = await chainNow();
    const deps = { github: undefined as never, zkverify: localZk(), payer: crashing, now: () => nowCache };

    expect((await processBounty(db, deps, id)).action).toBe("waiting"); // crashed mid-payout
    expect(getBounty(db, id)?.status).toBe("mandate_proven");

    // Restart with a healthy payer: it must see the vault already paid and not send again.
    const healthy: Payer = { ...real, release: async (i) => (sends++, real.release(i)) };
    expect((await processBounty(db, { ...deps, payer: healthy }, id)).action).toBe("paid");
    expect(sends).toBe(1);
    expect((await balance(PAYEE)) - before).toBe(250_000_000n);

    // And the vault itself refuses a second release outright.
    await expect(healthy.release({ bountyId: BigInt(id), payee: PAYEE, amount: 250_000_000n, claimId: `0x${"0c".repeat(32)}`, prNumber: 12n, checkedAt: BigInt(nowCache), proofRef: `0x${"0".repeat(64)}`, agg: { domainId: 0n, aggregationId: 1n, merklePath: [], leafCount: 1n, index: 0n } })).rejects.toThrow(/AlreadyPaid/);
  }, 120_000);
});

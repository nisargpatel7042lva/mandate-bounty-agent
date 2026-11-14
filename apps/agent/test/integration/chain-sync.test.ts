import { bountyVaultAbi, mockUSDCAbi } from "@mba/contracts";
import { ANVIL_ACCOUNTS, deployLocal, startAnvil, type Deployment, type LocalChain } from "@mba/contracts/testing";
import type { BountyDto } from "@mba/shared";
import { foundry } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { getBounty } from "../../src/bounties.ts";
import { createVaultReader } from "../../src/chain/reader.ts";
import { syncVault } from "../../src/chain/sync.ts";
import { openDb } from "../../src/db/client.ts";

const FUNDER = ANVIL_ACCOUNTS[1];
const PAYEE = ANVIL_ACCOUNTS[2];

let chain: LocalChain;
let d: Deployment;

beforeAll(async () => {
  chain = await startAnvil(18545);
  d = await deployLocal(chain.rpcUrl);
  const write = async (args: Parameters<Deployment["wallet"]["writeContract"]>[0]) =>
    d.publicClient.waitForTransactionReceipt({ hash: await d.wallet.writeContract(args) });
  await write({ address: d.mockUsdc, abi: mockUSDCAbi, functionName: "faucet", args: [10_000_000_000n], account: FUNDER, chain: foundry });
  await write({
    address: d.mockUsdc,
    abi: mockUSDCAbi,
    functionName: "approve",
    args: [d.bountyVault, 2n ** 256n - 1n],
    account: FUNDER,
    chain: foundry,
  });
}, 60_000);

afterAll(() => chain?.stop());

const expiry = () => BigInt(Math.floor(Date.now() / 1000) + 7 * 86_400);
/** Sync does not interpret the commitment; any non-zero bytes32 is accepted by the vault. */
const COMMIT = `0x${"c0".repeat(32)}` as const;

async function createAndFund(issue: bigint, fund: bigint) {
  const hash = await d.wallet.writeContract({
    address: d.bountyVault,
    abi: bountyVaultAbi,
    functionName: "createAndFund",
    args: ["acme/widgets", issue, 250_000_000n, { perPayoutCap: 500_000_000n, totalBudget: 1_000_000_000n, expiry: expiry(), commitment: COMMIT }, [PAYEE], fund],
    account: FUNDER,
    chain: foundry,
  });
  await d.publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

describe("chain sync against anvil", () => {
  it("mirrors creation, funding and mandate updates, across chunk boundaries", async () => {
    const { db } = openDb(":memory:");
    const ctx = { client: d.publicClient, chainId: foundry.id, vault: d.bountyVault, deployBlock: d.deployBlock, chunkSize: 2n };

    await createAndFund(7n, 400_000_000n);
    const top = await d.wallet.writeContract({
      address: d.bountyVault,
      abi: bountyVaultAbi,
      functionName: "fund",
      args: [1n, 100_000_000n],
      account: FUNDER,
      chain: foundry,
    });
    await d.publicClient.waitForTransactionReceipt({ hash: top });
    const upd = await d.wallet.writeContract({
      address: d.bountyVault,
      abi: bountyVaultAbi,
      functionName: "updateMandate",
      args: [1n, { perPayoutCap: 300_000_000n, totalBudget: 900_000_000n, expiry: expiry(), commitment: COMMIT }, [PAYEE, FUNDER]],
      account: FUNDER,
      chain: foundry,
    });
    await d.publicClient.waitForTransactionReceipt({ hash: upd });

    const r = await syncVault(db, ctx);
    expect(r.events).toBe(4); // created, funded, funded, mandateUpdated

    const b = getBounty(db, 1);
    expect(b).toMatchObject({ id: 1, repo: "acme/widgets", issueNumber: 7, funded: "500000000", funder: FUNDER.toLowerCase() });
    expect(b?.mandate.perPayoutCap).toBe("300000000");
    expect(b?.mandate.allowedPayees).toEqual([PAYEE.toLowerCase(), FUNDER.toLowerCase()]);

    // A second sync is a no-op and the state matches the contract.
    expect((await syncVault(db, ctx)).events).toBe(0);
    const onChain = await d.publicClient.readContract({ address: d.bountyVault, abi: bountyVaultAbi, functionName: "getBounty", args: [1n] });
    expect(b?.funded).toBe(onChain.funded.toString());
  });

  it("POST /bounties registers from a real tx and survives a later sync", async () => {
    const { db } = openDb(":memory:");
    const reader = createVaultReader(d.publicClient, foundry.id, d.bountyVault);
    const app = createApp({ db, chain: reader, corsOrigins: [] });
    const hash = await createAndFund(8n, 250_000_000n);

    const res = await app.request("/bounties", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ txHash: hash, title: "Real chain bounty", acceptanceCriteria: "Must pass the integration suite." }),
    });
    expect(res.status).toBe(201);
    const dto = (await res.json()) as BountyDto;
    expect(dto).toMatchObject({ issueNumber: 8, funded: "250000000", title: "Real chain bounty", createdTx: hash });

    await syncVault(db, { client: d.publicClient, chainId: foundry.id, vault: d.bountyVault, deployBlock: d.deployBlock });
    expect(getBounty(db, dto.id)?.title).toBe("Real chain bounty");
  });

  it("POST /bounties rejects a mined but reverted tx", async () => {
    const { db } = openDb(":memory:");
    const app = createApp({ db, chain: createVaultReader(d.publicClient, foundry.id, d.bountyVault), corsOrigins: [] });
    // Fixed gas skips estimation, so the invalid call (zero payout) is mined and reverts.
    const hash = await d.wallet.writeContract({
      address: d.bountyVault,
      abi: bountyVaultAbi,
      functionName: "createBounty",
      args: ["acme/widgets", 9n, 0n, { perPayoutCap: 1n, totalBudget: 1n, expiry: expiry(), commitment: COMMIT }, [PAYEE]],
      account: FUNDER,
      chain: foundry,
      gas: 500_000n,
    });
    expect((await d.publicClient.waitForTransactionReceipt({ hash })).status).toBe("reverted");

    const res = await app.request("/bounties", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ txHash: hash, title: "Reverted", acceptanceCriteria: "Should never be stored." }),
    });
    expect(res.status).toBe(422);
  });
});

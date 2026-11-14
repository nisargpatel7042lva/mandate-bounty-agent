// Local-chain helpers for integration and E2E tests: start anvil, deploy the contracts.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, type Address, type PublicClient, type WalletClient } from "viem";
import { foundry } from "viem/chains";
import { bountyVaultAbi, bountyVaultBytecode, mockUSDCAbi, mockUSDCBytecode, mockZkVerifyAbi, mockZkVerifyBytecode } from "../generated/index.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Anvil's default dev accounts 0..2 (public, well-known test keys; never hold real funds). */
export const ANVIL_ACCOUNTS = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
] as const satisfies readonly Address[];

export interface LocalChain {
  rpcUrl: string;
  stop: () => void;
}

async function waitForRpc(rpcUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`anvil did not come up at ${rpcUrl} within ${timeoutMs}ms`);
}

/** Starts anvil on `port` (through WSL on Windows, where Foundry is installed). */
export async function startAnvil(port: number): Promise<LocalChain> {
  const child: ChildProcess = spawn(process.execPath, [path.join(repoRoot, "scripts/tool.mjs"), "anvil", "--port", String(port), "--silent"], {
    stdio: "ignore",
  });
  const rpcUrl = `http://127.0.0.1:${port}`;
  const stop = () => {
    child.kill();
    // Killing wsl.exe does not always reach the Linux process; stop it explicitly.
    if (process.platform === "win32") spawnSync("wsl", ["pkill", "-f", `anvil --port ${port}`], { stdio: "ignore" });
  };
  try {
    await waitForRpc(rpcUrl, 30_000);
  } catch (err) {
    stop();
    throw err;
  }
  return { rpcUrl, stop };
}

export interface Deployment {
  mockUsdc: Address;
  bountyVault: Address;
  /** MockZkVerify standing in for zkVerify's aggregation contract. */
  zkVerify: Address;
  /** The release signer (anvil account 0, the deployer). */
  agent: Address;
  deployBlock: bigint;
  publicClient: PublicClient;
  wallet: WalletClient;
}

/** Deploys MockUSDC + MockZkVerify + BountyVault from anvil account 0, which is also the agent signer. */
export async function deployLocal(rpcUrl: string, opts: { vkHash?: `0x${string}`; aggregationRequired?: boolean } = {}): Promise<Deployment> {
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain: foundry, transport });
  const wallet = createWalletClient({ chain: foundry, transport, account: ANVIL_ACCOUNTS[0] });

  const usdcTx = await wallet.deployContract({ abi: mockUSDCAbi, bytecode: mockUSDCBytecode, account: ANVIL_ACCOUNTS[0], chain: foundry });
  const usdc = await publicClient.waitForTransactionReceipt({ hash: usdcTx });
  if (!usdc.contractAddress) throw new Error("MockUSDC deploy failed");

  const zkTx = await wallet.deployContract({ abi: mockZkVerifyAbi, bytecode: mockZkVerifyBytecode, account: ANVIL_ACCOUNTS[0], chain: foundry });
  const zk = await publicClient.waitForTransactionReceipt({ hash: zkTx });
  if (!zk.contractAddress) throw new Error("MockZkVerify deploy failed");

  const vaultTx = await wallet.deployContract({
    abi: bountyVaultAbi,
    bytecode: bountyVaultBytecode,
    args: [usdc.contractAddress, ANVIL_ACCOUNTS[0], zk.contractAddress, opts.vkHash ?? `0x${"0".repeat(64)}`, opts.aggregationRequired ?? true],
    account: ANVIL_ACCOUNTS[0],
    chain: foundry,
  });
  const vault = await publicClient.waitForTransactionReceipt({ hash: vaultTx });
  if (!vault.contractAddress) throw new Error("BountyVault deploy failed");

  return {
    mockUsdc: usdc.contractAddress,
    bountyVault: vault.contractAddress,
    zkVerify: zk.contractAddress,
    agent: ANVIL_ACCOUNTS[0],
    deployBlock: usdc.blockNumber,
    publicClient,
    wallet,
  };
}

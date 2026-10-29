# Mandate Bounty Agent

An AI agent that pays open-source bounties only when it can **prove** the work was delivered
and **prove** the payout stayed inside the funder's mandate.

> The LLM proposes, the proofs dispose.

Status: Phase 1, creating and funding bounties. Research notes are in [docs/phase-0-findings.md](docs/phase-0-findings.md).

## What works

A funder connects a wallet, sets a payout and a mandate (per-payout cap, total budget, payee
allowlist, expiry), and creates and funds the bounty on-chain in one transaction. The agent mirrors
the vault's state into SQLite and lists the bounty. Every money field comes from chain events and
never from the request body.

## Layout

```
apps/agent/          Hono API, chain sync, SQLite (Drizzle)
apps/web/            Next.js dashboard: create form, list, detail
packages/contracts/  BountyVault + MockUSDC (Foundry), generated ABIs, local-chain test helpers
packages/shared/     zod schemas, reference checkMandate(), shared test vectors
packages/circuits/   mandate circuit (Phase 5)
packages/zktls/      Reclaim zkFetch wrapper (Phase 4)
packages/zkverify/   zkVerify submission (Phase 6)
```

## Checks

```bash
pnpm install
pnpm check   # typecheck, lint, build, unit, integration (anvil), Playwright E2E
```

Foundry and circom live in WSL on Windows; `scripts/tool.mjs` routes `forge` and `anvil` there
automatically. Check the toolchain with `wsl bash scripts/doctor.sh`.

## Run against Ethereum Sepolia

1. `cp .env.example .env` and set `DEPLOYER_PRIVATE_KEY` to a **testnet-only** key funded with Sepolia ETH.
2. Deploy: `wsl bash scripts/deploy-testnet.sh`. This writes `packages/contracts/deployments/11155111.json`.
3. Put `bountyVault` and `deployBlock` from that file into `.env` as `VAULT_ADDRESS` and `VAULT_DEPLOY_BLOCK`.
4. Start the agent: `pnpm --filter @mba/agent start`.
5. `cp apps/web/.env.example apps/web/.env.local`, fill in the vault and USDC addresses, then run `pnpm --filter @mba/web dev`.
6. Open http://localhost:3000, connect MetaMask on Sepolia, use the faucet, and create a bounty.

To create one from the CLI instead (agent running):
`cd apps/agent && node --env-file=../../.env --experimental-strip-types scripts/testnet-bounty.ts owner/repo 1`

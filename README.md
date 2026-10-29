# Mandate Bounty Agent

An AI agent that pays open-source bounties only when it can **prove** the work was delivered
and **prove** the payout stayed inside the funder's mandate.

> The LLM proposes, the proofs dispose.

Status: Phase 2, detecting merged PRs and writing an advisory review. Research notes are in [docs/phase-0-findings.md](docs/phase-0-findings.md).

## What works

A funder connects a wallet, sets a payout and a mandate (per-payout cap, total budget, payee
allowlist, expiry), and creates and funds the bounty on-chain in one transaction. The agent mirrors
the vault's state into SQLite and lists the bounty. Every money field comes from chain events and
never from the request body.

The agent then watches the bounty's GitHub issue. When GitHub records that a merged pull request in
the same repository closed it, the agent stores that PR as the claim. Claude (`claude-opus-5-5`)
then reviews the diff against the funder's acceptance criteria and returns a schema-checked verdict:
approve, reject or needs_human, with evidence for each criterion. The verdict is advice only:
nothing it says can move or block funds. Status: `open → claimed → reviewed` (or `review_failed`).

Watcher settings (root `.env`): `GITHUB_TOKEN`, or `GITHUB_TOKEN_COMMAND=gh auth token` for local
dev; `ANTHROPIC_API_KEY` for reviews (without it, claims wait for review); `GITHUB_POLL_INTERVAL_MS`.
`POST /bounties/:id/check` runs a check immediately.

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

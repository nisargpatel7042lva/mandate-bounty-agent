# Mandate Bounty Agent

An AI agent that pays open-source bounties only when it can **prove** the work was delivered
and **prove** the payout stayed inside the funder's mandate.

> The LLM proposes, the proofs dispose.

Status: Phases 0 to 5 built (create, detect, review, zkTLS proof, mandate proof on zkVerify, gated payout with receipts). Research notes are in [docs/phase-0-findings.md](docs/phase-0-findings.md).

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

Next the agent proves the merge over zkTLS (Reclaim zkFetch). It asks GitHub's GraphQL API for the
PR's number, merged flag, merge time, base branch, author and repository. A Reclaim attestor signs
the answer, bound to this bounty, and the GitHub token stays private. The agent verifies the proof
offline against Reclaim's published attestors, checking the signature, the request, the bounty
binding and every field. Status then becomes `work_proven` (or `work_proof_failed` with a reason
code). The raw proof is served at `GET /bounties/:id/proof` for anyone to re-verify.

Then the agent proves the payout fits the mandate. A Groth16 circuit (Circom, BN254) shows the amount
is within the per-payout cap and remaining budget, the payee is on the allowlist and the mandate has not
expired. It does this against the Poseidon commitment the funder put on-chain, and binds the zkTLS claim
ID and bounty ID as public inputs. The agent submits the proof to zkVerify through Kurier and waits for
it to be aggregated to Ethereum Sepolia. Status: `mandate_proven` (or `mandate_rejected` with reason
codes such as `OVER_CAP`).

Finally the agent calls `BountyVault.release`. The vault rebuilds the zkVerify statement leaf from the
public inputs and its registered verification key hash, and checks it against zkVerify's aggregation
contract on-chain. It also refuses a second payment for the same bounty, PR, claim or proof, and any
amount but the bounty's payout. If the advisory review did not approve, the payout is held
(`held_for_funder`) until the funder calls `approveDespiteReview`. A paid bounty has a public receipt at
`/receipts/:id` with the payment, PR, review, zkTLS claim and zkVerify references.

Watcher settings (root `.env`): `GITHUB_TOKEN`, or `GITHUB_TOKEN_COMMAND=gh auth token` for local
dev; `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` for reviews (without one, claims wait for review); `RECLAIM_APP_ID` + `RECLAIM_APP_SECRET` for work proofs (without them, reviewed bounties wait); `GITHUB_POLL_INTERVAL_MS`; `KURIER_API_KEY` + `ZKVERIFY_VK_HASH` for mandate proofs; `AGENT_PRIVATE_KEY` (the vault's agent signer, funded with Sepolia ETH for gas) for payouts.
`POST /bounties/:id/check` runs a check immediately.

## Layout

```
apps/agent/          Hono API, chain sync, SQLite (Drizzle)
apps/web/            Next.js dashboard: create form, list, detail
packages/contracts/  BountyVault + MockUSDC (Foundry), generated ABIs, local-chain test helpers
packages/shared/     zod schemas, reference checkMandate(), shared test vectors
packages/circuits/   mandate circuit (Circom/Groth16), prover, committed testnet setup artifacts
packages/zktls/      Reclaim zkFetch proof of the merged PR, offline verifier
packages/zkverify/   Kurier client, zkVerify statement leaf (matches the vault)
```

## Checks

```bash
pnpm install
pnpm check   # typecheck, lint, build, unit, integration (anvil), Playwright E2E
```

Foundry and circom live in WSL on Windows; `scripts/tool.mjs` routes `forge` and `anvil` there
automatically. Check the toolchain with `wsl bash scripts/doctor.sh`.

## Run against Ethereum Sepolia

1. `cp .env.example .env` and set `DEPLOYER_PRIVATE_KEY` to a **testnet-only** key funded with Sepolia ETH,
   plus `KURIER_API_KEY` (testnet.kurier.xyz) and `RECLAIM_APP_ID`/`RECLAIM_APP_SECRET` (dev.reclaimprotocol.org, zkFetch enabled).
2. `cd apps/agent && node --env-file=../../.env --experimental-strip-types scripts/testnet-setup.ts` registers the
   mandate verification key on zkVerify (`ZKVERIFY_VK_HASH`) and creates the agent signer (`AGENT_PRIVATE_KEY`,
   `AGENT_ADDRESS`). Send the agent address a little Sepolia ETH for gas.
3. Deploy: `wsl bash scripts/deploy-testnet.sh`. This writes `packages/contracts/deployments/11155111.json`.
4. Put `bountyVault` and `deployBlock` from that file into `.env` as `VAULT_ADDRESS` and `VAULT_DEPLOY_BLOCK`.
5. Start the agent: `pnpm --filter @mba/agent start`.
6. `cp apps/web/.env.example apps/web/.env.local`, fill in the vault and USDC addresses, then run `pnpm --filter @mba/web dev`.
7. Open http://localhost:3000, connect MetaMask on Sepolia, use the faucet, and create a bounty.

To create one from the CLI instead (agent running):
`cd apps/agent && node --env-file=../../.env --experimental-strip-types scripts/testnet-bounty.ts owner/repo 1`

Current Sepolia deployment: BountyVault v2 `0x3c4eB442e4e4aD8a19785970e911aA7C2221E046`, MockUSDC
`0xe6a0fb19a39f84dEdd30Aa02643A338Ae49E31c2`, zkVerify aggregation proxy `0xEA0A0f1EfB1088F4ff0Def03741Cb2C64F89361E`.
`apps/agent/scripts/zkverify-smoke.ts` sends one sample mandate proof through zkVerify aggregation, with no chain funds.

The circuit's trusted setup is a single-party testnet ceremony. It is fine for a demo and not for production.

# Agent Games: Wildcard submission

Copy-paste source for the submission form. Links marked TODO are filled in once the agent is on Fly.

**Agent name:** Mandate Bounty Agent

**One line:** An AI agent that pays open-source bounties only when it can prove the work was merged
and prove the payout stays inside the funder's mandate. The LLM proposes, the proofs dispose.

## Links

- Repository: https://github.com/nisargpatel7042lva/mandate-bounty-agent
- Live app: https://mandate-bounty-agent.vercel.app
- Agent endpoint: https://mandate-bounty-agent.fly.dev (TODO: confirm once deployed; `GET /health`, `GET /bounties`)
- Live receipt of a real payout: https://mandate-bounty-agent.vercel.app/receipts/1
- zkVerify proof reference: https://zkverify-testnet.subscan.io/extrinsic/0x867ef853b1f1f6ff4729883337c749e66812d968c550bcfd20044ae14391c6fe
  (aggregation #270047, domain 0, published to Ethereum Sepolia)
- Payout transaction: https://sepolia.etherscan.io/tx/0x53cac6e8e6c9f74bb67e4e651815b7a3f6f058536cebacfa8f5856ce59b88c4a

## Use case

Open-source bounties are paid on trust. A maintainer, or a bot acting for them, decides that a pull
request "counts" and sends money. That breaks in both directions:

- Funders can't safely hand payouts to an AI agent. An LLM can be wrong or prompt-injected through
  the very PR it is reviewing, and nothing stops it from overpaying, paying twice, or paying the wrong
  wallet.
- Contributors can't check why they were or weren't paid.

Mandate Bounty Agent is for funders who want bounties paid automatically without trusting the agent
with the money, and for contributors who want a receipt anyone can check. The funder sets a mandate
on-chain (per-payout cap, total budget, payee allowlist, expiry). The agent can recommend anything,
but the vault releases funds only when two proofs check out.

## What it does

1. **Create.** The funder creates and funds a bounty for a GitHub issue in one transaction. The vault
   stores the mandate and a Poseidon commitment to it.
2. **Detect.** The agent watches the issue. When GitHub records a merged PR that closed it, the agent
   takes that PR as the claim. The contributor names their wallet in the PR description
   (`mba-payee: 0x…`).
3. **Review (advice only).** An LLM (Gemini) checks the diff against the acceptance criteria and
   returns a schema-checked verdict with evidence. It cannot release or block funds. If it says "not
   met", the payout is held until the funder approves on-chain.
4. **Prove the work (zkTLS).** Reclaim zkFetch proves what GitHub's API said: this PR is merged, into
   this branch, by this author, with this payee line written by the author. The proof is bound to this
   chain, vault and bounty, and the GitHub token stays private.
5. **Prove the mandate (Groth16 → zkVerify).** A Circom circuit proves the payout fits the committed
   mandate: within the cap, within the remaining budget, payee on the allowlist, not expired. The
   zkTLS claim ID and bounty ID are public inputs. The agent submits the proof to zkVerify through
   Kurier, and it is aggregated to Ethereum Sepolia.
6. **Pay.** `BountyVault.release` rebuilds the zkVerify statement leaf from the public inputs and
   calls zkVerify's aggregation contract on-chain. It refuses replays (same bounty, PR, claim or proof)
   and any amount but the bounty's payout.
7. **Receipt.** A public page shows the payment, PR, review, zkTLS claim, mandate commitment, zkVerify
   transaction and every public input.

## Build context and key decisions

- **The model never touches money.** The LLM's verdict is stored and shown, but the vault's release
  path doesn't read it. Only the two proofs and the funder's on-chain override matter.
- **zkTLS bound into a zkVerify proof.** zkVerify has no zkTLS verifier, so the agent puts the zkTLS
  claim ID into the mandate proof's public inputs. One on-chain check covers both: the vault pays only
  for the exact claim that was proven.
- **Commitment without the bounty ID.** The funder computes the mandate commitment before the bounty
  exists, so the bounty ID is a separate public input, not part of the commitment.
- **Crash safety.** The agent records a payout before sending it and checks the vault before any
  resend. A crash after broadcast never pays twice; this is covered by an integration test.
- **Verified against the real network.** zkVerify's statement for our proof equals the leaf computed
  by both the TypeScript agent and the Solidity vault. A shared test vector keeps all three in sync.
- **Stack.** TypeScript monorepo: Hono agent with SQLite and viem; Next.js web; Circom/snarkjs;
  Solidity/Foundry; Vitest and Playwright. The agent runs on Fly.io, the web on Vercel, and the
  contracts on Ethereum Sepolia.

## What it can and cannot do

- **It can:** pay a bounty end to end with no human step when the work is merged, the mandate holds
  and the review approves. It holds a payout for the funder when the review disagrees, and refuses
  out-of-mandate or duplicate payouts with reason codes.
- **It cannot:** judge code quality beyond the advisory review. The proofs show that a PR was merged
  and that the payout fits the mandate, not that the code is good. It does not prove the payee
  controls the wallet; it proves the PR author wrote that address.
- **Testnet only.** The circuit's trusted setup is a single-party ceremony, fine for a demo and not
  for production. Payouts use a mock USDC on Sepolia.

## zkVerify: the checkable claim

"This payout of X to wallet W for bounty B is within the funder's committed mandate, and it pays for
the GitHub PR proven by zkTLS claim C." The Groth16 proof is verified by zkVerify and aggregated to
Sepolia, where the vault checks the aggregation itself before moving funds. Reference: aggregation
#270047 (domain 0), extrinsic `0x867ef853…c6fe`, leaf `0x7fb55b1a…07b3`.

## Tests

- Foundry: 43 contract tests, including replay and leaf-vector tests.
- 106 agent unit tests and the package test suites.
- Integration tests on a local chain: the payout path, and a crash after broadcast that must not pay
  twice.
- A real Reclaim zkTLS test.
- Playwright end-to-end tests: a paid bounty with its receipt, a held-then-approved bounty, and a PR
  that cannot be paid twice.

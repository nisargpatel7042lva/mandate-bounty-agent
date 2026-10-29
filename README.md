# Mandate Bounty Agent

An AI agent that pays open-source bounties only when it can **prove** the work was delivered
and **prove** the payout stayed inside the funder's mandate.

> The LLM proposes, the proofs dispose.

Status: Phase 0 (research and scaffold). See [docs/phase-0-findings.md](docs/phase-0-findings.md).

## Layout

```
apps/agent/          HTTP service, watcher, LLM review, proof orchestration
apps/web/            Next.js dashboard + receipt pages
packages/circuits/   mandate circuit, build scripts, test vectors
packages/contracts/  BountyVault, Foundry tests
packages/zktls/      wrapper for the zkTLS provider
packages/zkverify/   zkVerify submission + status polling
packages/shared/     types, zod schemas, reference mandate check
```

## Checks

```bash
pnpm install
pnpm check                  # typecheck, lint, unit, integration
wsl bash scripts/doctor.sh  # Foundry + circom toolchain
```

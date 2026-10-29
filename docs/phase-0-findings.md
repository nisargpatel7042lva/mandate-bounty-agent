# Phase 0 findings (2026-10-29)

Sources: zkVerify docs repo (github.com/zkVerify/zkverify-docs @ main), agentgames.zkverify.io,
npm registry, and the Mandate repo (github.com/nisargpatel7042lva/mandate).

## 1. Wildcard track requirements (agentgames.zkverify.io/events/wildcard)

- Window: 21 Oct to 19 Nov 2026. Prize pool 100,000 VFY (50k / 30k / 20k).
- Submission form asks for: agent link (repo, demo, or write-up), **a public HTTPS endpoint**,
  use case, build context, and optionally the zkVerify "checkable claim" plus a proof reference.
- Judging (no weights published): useful problem, working implementation, clear explanation,
  verifiability via zkVerify (optional plus).
- Platform rules (all events): prize eligibility needs a connected GitHub account **and** wallet
  on the Agent Games profile before close. The HMAC-signed task protocol applies to arena events
  (Proof Gatekeeper, Steal the VFY); the Wildcard page does not require it.

## 2. zkVerify

- Supported verifiers: Groth16 (BN254 / BN128 / BLS12-381, max 64 public inputs), Fflonk,
  Noir UltraHonk / UltraPlonk, RISC0 v2.1 to v2.3, SP1 v5, Plonky2, EZKL, TEE (Intel TDX, AWS Nitro).
- **There is no zkTLS verifier.** None of Reclaim, Primus, or TLSNotary can be verified natively.
- Circom + snarkjs Groth16 is a first-class path: submit through Kurier (REST) or zkverifyjs.
  zkverifyjs 3.3.1 (published 2026-10-21) is current.
- Two consumption modes:
  - **Direct**: submit the proof, poll the job status until `Finalized`, then record the zkVerify tx hash.
    This is off-chain trust in the agent reading that status.
  - **Aggregation**: proofs get batched; an EVM contract calls
    `verifyProofAggregation(domainId, aggregationId, leaf, merklePath, leafCount, index)` on the
    zkVerify proxy. This is the trust-minimised path we want for the vault.
- Base Sepolia (84532) proxy: `0x0807C544D38aE7729f8798388d89Be6502A1e8A8`. Sepolia, Arbitrum Sepolia,
  OP Sepolia and others are also listed.
- Leaf for Groth16 = keccak256(abi.encodePacked(keccak256("groth16"), vkHash, sha256(""), keccak256(pubs))),
  following the docs' smart-contract tutorial. Exact pubs encoding to be confirmed in Phase 6 against a live aggregation.
- Testnet: Volta, token tVFY (faucet: faucy.com/zkverify-volta or Discord). Kurier testnet needs an API key
  (testnet.kurier.xyz).

## 3. zkTLS provider

| Option | Node server-side | Hides GitHub token | Output | Path into zkVerify |
| --- | --- | --- | --- | --- |
| Reclaim zkFetch 1.1.0 | yes | yes (`privateOptions.headers`) | claim + attestor ECDSA signature(s) | none native |
| Primus core SDK 0.3.9 | yes | yes | attestor-signed attestation | none native |
| TLSNotary | Rust | yes | notary-signed attestation | none native |

Reclaim zkFetch is the best fit. It has a backend mode with app ID and secret. It supports
`context.contextAddress` / `contextMessage`, which lets us bind the bounty ID and payee into the
signed claim, and its regex `responseMatches` can pin `merged:true`, the PR number and the merger login.
It also ships `verifyProof` / `transformForOnchain`.

## 4. Mandate reuse

- `PermissionMirror.PermissionScope` gives `maxPositionSizeUsdc` (per-payout cap),
  `maxDailySpendUsdc` (budget), and `expiry` → reused as the BountyVault mandate struct.
- `src/lib/underwriting.ts` has deterministic ordered checks with reason strings → ported as
  `packages/shared/src/mandate-check.ts` (reference semantics; circuit and contract must match it).
- Gap: Mandate tracks cumulative spend off-chain only. BountyVault must track `spent` on-chain.
- Not reused: ENS/relayer sync, SwapVM opcode, ERC-8004 reputation (out of scope here).

## 5. Toolchain (this machine)

- Windows: node 22.23, pnpm 10.7, git, gh, docker.
- WSL: forge/anvil 1.8.4, cargo/rustc 1.99, circom 2.2.3 (installed in Phase 0).
- TypeScript pinned to 6.0.3 (typescript-eslint 8.72 does not support TS 7 yet).

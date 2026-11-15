"use client";

import type { BountyDto } from "@mba/shared";
import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { CountUp, Line, Method, type Step } from "../components/home.tsx";
import { ProofField } from "../components/ProofField.tsx";
import { useConfig } from "../components/use-config.ts";
import { agentApi } from "../lib/api.ts";
import { formatUsdc } from "../lib/format.ts";
import { STATUS } from "../lib/status.ts";

const STRIP = ["Reclaim zkTLS", "Circom · Groth16", "zkVerify", "Ethereum Sepolia", "Poseidon commitments", "Gemini review · advice only", "Replay-proof vault"];

const STEPS: Step[] = [
  {
    key: "fund",
    short: "Fund",
    title: (
      <>
        Lock the budget, <span className="it">and the rules.</span>
      </>
    ),
    body: "A funder puts test USDC in the vault for one GitHub issue, with a mandate: the most a single payout can be, a total budget, the wallets allowed to be paid, and an expiry. Only a Poseidon hash of the mandate goes on-chain.",
    tags: ["BountyVault", "Poseidon commitment"],
  },
  {
    key: "detect",
    short: "Detect",
    title: (
      <>
        Wait for the <span className="it">merge.</span>
      </>
    ),
    body: "The agent watches the issue. When GitHub records a merged pull request that closed it, that PR becomes the claim. The contributor names their wallet in the description: mba-payee: 0x…",
    tags: ["GitHub GraphQL", "Watcher"],
  },
  {
    key: "review",
    short: "Review — advice only",
    advice: true,
    title: (
      <>
        Ask the model. <span className="it">Never obey it.</span>
      </>
    ),
    body: "Gemini reads the diff against the acceptance criteria and gives a verdict with evidence. The vault never reads it. If the model says the work isn't done, the payout waits for the funder instead of guessing.",
    tags: ["Gemini", "Advisory", "Funder override"],
  },
  {
    key: "zktls",
    short: "Prove the merge",
    title: (
      <>
        Prove what GitHub <span className="it">actually said.</span>
      </>
    ),
    body: "Reclaim zkTLS proves GitHub's API response: this PR is merged, into this branch, by this author, naming this wallet. The proof is bound to this chain, vault and bounty, and the GitHub token never leaves the agent.",
    tags: ["Reclaim zkFetch", "Attestor signatures"],
  },
  {
    key: "mandate",
    short: "Prove the mandate",
    title: (
      <>
        One proof, <span className="it">two claims.</span>
      </>
    ),
    body: "A Groth16 circuit proves the payout fits the committed mandate: under the cap, within budget, to an allowed wallet, before expiry. The zkTLS claim ID is a public input, so one proof on zkVerify covers both the rules and the exact PR.",
    tags: ["Circom", "Groth16", "zkVerify aggregation"],
  },
  {
    key: "release",
    short: "Release",
    title: (
      <>
        No match, <span className="it">no money.</span>
      </>
    ),
    body: "The vault rebuilds the proof's statement itself and checks it against zkVerify's contract on Sepolia before paying. The same bounty, PR, claim or proof can never be paid twice. Every payout gets a public receipt.",
    tags: ["verifyProofAggregation", "Public receipt"],
  },
];

export default function HomePage() {
  const cfg = useConfig();
  const [bounties, setBounties] = useState<BountyDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cfg.ok) return;
    agentApi(cfg.config.agentUrl)
      .list()
      .then(setBounties)
      .catch((e: Error) => setError(`Could not reach the agent: ${e.message}`));
  }, [cfg]);

  const paid = bounties?.filter((b) => b.status === "paid") ?? [];
  const paidTotal = paid.reduce((s, b) => s + BigInt(b.payoutAmount), 0n);
  const firstPaid = paid.at(-1);

  return (
    <>
      <section className="hero" aria-label="Introduction">
        <ProofField />
        <div className="hero-ui">
          <div className="counter" title="Payouts released">
            <div>
              <b>{String(paid.length).padStart(2, "0")}</b>
              <small>paid</small>
            </div>
          </div>

          <div className="hero-copy">
            <p className="label" data-reveal style={{ "--d": 6 } as CSSProperties}>
              <span style={{ color: "var(--seal)" }}>●</span> Live on Ethereum Sepolia · zkVerify testnet
            </p>
            <h1 className="rise" style={{ "--base": "200ms", marginTop: 22 } as CSSProperties}>
              <Line i={0}>
                The LLM <span className="it">proposes</span>
                <span className="dot">.</span>
              </Line>
              <Line i={1}>
                The proofs <span className="it">dispose</span>
                <span className="dot">.</span>
              </Line>
            </h1>
            <p className="hero-sub" data-reveal style={{ "--d": 8 } as CSSProperties}>
              An AI agent that pays open-source bounties only when it can prove the work was merged, and prove the payout stays inside the
              funder&apos;s mandate. It can be wrong. It can&apos;t overpay.
            </p>
            <div className="hero-cta" data-reveal style={{ "--d": 10 } as CSSProperties}>
              <Link href="/bounties/new" className="btn seal">
                Fund a bounty <span className="arr">→</span>
              </Link>
              <Link href={firstPaid ? `/receipts/${firstPaid.id}` : "#bounties"} className="btn secondary">
                {firstPaid ? "See a paid receipt" : "See the bounties"}
              </Link>
            </div>
          </div>

          <aside className="hero-side" aria-label="Guarantees">
            <div data-reveal style={{ "--d": 9 } as CSSProperties}>
              <h4>[ guarantees ]</h4>
              <p>No payout above the cap. No wallet off the allowlist. No pull request paid twice.</p>
            </div>
            <div data-reveal style={{ "--d": 11 } as CSSProperties}>
              <h4>[ proofs ]</h4>
              <p>zkTLS: GitHub said merged. Groth16: the payout fits the mandate.</p>
            </div>
            <div data-reveal style={{ "--d": 13 } as CSSProperties}>
              <h4>[ checked by ]</h4>
              <p>zkVerify, then the vault itself, on-chain, before any money moves.</p>
            </div>
          </aside>

          <div className="scroll-cue" aria-hidden>
            <span className="label">Scroll</span>
            <i />
          </div>
        </div>
      </section>

      <div className="strip" aria-label="Built with">
        <div className="strip-track">
          {[...STRIP, ...STRIP].map((s, i) => (
            <span className="strip-item" key={i} aria-hidden={i >= STRIP.length}>
              {s}
            </span>
          ))}
        </div>
      </div>

      {!cfg.ok && (
        <div className="shell" style={{ paddingTop: 40 }}>
          <p className="notice err">Configuration error: {cfg.error}</p>
        </div>
      )}

      <section className="section shell" id="ledger">
        <div className="sec-head">
          <div>
            <span className="label seal" data-reveal>
              01 — The ledger
            </span>
            <h2 className="rise">
              <Line i={0}>Every payout</Line>
              <Line i={1}>
                <span className="it">leaves a receipt.</span>
              </Line>
            </h2>
          </div>
          <p data-reveal>Read live from the agent. Every number below can be checked against the vault on Sepolia.</p>
        </div>
        <div className="stats">
          <div className="stat" data-reveal style={{ "--d": 0 } as CSSProperties}>
            <span className="label">Bounties funded</span>
            <b>
              <CountUp value={bounties?.length ?? 0} pad={2} />
            </b>
          </div>
          <div className="stat" data-reveal style={{ "--d": 1 } as CSSProperties}>
            <span className="label">Payouts released</span>
            <b>
              <CountUp value={paid.length} pad={2} />
            </b>
          </div>
          <div className="stat" data-reveal style={{ "--d": 2 } as CSSProperties}>
            <span className="label">Paid out</span>
            <b>
              <CountUp value={Number(paidTotal / 1_000_000n)} />
              <small>tUSDC</small>
            </b>
          </div>
          <div className="stat" data-reveal style={{ "--d": 3 } as CSSProperties}>
            <span className="label">Overpayments possible</span>
            <b>
              00<small>enforced on-chain</small>
            </b>
          </div>
        </div>
      </section>

      <section className="section shell" id="method" style={{ paddingTop: 0 }}>
        <div className="sec-head">
          <div>
            <span className="label seal" data-reveal>
              02 — The method
            </span>
            <h2 className="rise">
              <Line i={0}>Six steps.</Line>
              <Line i={1}>
                <span className="it">Two proofs.</span> One rule.
              </Line>
            </h2>
          </div>
          <p data-reveal>The model&apos;s opinion is recorded and shown to everyone. It is never read by the vault.</p>
        </div>
        <Method steps={STEPS} />
      </section>

      <section className="section shell" id="bounties" style={{ paddingTop: 0 }}>
        <div className="sec-head">
          <div>
            <span className="label seal" data-reveal>
              03 — Open ledger
            </span>
            <h2 className="rise">
              <Line i={0}>Bounties</Line>
              <Line i={1}>
                <span className="it">on the vault.</span>
              </Line>
            </h2>
          </div>
          <p data-reveal>Funded bounties and the mandate each payout must stay inside. Open one to follow its proofs.</p>
        </div>
        {error && <p className="notice err">{error}</p>}
        {!error && bounties === null && cfg.ok && <p className="lede">Loading…</p>}
        {bounties?.length === 0 && (
          <div className="card empty">
            No bounties yet. <Link href="/bounties/new">Fund the first one</Link>.
          </div>
        )}
        {bounties && bounties.length > 0 && (
          <ul className="list" aria-label="Bounties">
            {bounties.map((b) => (
              <li key={b.id}>
                <Link href={`/bounties/${b.id}`} className="row">
                  <span className="row-id">#{String(b.id).padStart(3, "0")}</span>
                  <span className="row-main">
                    <span className="row-title">{b.title ?? `${b.repo}#${b.issueNumber}`}</span>
                    <span className="row-meta">
                      {b.repo} · issue #{b.issueNumber}
                    </span>
                    <span>
                      <span className={`pill ${STATUS[b.status].tone}`}>{STATUS[b.status].label}</span>
                    </span>
                  </span>
                  <span className="row-amount">
                    {formatUsdc(b.payoutAmount)}
                    <span className="row-meta" style={{ display: "block", letterSpacing: 0 }}>
                      funded {formatUsdc(b.funded)}
                    </span>
                  </span>
                  <span className="row-go" aria-hidden>
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="closer">
        <div className="shell">
          <span className="label seal" data-reveal>
            04 — Your move
          </span>
          <h2 className="rise" style={{ marginTop: 22 }}>
            <Line i={0}>Fund it.</Line>
            <Line i={1}>
              <span className="it">Let the proofs</span>
            </Line>
            <Line i={2}>
              <span className="it">decide.</span>
            </Line>
          </h2>
          <p data-reveal>Set a cap, a budget and who can be paid. The agent does the rest, and can&apos;t step outside what you allowed.</p>
          <div data-reveal style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/bounties/new" className="btn seal">
              Fund a bounty <span className="arr">→</span>
            </Link>
            <a href="https://github.com/nisargpatel7042lva/mandate-bounty-agent" className="btn secondary" target="_blank" rel="noreferrer">
              Read the code
            </a>
          </div>
        </div>
      </section>
    </>
  );
}

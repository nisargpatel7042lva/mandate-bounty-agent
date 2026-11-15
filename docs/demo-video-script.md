# Demo video script (about 3 minutes)

For the Creator Track (video format) and as the Wildcard demo. Record the screen at 1080p, with your
voice over it. Put `#AgentGames` in the video title or description, and tag `@ZKVProtocol` when you post
it on X.

**Before recording, open these tabs:**
1. https://mandate-bounty-agent.vercel.app (home)
2. https://mandate-bounty-agent.vercel.app/bounties/1
3. https://mandate-bounty-agent.vercel.app/receipts/1
4. https://github.com/nisargpatel7042lva/mba-demo/pull/3
5. https://sepolia.etherscan.io/tx/0x53cac6e8e6c9f74bb67e4e651815b7a3f6f058536cebacfa8f5856ce59b88c4a (open the **Logs** tab)
6. https://zkverify-testnet.subscan.io/extrinsic/0x867ef853b1f1f6ff4729883337c749e66812d968c550bcfd20044ae14391c6fe
7. https://mandate-bounty-agent.vercel.app/bounties/new (MetaMask on Sepolia, optional)

Open https://mandate-bounty-agent.onrender.com/health once, a minute before recording, so the agent
is awake.

---

## 0:00 – 0:20 · The hook
**Screen:** tab 1, the home page.

> "This is Mandate Bounty Agent. It pays open-source bounties automatically, and it uses an LLM. But
> the LLM never controls the money. The vault only pays when two proofs check out: one that the work
> was merged, and one that the payout fits the funder's rules. The LLM proposes, the proofs dispose."

## 0:20 – 0:45 · The problem
**Screen:** tab 4, the GitHub PR, scrolled to the description with the `mba-payee:` line.

> "Bounties today are paid on trust. And if you hand that job to an AI, it gets riskier. The agent
> reads the PR, and a PR can contain text written to manipulate it. So in this design the AI can
> recommend, but it can't pay. The contributor just merges their PR and writes their wallet here."

## 0:45 – 1:10 · The mandate
**Screen:** tab 7, the New bounty form. Point at the Mandate fields; don't submit.

> "A funder creates a bounty for a GitHub issue and locks the money in a vault on Ethereum Sepolia.
> They also set a mandate: the most one payout can be, the total budget, which wallets may be paid,
> and an expiry. Only a hash of that mandate goes on-chain."

## 1:10 – 1:40 · What the agent did
**Screen:** tab 2, the bounty page. Scroll slowly through the claim, review and proof panels.

> "When the PR merged, the agent picked it up. First, Gemini reviewed the diff against the
> acceptance criteria: approve, 98% confidence. That's advice only; if it had said no, the payout
> would wait for the funder. Then two proofs. A zkTLS proof from Reclaim shows what GitHub's API
> really said: this PR is merged, by this author, naming this wallet. My GitHub token stays private."

## 1:40 – 2:15 · The zkVerify part
**Screen:** tab 3, the receipt, section 5 (mandate proof). Then tab 6, the zkVerify explorer.

> "The second proof is a Groth16 circuit. It proves the payout fits the mandate: under the cap,
> within budget, to an allowed wallet, before expiry. Here's the trick: zkVerify can't verify zkTLS
> directly, so I put the zkTLS claim ID inside this proof as a public input. One proof, verified on
> zkVerify, now covers both: the payout follows the rules, and it pays for exactly that proven PR.
> Here it is on the zkVerify explorer, aggregated to Sepolia."

## 2:15 – 2:40 · The payment
**Screen:** tab 5, Etherscan, Logs tab showing `PayoutReleased`.

> "Before paying, the vault rebuilds the proof's statement itself and checks it against zkVerify's
> contract on Sepolia. It matched, so it paid 250 test USDC. The event records the zkTLS claim and the
> zkVerify leaf. Try to pay the same PR, claim or proof again and the vault reverts."

## 2:40 – 3:00 · Close
**Screen:** tab 3, the top of the receipt, then the GitHub repo.

> "Anyone can check this receipt without trusting me or the agent. It's testnet only, and it doesn't
> prove the code is good; that's what the review is for. But whether the agent paid within the rules
> is now provable. The code is public. Built for Agent Games on zkVerify."

---

**Recording tips:**
- Zoom the browser to 125% so text is readable.
- Hide bookmarks and any tabs with personal information.
- Cut pauses in editing; aim for under 3:10.
- Upload to YouTube (unlisted or public) or post natively on X. Submit the link on the dashboard as
  a Creator Track entry, format "Video".

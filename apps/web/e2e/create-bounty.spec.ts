import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// Anvil dev accounts 1 (funder) and 2 (payee). Public, well-known test accounts.
const FUNDER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const PAYEE = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

const stackFile = path.join(path.dirname(fileURLToPath(import.meta.url)), ".stack.json");

test.beforeEach(async ({ page }) => {
  const { rpcUrl } = JSON.parse(readFileSync(stackFile, "utf8")) as { rpcUrl: string };
  // Minimal injected EIP-1193 wallet: accounts are fixed, everything else (including
  // eth_sendTransaction) is forwarded to anvil, which signs for its unlocked dev accounts.
  await page.addInitScript(
    ({ rpcUrl, account }) => {
      let id = 0;
      const rpc = async (method: string, params: unknown) => {
        const res = await fetch(rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params ?? [] }),
        });
        const json = (await res.json()) as { result?: unknown; error?: { code: number; message: string } };
        if (json.error) throw Object.assign(new Error(json.error.message), { code: json.error.code });
        return json.result;
      };
      (window as unknown as { ethereum: unknown }).ethereum = {
        request: async ({ method, params }: { method: string; params?: unknown }) => {
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
          return rpc(method, params);
        },
        on: () => undefined,
        removeListener: () => undefined,
      };
    },
    { rpcUrl, account: FUNDER },
  );
});

test("funder creates and funds a bounty, then sees it listed", async ({ page }) => {
  await page.goto("/bounties/new");
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByTestId("account")).toHaveText(/0x7099…79C8/);
  await expect(page.getByTestId("balance")).toHaveText("0 tUSDC");

  await page.getByRole("button", { name: "Get 10,000 test USDC" }).click();
  await expect(page.getByTestId("balance")).toHaveText("10,000 tUSDC");

  // Client-side mandate validation fires before any wallet prompt.
  await page.getByLabel("Payout (tUSDC)").fill("600");
  await page.getByRole("button", { name: "Create and fund bounty" }).click();
  await expect(page.getByText("payout cannot exceed the per-payout cap")).toBeVisible();

  await page.getByLabel("Repository").fill("acme/widgets");
  await page.getByLabel("Issue number").fill("42");
  await page.getByLabel("Title").fill("Fix widget overflow on mobile");
  await page.getByLabel("Acceptance criteria").fill("Widgets wrap instead of overflowing below 400px wide.");
  await page.getByLabel("Payout (tUSDC)").fill("250");
  await page.getByLabel("Allowed payees").fill(PAYEE);
  await page.getByLabel("Fund now (tUSDC)").fill("400");
  await page.getByRole("button", { name: "Create and fund bounty" }).click();

  await expect(page).toHaveURL(/\/bounties\/1$/);
  await expect(page.getByRole("heading", { name: "Fix widget overflow on mobile" })).toBeVisible();
  await expect(page.getByTestId("funded")).toContainText("400 tUSDC of 1,000 tUSDC budget");
  // The payee appears in the mandate allowlist (and, once proven, in the proof panel too).
  await expect(page.getByText(PAYEE.toLowerCase()).first()).toBeVisible();

  await page.getByRole("link", { name: "Mandate Bounty Agent" }).click();
  const list = page.getByRole("list", { name: "Bounties" });
  await expect(list.getByText("Fix widget overflow on mobile")).toBeVisible();
  await expect(list.getByText("acme/widgets · issue #42")).toBeVisible();
});

// Phase 2. Runs after the test above (one worker, file order) against the bounty it created.
// The stub GitHub reports issue #42 closed by merged PR #7; the stub Claude API returns an approval.
test("the agent detects the merged PR and shows its advisory review", async ({ page }) => {
  await page.goto("/bounties/1");

  const claim = page.getByTestId("claim");
  await expect(claim).toContainText("#7 Wrap widgets on narrow screens");
  await expect(claim).toContainText("@octocat");
  await expect(claim).toContainText("into main by @maintainer");
  await expect(claim).toContainText("bbbbbbb");

  const review = page.getByTestId("review");
  await expect(page.getByTestId("recommendation")).toHaveText("Recommends approval");
  await expect(review).toContainText("advice only: it cannot release or block a payout");
  await expect(review).toContainText("Met: Widgets wrap instead of overflowing below 400px");
  await expect(review).toContainText("confidence 86%");
  // The status moves past "reviewed" once the merge is proven (Phase 3), so it is checked there.

  // Money fields are untouched by the review.
  await expect(page.getByTestId("funded")).toContainText("400 tUSDC of 1,000 tUSDC budget");
});

// Phase 3. The agent proves the merge over zkTLS (a local test attestor stands in for Reclaim),
// verifies the proof, and the page explains what the proof does and does not show.
test("the agent proves the merge and explains what the proof establishes", async ({ page, request }) => {
  await page.goto("/bounties/1");

  const establishes = page.getByTestId("proof-establishes");
  await expect(establishes).toContainText("pull request #7 in acme/widgets is merged, into main, on 2026-10-28 10:00 UTC");
  await expect(establishes).toContainText("names @octocat as the pull request's author");
  // The payee wallet comes from the PR description, written by the author, and is attested too.
  await expect(page.getByTestId("proof-payee")).toHaveText(PAYEE.toLowerCase());
  await expect(establishes).toContainText("never edited after it was opened, so the author chose this wallet");
  await expect(establishes).toContainText("bound to this bounty (chain 31337, bounty #1)");
  await expect(establishes).toContainText("token was used privately and is not in the proof");

  const notEstablished = page.getByTestId("proof-does-not-establish");
  await expect(notEstablished).toContainText("That the code is correct or meets the acceptance criteria");
  await expect(notEstablished).toContainText("holds the key to");
  await expect(notEstablished).toContainText("is on this bounty's allowlist");
  await expect(notEstablished).toContainText("its identifier is bound into the mandate proof");

  // The agent moves straight on to the mandate proof and payout, so the status is checked in the next test.

  // The proof reference links to the raw, re-verifiable proof served by the agent.
  const ref = page.getByTestId("proof-reference");
  const identifier = (await ref.locator(".mono").innerText()).trim();
  expect(identifier).toMatch(/^0x[0-9a-f]{64}$/);
  const href = await ref.getByRole("link", { name: /raw proof/ }).getAttribute("href");
  const raw = await (await request.get(href ?? "")).json();
  expect(raw.identifier).toBe(identifier);
  expect(JSON.stringify(raw)).not.toContain("e2e-github-token");
});

// Phase 4/5. The agent proves the mandate (real Groth16), a local zkVerify stand-in marks the
// statement leaf on MockZkVerify, and the vault verifies it on-chain before paying the payee.
test("the vault pays once the mandate proof is verified, and the receipt shows every proof", async ({ page }) => {
  await page.goto("/bounties/1");
  await expect(page.getByTestId("status")).toHaveText("paid", { timeout: 90_000 });
  await expect(page.getByTestId("payout-state")).toHaveText("paid");
  await expect(page.getByTestId("zkverify-status")).toContainText("AggregationPublished");

  await page.getByTestId("receipt-link").click();
  await expect(page).toHaveURL(/\/receipts\/1$/);
  await expect(page.getByTestId("r-amount")).toHaveText("250 tUSDC");
  await expect(page.getByTestId("r-payee")).toHaveText(new RegExp(PAYEE, "i"));
  await expect(page.getByTestId("r-payment-tx")).toHaveText(/^0x[0-9a-f]{64}$/);
  await expect(page.getByTestId("r-pr")).toContainText("acme/widgets#7 Wrap widgets on narrow screens");
  await expect(page.getByTestId("r-author")).toHaveText("@octocat");
  await expect(page.getByTestId("r-verdict")).toContainText("Recommends approval");
  await expect(page.getByTestId("r-zktls-claim")).toContainText("acme/widgets#7 merged into main");
  await expect(page.getByTestId("r-zktls-id")).toHaveText(/^0x[0-9a-f]{64}$/);
  await expect(page.getByTestId("r-zktls-raw")).toHaveAttribute("href", /\/bounties\/1\/proof$/);
  await expect(page.getByTestId("r-commitment")).toHaveText(/^0x[0-9a-f]{64}$/);
  await expect(page.getByTestId("r-zkverify-status")).toHaveText("AggregationPublished");
  await expect(page.getByTestId("r-zkverify-tx")).toHaveText(/^0x7a7a/);
  await expect(page.getByTestId("r-aggregation")).toContainText("#1, domain 0, leaf 0x");
  // Eight public inputs: commitment, bounty id, amount, payee, spent, now, claim hi/lo.
  expect((await page.getByTestId("r-public-inputs").innerText()).split(", ")).toHaveLength(8);
});

async function createBounty(page: import("@playwright/test").Page, issue: number, title: string) {
  await page.goto("/bounties/new");
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByTestId("account")).toHaveText(/0x7099…79C8/);
  await page.getByLabel("Repository").fill("acme/widgets");
  await page.getByLabel("Issue number").fill(String(issue));
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Acceptance criteria").fill("No horizontal scroll at 360px.");
  await page.getByLabel("Payout (tUSDC)").fill("100");
  await page.getByLabel("Allowed payees").fill(PAYEE);
  await page.getByLabel("Fund now (tUSDC)").fill("100");
  await page.getByRole("button", { name: "Create and fund bounty" }).click();
  await expect(page).toHaveURL(/\/bounties\/\d+$/);
  return Number(page.url().split("/").pop());
}

// Rejection path 1: the advisory review says "not met". Both proofs still pass, but the agent holds
// the payout; it pays only after the funder approves on-chain.
test("a 'not met' review holds the payout until the funder approves", async ({ page }) => {
  const id = await createBounty(page, 43, "Remove horizontal scroll");
  await expect(page.getByTestId("status")).toHaveText("held for funder review", { timeout: 90_000 });
  await expect(page.getByTestId("recommendation")).not.toHaveText("Recommends approval");
  await expect(page.getByTestId("payout")).toContainText("Nothing is paid unless the funder approves on-chain");

  await page.getByRole("button", { name: "Approve payout anyway (funder)" }).click();
  await expect(page.getByTestId("status")).toHaveText("paid", { timeout: 90_000 });
  await page.goto(`/receipts/${id}`);
  await expect(page.getByTestId("r-amount")).toHaveText("100 tUSDC");
  await expect(page.getByTestId("r-verdict")).toContainText("funder approved despite the review");
});

// Rejection path 2: a second bounty whose issue was closed by the already-paid PR #7 is refused.
test("a PR that already got paid cannot be paid again by another bounty", async ({ page }) => {
  await createBounty(page, 44, "Same fix, second bounty");
  await expect(page.getByTestId("status")).toHaveText("payout failed", { timeout: 90_000 });
  await expect(page.getByTestId("payout")).toContainText("PR #7 in acme/widgets was already paid by bounty #1");
});

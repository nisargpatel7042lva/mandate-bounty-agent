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
  await expect(page.getByText(PAYEE.toLowerCase())).toBeVisible();

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
  await expect(page.getByTestId("status")).toHaveText("reviewed (advisory)");

  // Money fields are untouched by the review.
  await expect(page.getByTestId("funded")).toContainText("400 tUSDC of 1,000 tUSDC budget");
});

/* global process, console, window */
// Captures the Creator Track thread images from the live site at 1600×900 (2× pixel density),
// into docs/thread-images/. Usage (from apps/web):  node scripts/thread-shots.mjs [baseUrl]
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "https://mandate-bounty-agent.vercel.app";
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/thread-images");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const settle = (ms) => page.waitForTimeout(ms);
const shot = async (name) => {
  await page.screenshot({ path: path.join(out, name) });
  console.log("saved", name);
};

// 1. hero: let the particles converge into the ring, then nudge them with a pointer sweep
await page.goto(base, { waitUntil: "networkidle" });
await settle(3500);
for (let i = 0; i <= 12; i++) await page.mouse.move(820 + i * 22, 300 + i * 9);
await settle(250);
await shot("01-hero.png");

// 2. bounty page: title and the six-stage proof rail, all the way to Paid
await page.goto(`${base}/bounties/1`, { waitUntil: "networkidle" });
await page.getByTestId("status").waitFor();
await settle(1200);
await shot("02-proof-rail.png");

// 3. receipt top: the amount, the headline and the rotating seal
await page.goto(`${base}/receipts/1`, { waitUntil: "networkidle" });
await page.getByTestId("receipt").waitFor();
await settle(1500);
await shot("03-receipt.png");

// 4. receipt section 05: the mandate proof, its zkVerify aggregation and public inputs
const mandate = page.locator(".r-sec").nth(4);
await mandate.scrollIntoViewIfNeeded();
await settle(1400);
await page.evaluate(() => window.scrollBy(0, -110));
await settle(600);
await shot("04-mandate-proof.png");

// 5. receipt section 01: the payment the vault made after checking both proofs
const payment = page.locator(".r-sec").nth(0);
await payment.scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollBy(0, -150));
await settle(1200);
await shot("05-payment.png");

await browser.close();

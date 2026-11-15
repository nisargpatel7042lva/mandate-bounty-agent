/* global process, console, window, document, requestAnimationFrame, performance */
// Records the narrated demo video from the live site.
//  1. Speaks each scene's narration with Windows text-to-speech (System.Speech) into a WAV.
//  2. Drives the live site with Playwright at 1920×1080, holding each scene as long as its narration,
//     with the narration as an on-screen caption.
//  3. Lays the WAVs at each scene's start time and muxes everything into an H.264 MP4 with ffmpeg.
// Usage (from apps/web, Windows):  node scripts/demo-video.mjs [baseUrl]
// Output: <repo>/demo/mandate-bounty-agent-demo.mp4 (git-ignored; upload it to YouTube or X).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "https://mandate-bounty-agent.vercel.app";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const out = path.join(root, "demo");
const work = path.join(out, "work");
mkdirSync(work, { recursive: true });

const ZKV_TX = "https://zkverify-testnet.subscan.io/extrinsic/0x867ef853b1f1f6ff4729883337c749e66812d968c550bcfd20044ae14391c6fe";

/** Each scene: what to say, and what to do on screen while it is said. */
const SCENES = [
  {
    id: "title",
    say: "Mandate Bounty Agent. An AI agent that pays open-source bounties, where the language model proposes, and the proofs dispose.",
    go: async (p) => {
      await p.setContent(TITLE_CARD("The LLM proposes.", "The proofs dispose."), { waitUntil: "networkidle" });
    },
    run: async (p) => p.waitForTimeout(500),
  },
  {
    id: "hook",
    say: "Here's the problem. Bounties are paid on trust, and handing that job to an AI makes it riskier. The model reads the pull request, and the pull request can contain text written to fool it. So in this design, the AI can recommend, but it can never pay.",
    go: async (p) => {
      await p.goto(base, { waitUntil: "networkidle" });
      await p.waitForTimeout(2500); // let the particles settle into the ring first
    },
    run: async (p) => {
      await p.waitForTimeout(3000);
      await sweepMouse(p, 3600);
    },
  },
  {
    id: "method",
    say: "Every payout earns the right to happen in six steps, with two proofs. The model's opinion is recorded and shown to everyone, but the vault never reads it.",
    run: async (p) => {
      await smoothScrollTo(p, "#method", 2600);
      await smoothScrollBy(p, 1500, 5200);
    },
  },
  {
    id: "listings",
    say: "Funders post bounties for real GitHub issues. Each one locks test USDC in a vault on Ethereum Sepolia, and the agent watches every issue for a merged pull request.",
    run: async (p) => {
      await smoothScrollTo(p, "#bounties", 2400);
      await p.waitForTimeout(800);
      await smoothScrollBy(p, 520, 4200);
    },
  },
  {
    id: "mandate",
    say: "Creating a bounty sets a mandate: the most one payout can be, a total budget, which wallets may be paid, and an expiry. The vault stores it with a commitment that every payout proof must match.",
    go: async (p) => {
      await p.goto(`${base}/bounties/new`, { waitUntil: "networkidle" });
      await p.waitForTimeout(1200);
    },
    run: async (p) => {
      await p.waitForTimeout(2500);
      await smoothScrollBy(p, 700, 4000);
    },
  },
  {
    id: "rail",
    say: "Here is bounty number one. A merged pull request closed its issue. The rail shows each stage: funded, merged, reviewed, merge proven, mandate proven, and paid.",
    go: async (p) => {
      await p.goto(`${base}/bounties/1`, { waitUntil: "networkidle" });
      await p.getByTestId("status").waitFor();
      await p.waitForTimeout(800);
    },
    run: async (p) => p.waitForTimeout(2500),
  },
  {
    id: "review",
    say: "First, Gemini reviewed the diff against the acceptance criteria. It recommended approval, with evidence for each criterion. That's advice only. If it had said no, the payout would wait for the funder.",
    run: async (p) => {
      await smoothScrollTo(p, '[data-testid="review"]', 2600, -140);
      await p.waitForTimeout(2000);
    },
  },
  {
    id: "zktls",
    say: "Then the first proof. A zero-knowledge TLS proof from Reclaim shows what GitHub's own API said: this pull request is merged, by this author, naming this wallet. The GitHub token never leaves the agent.",
    run: async (p) => {
      await smoothScrollTo(p, '[data-testid="proof-establishes"]', 2600, -160);
      await p.waitForTimeout(2200);
    },
  },
  {
    id: "zkverify",
    say: "The second proof is a Groth16 circuit. It proves the payout fits the mandate. The trick: zkVerify can't check zero-knowledge TLS directly, so the TLS claim ID goes inside this proof. One proof on zkVerify now covers both.",
    go: async (p) => {
      await p.goto(`${base}/receipts/1`, { waitUntil: "networkidle" });
      await p.getByTestId("receipt").waitFor();
      await p.waitForTimeout(800);
    },
    run: async (p) => {
      await p.waitForTimeout(2200);
      await smoothScrollTo(p, ".r-sec:nth-of-type(5)", 3000, -40);
    },
  },
  {
    id: "explorer",
    say: "Here it is on the zkVerify explorer, verified and aggregated to Sepolia.",
    go: async (p) => {
      await p.goto(ZKV_TX, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
      await p.waitForTimeout(5000);
      // if the explorer didn't render the extrinsic (bot check, slow load), stay on the receipt instead
      const shown = await p.evaluate(() => /0x867ef853/i.test(document.body?.innerText ?? "")).catch(() => false);
      if (!shown) {
        await p.goto(`${base}/receipts/1`, { waitUntil: "networkidle" });
        await smoothScrollTo(p, ".r-sec:nth-of-type(5)", 10, -40);
      }
    },
    run: async (p) => p.waitForTimeout(1500),
  },
  {
    id: "payment",
    say: "Before paying, the vault rebuilds the proof's statement and checks it against zkVerify's contract on chain. It matched, so the vault paid two hundred and fifty test USDC. The same pull request, claim or proof can never be paid twice.",
    // Etherscan puts headless browsers behind a Cloudflare check, so show the receipt's payment section
    go: async (p) => {
      await p.goto(`${base}/receipts/1`, { waitUntil: "networkidle" });
      await p.getByTestId("receipt").waitFor();
    },
    run: async (p) => {
      await smoothScrollTo(p, ".r-sec:nth-of-type(1)", 2600, -140);
      await p.waitForTimeout(2500);
    },
  },
  {
    id: "close",
    say: "Anyone can check this receipt without trusting me or the agent. It's testnet only, and it doesn't prove the code is good. That's what the review is for. But whether the agent paid within the rules is now provable. The code is public. Built for Agent Games on zkVerify.",
    go: async (p) => {
      await p.goto(`${base}/receipts/1`, { waitUntil: "networkidle" });
      await p.getByTestId("receipt").waitFor();
    },
    run: async (p) => {
      await p.waitForTimeout(6500);
      await p.setContent(TITLE_CARD("Paid,", "and proven.", "mandate-bounty-agent.vercel.app · github.com/nisargpatel7042lva/mandate-bounty-agent · #AgentGames"), { waitUntil: "networkidle" });
    },
  },
];

function TITLE_CARD(a, b, foot = "zkTLS · Groth16 · zkVerify · Ethereum Sepolia") {
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500&family=Instrument+Serif:ital@1&display=block"><style>
  html,body{margin:0;height:100%;background:#070707;color:#f3f1ec;font-family:"Inter Tight",system-ui,sans-serif}
  .w{height:100%;display:grid;place-content:center;text-align:center;gap:28px}
  h1{margin:0;font-weight:500;font-size:128px;line-height:.92;letter-spacing:-.05em}
  h1 i{font-family:"Instrument Serif",Georgia,serif;font-weight:400;color:#ff5b2e}
  p{margin:0;font:400 18px/1.4 ui-monospace,Consolas,monospace;letter-spacing:.08em;text-transform:uppercase;color:#85817a}
  .m{width:56px;height:56px;margin:0 auto 6px}
  </style></head><body><div class="w">
  <svg class="m" viewBox="0 0 40 40" fill="none"><path d="M20 3.5a16.5 16.5 0 1 0 16.5 16.5" stroke="#f3f1ec" stroke-width="2.2" stroke-linecap="round"/><path d="M36.5 20H27" stroke="#f3f1ec" stroke-width="2.2" stroke-linecap="round"/><circle cx="20" cy="20" r="5.2" fill="#ff5b2e"/></svg>
  <h1>${a}<br><i>${b}</i></h1><p>${foot}</p></div></body></html>`;
}

// ── helpers that run inside the page ──
const smoothScrollTo = (p, selector, ms, offset = -100) =>
  p.evaluate(
    ([sel, dur, off]) =>
      new Promise((done) => {
        const el = document.querySelector(sel);
        if (!el) return done();
        const from = window.scrollY, to = el.getBoundingClientRect().top + window.scrollY + off;
        const t0 = performance.now();
        const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
        const step = (t) => {
          const k = Math.min(1, (t - t0) / dur);
          window.scrollTo(0, from + (to - from) * ease(k));
          if (k < 1) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      }),
    [selector, ms, offset],
  );
const smoothScrollBy = (p, dy, ms) =>
  p.evaluate(
    ([d, dur]) =>
      new Promise((done) => {
        const from = window.scrollY, t0 = performance.now();
        const step = (t) => {
          const k = Math.min(1, (t - t0) / dur);
          window.scrollTo(0, from + d * (1 - Math.pow(1 - k, 3)));
          if (k < 1) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      }),
    [dy, ms],
  );
async function sweepMouse(p, ms) {
  const steps = Math.round(ms / 60);
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    await p.mouse.move(1000 + Math.cos(k * Math.PI * 2) * 360, 470 + Math.sin(k * Math.PI * 4) * 150);
    await p.waitForTimeout(60);
  }
}

// caption overlay, re-added after every navigation
const CAPTION_SCRIPT = () => {
  window.__cap = (text) => {
    let el = document.getElementById("__cap");
    if (!el) {
      el = document.createElement("div");
      el.id = "__cap";
      el.style.cssText =
        "position:fixed;left:50%;bottom:44px;transform:translateX(-50%);max-width:1180px;width:calc(100% - 160px);z-index:2147483647;" +
        "padding:16px 26px;border-radius:14px;background:rgba(7,7,7,.82);border:1px solid rgba(243,241,236,.14);" +
        "backdrop-filter:blur(10px);color:#f3f1ec;font:500 24px/1.4 'Inter Tight',system-ui,sans-serif;text-align:center;letter-spacing:-.005em;" +
        "box-shadow:0 18px 50px -20px rgba(0,0,0,.8);pointer-events:none";
      document.documentElement.appendChild(el);
    }
    el.textContent = text;
    el.style.display = text ? "block" : "none";
  };
};

// ── 1. narration audio ──
const ffprobe = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());
for (const s of SCENES) {
  const wav = path.join(work, `${s.id}.wav`);
  const txt = path.join(work, `${s.id}.txt`);
  writeFileSync(txt, s.say);
  execFileSync("powershell", [
    "-NoProfile",
    "-Command",
    `Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SelectVoice('Microsoft David Desktop'); $s.Rate=-1; $s.SetOutputToWaveFile('${wav}'); $s.Speak([IO.File]::ReadAllText('${txt}')); $s.Dispose()`,
  ]);
  s.wav = wav;
  s.audio = ffprobe(wav);
  console.log(`tts ${s.id.padEnd(9)} ${s.audio.toFixed(1)} s`);
}

// ── 2. screen recording ──
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: work, size: { width: 1920, height: 1080 } } });
await context.addInitScript(CAPTION_SCRIPT);
const page = await context.newPage();
const t0 = Date.now();
// the caption for the scene being recorded; re-applied after every page load so it never drops out
let caption = "";
const showCaption = () => page.evaluate((t) => window.__cap?.(t), caption).catch(() => {});
page.on("domcontentloaded", showCaption);
for (const s of SCENES) {
  caption = "";
  await page.evaluate(() => document.getElementById("__cap")?.remove()).catch(() => {});
  if (s.go) await s.go(page);
  s.start = (Date.now() - t0) / 1000;
  caption = s.say;
  await page.evaluate(CAPTION_SCRIPT).catch(() => {});
  await showCaption();
  const began = Date.now();
  await s.run(page);
  await page.evaluate(CAPTION_SCRIPT).catch(() => {});
  await showCaption();
  const left = s.audio + 0.6 - (Date.now() - began) / 1000;
  if (left > 0) await page.waitForTimeout(left * 1000);
  s.end = (Date.now() - t0) / 1000;
  console.log(`scene ${s.id.padEnd(9)} ${s.start.toFixed(1)}–${s.end.toFixed(1)} s`);
}
const video = await page.video().path();
await context.close();
await browser.close();

// ── 3. cut one clip per scene (only while it is narrated: page loads never show), add its audio, join ──
const mp4 = path.join(out, "mandate-bounty-agent-demo.mp4");
const clips = [];
for (const s of SCENES) {
  const clip = path.join(work, `clip-${s.id}.mp4`);
  const len = (s.end - s.start).toFixed(3);
  execFileSync("ffmpeg", [
    "-v", "error", "-y",
    "-ss", s.start.toFixed(3), "-t", len, "-i", video,
    "-i", s.wav,
    "-filter_complex", `[1:a]aresample=48000,apad,atrim=0:${len}[a]`,
    "-map", "0:v", "-map", "[a]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
    clip,
  ]);
  clips.push(clip);
}
const list = path.join(work, "clips.txt");
writeFileSync(list, clips.map((c) => `file '${c.replace(/\\/g, "/")}'`).join("\n"));
execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", mp4]);
const total = SCENES.reduce((n, s) => n + (s.end - s.start), 0);
console.log(`\nsaved ${mp4} (${total.toFixed(1)} s)`);

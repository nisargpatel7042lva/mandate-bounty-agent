"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SITE } from "../lib/site.ts";

/** The mark: a vault ring with one notch where the proof enters, and the seal at its centre. */
export function BrandMark({ className = "brand-mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" fill="none" aria-hidden>
      <path d="M20 3.5a16.5 16.5 0 1 0 16.5 16.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M36.5 20H27" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="20" cy="20" r="5.2" fill="#ff5b2e" />
    </svg>
  );
}

export function SiteNav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const home = usePathname() === "/";
  const to = (hash: string) => (home ? hash : `/${hash}`);

  return (
    <header className={`nav${scrolled ? " scrolled" : ""}`}>
      <div className="shell nav-in">
        <Link href="/" className="brand" aria-label={SITE.name}>
          <BrandMark />
          <span className="brand-name" aria-hidden>
            <b>{SITE.name}</b>
            <small>Proof-gated payouts</small>
          </span>
        </Link>
        <nav className="nav-links" aria-label="Sections">
          <a href={to("#method")}>Method</a>
          <a href={to("#ledger")}>Ledger</a>
          <a href={to("#bounties")}>Bounties</a>
        </nav>
        <div className="nav-r">
          <span className="net">
            <i aria-hidden />
            Sepolia · zkVerify
          </span>
          <Link href="/bounties/new" className="btn sm">
            New bounty <span className="arr" aria-hidden>→</span>
          </Link>
        </div>
      </div>
    </header>
  );
}

/**
 * Reveals [data-reveal] blocks and .rise headings as they enter the viewport. Adds .js to <html>
 * first, so without JavaScript nothing is ever hidden. Watches the DOM for new nodes, so pages
 * that render after data loads get their reveals too.
 */
export function RevealRoot() {
  const pathname = usePathname();
  useEffect(() => {
    document.documentElement.classList.add("js");
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }),
      { threshold: 0.08, rootMargin: "0px 0px -6% 0px" },
    );
    const scan = () =>
      document.querySelectorAll("[data-reveal]:not(.in), .rise:not(.in)").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.top < innerHeight * 0.96 && r.bottom > 0) el.classList.add("in");
        else io.observe(el);
      });
    scan();
    const mo = new MutationObserver(() => requestAnimationFrame(scan));
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, [pathname]);
  return null;
}

export function SiteFooter() {
  return (
    <footer className="foot">
      <div className="shell">
        <div className="foot-grid">
          <div>
            <p className="foot-big">
              The LLM proposes, <span className="it">the proofs dispose.</span>
            </p>
          </div>
          <div>
            <h5>Product</h5>
            <ul>
              <li>
                <Link href="/bounties/new">Fund a bounty</Link>
              </li>
              <li>
                <Link href="/receipts/1">Live receipt</Link>
              </li>
              <li>
                <a href="/api/agent">Agent endpoint</a>
              </li>
            </ul>
          </div>
          <div>
            <h5>Proofs</h5>
            <ul>
              <li>
                <a href="https://reclaimprotocol.org" target="_blank" rel="noreferrer">
                  Reclaim zkTLS
                </a>
              </li>
              <li>
                <a href="https://zkverify.io" target="_blank" rel="noreferrer">
                  zkVerify
                </a>
              </li>
              <li>
                <a href="https://sepolia.etherscan.io" target="_blank" rel="noreferrer">
                  Ethereum Sepolia
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h5>Source</h5>
            <ul>
              <li>
                <a href="https://github.com/nisargpatel7042lva/mandate-bounty-agent" target="_blank" rel="noreferrer">
                  GitHub
                </a>
              </li>
              <li>
                <a href="https://agentgames.zkverify.io" target="_blank" rel="noreferrer">
                  Agent Games
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="foot-legal">
          <span>Testnet only · mock USDC</span>
          <span>Built for Agent Games 2026</span>
        </div>
      </div>
    </footer>
  );
}

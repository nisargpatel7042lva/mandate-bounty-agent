import type { ReactNode } from "react";
import { Inter_Tight, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { RevealRoot, SiteFooter, SiteNav } from "../components/chrome.tsx";
import { SITE } from "../lib/site.ts";
import "./globals.css";

const sans = Inter_Tight({ subsets: ["latin"], weight: ["300", "400", "500", "600"], variable: "--f-sans", display: "swap" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["italic", "normal"], variable: "--f-serif", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--f-mono", display: "swap" });

export const metadata = {
  title: `${SITE.name}: proof-gated bounty payouts`,
  description: "An AI agent that pays open-source bounties only when zkTLS proves the PR merged and a zkVerify-verified proof shows the payout fits the funder's mandate.",
};

export const viewport = { themeColor: "#070707" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
      <body suppressHydrationWarning>
        <SiteNav />
        <RevealRoot />
        <main>{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}

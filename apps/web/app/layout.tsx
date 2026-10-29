import type { ReactNode } from "react";
import Link from "next/link";
import { SITE } from "../lib/site.ts";
import "./globals.css";

export const metadata = { title: SITE.name, description: SITE.tagline };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <Link href="/" className="brand">
              {SITE.name}
              <small>{SITE.tagline}</small>
            </Link>
            <Link href="/bounties/new" className="btn">
              New bounty
            </Link>
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Snake Rush",
  description: "Snake Rush",
  icons: {
    icon: "/favicon.png"
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="site-shell">
          <header className="terminal-header">
            <div className="terminal-nav-wrap">
              <nav className="terminal-nav" aria-label="Primary">
                <div className="terminal-menu">
                  <Link href="/">Home</Link>
                  <Link href="/play" className="nav-play-cta">Play</Link>
                </div>
              </nav>
            </div>
          </header>

          <div className="site-content">{children}</div>
        </div>
      </body>
    </html>
  );
}

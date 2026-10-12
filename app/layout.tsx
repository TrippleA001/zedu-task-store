import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import SiteHeader from "./components/site-header";
import AnnouncementBar from "./components/announcement-bar";

export const metadata: Metadata = {
  title: "Zedu Store",
  description: "Task verification & onboarding portal",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white font-sans text-ink">
        <AnnouncementBar />
        <SiteHeader />
        <main>{children}</main>
        <footer className="mt-16 border-t border-line bg-canvas">
          <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-deep text-base font-black text-white">Z</span>
                <div>
                  <p className="text-sm font-bold text-ink">Zedu Store</p>
                  <p className="text-[13px] text-muted">Task verification &amp; contributor onboarding</p>
                </div>
              </div>
              <nav className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] font-medium" aria-label="Footer">
                <Link href="/">Catalog</Link>
                <Link href="/contributors">Contributors</Link>
              </nav>
            </div>
            <div className="mt-8 flex flex-col gap-1 border-t border-line pt-6 text-[12px] text-muted sm:flex-row sm:justify-between">
              <p>Milestones are $0.00 products · Order receipts use the <span className="font-mono font-semibold text-ink">ZE-2026-XXXX</span> format.</p>
              <p>© {new Date().getFullYear()} Zedu Store</p>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}

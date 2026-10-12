"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase-client";

// lib/org.ts is server-only (imports serviceClient), so this client
// component keeps its own copy of the default org slug.
const DEFAULT_SLUG = "zedu-egret";

// Pre-013 databases have no banner_text column; until migration 013 runs the
// bar shows this exact copy, so the storefront looks unchanged.
export const DEFAULT_BANNER =
  "Stage 1 verification is open — complete your ToDo milestone to claim your receipt.";

// Per-org announcement bar. Signed-in members see their active org's banner
// (and it refetches the moment they switch org on /profile); logged-out
// visitors see the default org's. Text only — never HTML.
export default function AnnouncementBar() {
  const [banner, setBanner] = useState(DEFAULT_BANNER);

  const load = useCallback(async () => {
    try {
      const sb = supabaseBrowser();
      const { data: auth } = await sb.auth.getUser();
      let orgId: string | null = null;
      if (auth.user) {
        const { data: u } = await sb
          .from("users")
          .select("active_org_id")
          .eq("id", auth.user.id)
          .maybeSingle();
        orgId = (u as { active_org_id?: string | null } | null)?.active_org_id ?? null;
      }
      const q = sb.from("organizations").select("banner_text");
      const { data } = orgId
        ? await q.eq("id", orgId).maybeSingle()
        : await q.eq("slug", DEFAULT_SLUG).maybeSingle();
      setBanner((data as { banner_text?: string | null } | null)?.banner_text || DEFAULT_BANNER);
    } catch {
      setBanner(DEFAULT_BANNER);
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("zedu:org-switched", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("zedu:org-switched", refresh);
    };
  }, [load]);

  return (
    <div className="bg-brand-deep">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-center gap-1 px-4 py-2 text-center text-[13px] font-medium text-white sm:flex-row sm:justify-between sm:px-6">
        <p>{banner}</p>
        <nav className="flex items-center gap-4 text-white/80" aria-label="Announcement">
          <Link href="/contributors" className="text-white/80 hover:text-white hover:no-underline">
            Contributors
          </Link>
          <Link href="/onboarding" className="text-white/80 hover:text-white hover:no-underline">
            Get started
          </Link>
        </nav>
      </div>
    </div>
  );
}

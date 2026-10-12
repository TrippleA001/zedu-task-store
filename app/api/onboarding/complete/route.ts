import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseNoStore } from "@/lib/supabase-server";
import { authUser } from "@/lib/api-auth";
import { defaultOrgId } from "@/lib/org";
import { resolveRosterIdentity, rosterTableForOrgId } from "@/lib/roster";
import {
  normalizeTelegram,
  normalizeZeduId,
  sanitizeText,
  telegramError,
} from "@/lib/validation";

// POST /api/onboarding/complete — atomically claim roster row + insert users row.
export async function POST(request: Request) {
  try {
    // 1. Must be logged in via Google (web cookies or mobile Bearer token)
    const user = await authUser(request);
    if (!user?.id || !user?.email)
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const workspace_email = String(body?.workspace_email || "");
    const zedu_id = normalizeZeduId(String(body?.zedu_id || ""));
    const orgSelection = String(body?.org_id || "").trim();
    const full_name = sanitizeText(String(body?.full_name || ""));
    const github_url = sanitizeText(String(body?.github_url || ""), 500);
    const telegram = normalizeTelegram(String(body?.telegram_handle || ""));
    const skill_rating = Number(body?.skill_rating);
    const channels: string[] = Array.isArray(body?.channels) ? body.channels : [];

    if (!workspace_email || !zedu_id || !full_name || !github_url || !telegram)
      return NextResponse.json({ error: "All fields are required" }, { status: 400 });
    const tgErr = telegramError(String(body?.telegram_handle || ""));
    if (tgErr) return NextResponse.json({ error: tgErr }, { status: 400 });
    if (![1, 2, 3, 4, 5].includes(skill_rating))
      return NextResponse.json({ error: "skill_rating must be 1-5" }, { status: 400 });
    const required = ["telegram_announcement", "telegram_chat", "zedu_announcement", "zedu_egret"];
    if (!required.every((k) => channels.includes(k)))
      return NextResponse.json({ error: "All 4 channels must be confirmed" }, { status: 400 });

    const svc = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!,
      supabaseNoStore
    );

    // Already onboarded?
    const { data: existing } = await svc.from("users").select("id").eq("id", user.id).maybeSingle();
    if (existing) return NextResponse.json({ error: "Already onboarded" }, { status: 409 });

    // Verify pair (accepts the masked dropdown form) against the selected
    // org's registration list (015) and resolve the real row
    const table = orgSelection ? await rosterTableForOrgId(svc, orgSelection) : "roster";
    if (!table)
      return NextResponse.json({ error: "That organization has no registration list yet." }, { status: 400 });
    const resolved = await resolveRosterIdentity(svc, workspace_email, zedu_id, table);
    if ("error" in resolved)
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    const row = resolved.row;

    // Atomic claim (fails if raced)
    const { data: claimed, error: cErr } = await svc
      .from("roster")
      .update({ claimed_by: user.id, claimed_at: new Date().toISOString() })
      .eq("email", row.email)
      .is("claimed_by", null)
      .select("email");
    if (cErr) throw cErr;
    if (!claimed || claimed.length === 0)
      return NextResponse.json({ error: "Someone just claimed this email. Contact support." }, { status: 409 });

    // The registration's org becomes the member's working org. Rows imported
    // without an org fall back to the default org (lib/org.ts does the same).
    const orgId = row.org_id || (await defaultOrgId(svc));

    // Insert permanent user (denormalized — roster can be dropped later)
    const { error: uErr } = await svc.from("users").insert({
      id: user.id,
      auth_email: user.email,
      workspace_email: row.email,
      zedu_id,
      full_name,
      github_url,
      telegram_handle: telegram,
      skill_rating,
      channels_verified: true,
      active_org_id: orgId,
    });
    if (uErr) {
      // Roll back claim so the email stays claimable
      await svc.from("roster").update({ claimed_by: null, claimed_at: null }).eq("email", row.email);
      // Surface duplicate nicely
      if (String(uErr.message).includes("duplicate"))
        return NextResponse.json({ error: "This identity is already registered" }, { status: 409 });
      throw uErr;
    }

    await svc.from("user_orgs").upsert({ user_id: user.id, org_id: orgId }, { onConflict: "user_id,org_id" });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "complete failed" }, { status: 500 });
  }
}

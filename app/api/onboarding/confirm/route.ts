import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseNoStore } from "@/lib/supabase-server";
import { authUser } from "@/lib/api-auth";
import { defaultOrgId } from "@/lib/org";
import { ROSTER_TABLE_BY_SLUG } from "@/lib/roster";
import {
  maskEmail,
  normalizeTelegram,
  normalizeZeduId,
  sanitizeText,
  skillLabelToRating,
  telegramError,
} from "@/lib/validation";

// GET  /api/onboarding/confirm — prefill for members whose roster row already
//                        carries the profile details (telegram + github), so
//                        they confirm instead of retyping the wizard.
// POST /api/onboarding/confirm — atomically claim that roster row + create
//                        the users row from the (possibly edited) values.
// Every org keeps its own registration list (015), so the auth email is
// checked against each list: exactly one eligible match wins. No match, or a
// dual-roster match, falls back to the wizard (which asks for the org first).

const COLUMNS =
  "email, zedu_id, full_name, github_url, telegram_handle, skill_label, claimed_by, org_id";

type RosterPreview = {
  email: string;
  zedu_id: string | null;
  full_name: string | null;
  github_url: string | null;
  telegram_handle: string | null;
  skill_label: string | null;
  org_id: string | null;
};

// The auth email can match a roster row's login email or its
// workspace-join email. More than one unclaimed match in one list is
// ambiguous — the wizard path disambiguates with the Zedu ID, so we bail out.
async function findClaimable(svc: SupabaseClient, email: string, table: string): Promise<RosterPreview[]> {
  const { data: byEmail, error: e1 } = await svc
    .from(table)
    .select(COLUMNS)
    .eq("email", email)
    .is("claimed_by", null);
  if (e1) throw e1;
  if (byEmail && byEmail.length > 0) return byEmail as RosterPreview[];

  const { data: byJoin, error: e2 } = await svc
    .from(table)
    .select(COLUMNS)
    .eq("workspace_join_email", email)
    .is("claimed_by", null);
  if (e2) throw e2;
  return (byJoin || []) as RosterPreview[];
}

function isEligible(rows: RosterPreview[]): rows is [RosterPreview] {
  return rows.length === 1 && !!rows[0].telegram_handle && !!rows[0].github_url;
}

// Eligible single matches across every org's list. Exactly one candidate →
// confirm; zero or several (dual-roster members) → wizard.
async function findCandidates(
  svc: SupabaseClient,
  email: string
): Promise<{ row: RosterPreview; table: string }[]> {
  const found: { row: RosterPreview; table: string }[] = [];
  for (const table of Object.values(ROSTER_TABLE_BY_SLUG)) {
    const rows = await findClaimable(svc, email, table);
    if (isEligible(rows)) found.push({ row: rows[0], table });
  }
  return found;
}

async function organizationName(svc: SupabaseClient, orgId: string | null): Promise<string | null> {
  if (!orgId) return null;
  const { data } = await svc.from("organizations").select("name").eq("id", orgId).maybeSingle();
  return data?.name ?? null;
}

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!,
    supabaseNoStore
  );
}

export async function GET(request: Request) {
  try {
    const user = await authUser(request);
    if (!user?.id || !user?.email)
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const svc = serviceClient();
    const { data: existing } = await svc.from("users").select("id").eq("id", user.id).maybeSingle();
    if (existing) return NextResponse.json({ error: "Already onboarded" }, { status: 409 });

    const candidates = await findCandidates(svc, user.email.toLowerCase());
    if (candidates.length !== 1)
      return NextResponse.json(
        { error: "No pre-filled profile for this account — use the full onboarding." },
        { status: 404 }
      );

    const { row } = candidates[0];
    return NextResponse.json({
      prefill: {
        email: maskEmail(row.email),
        zedu_id: row.zedu_id || "",
        full_name: row.full_name || "",
        github_url: row.github_url || "",
        telegram_handle: row.telegram_handle || "",
        skill_label: row.skill_label || "",
        suggested_rating: skillLabelToRating(row.skill_label || ""),
        org_name: await organizationName(svc, row.org_id),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "confirm lookup failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await authUser(request);
    if (!user?.id || !user?.email)
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const full_name = sanitizeText(String(body?.full_name || ""));
    const github_url = sanitizeText(String(body?.github_url || ""), 500);
    const telegram = normalizeTelegram(String(body?.telegram_handle || ""));
    const ratingOverride = Number(body?.skill_rating);

    if (!full_name || !github_url || !telegram)
      return NextResponse.json({ error: "All fields are required" }, { status: 400 });
    const tgErr = telegramError(String(body?.telegram_handle || ""));
    if (tgErr) return NextResponse.json({ error: tgErr }, { status: 400 });

    const svc = serviceClient();
    const { data: existing } = await svc.from("users").select("id").eq("id", user.id).maybeSingle();
    if (existing) return NextResponse.json({ error: "Already onboarded" }, { status: 409 });

    const candidates = await findCandidates(svc, user.email.toLowerCase());
    if (candidates.length !== 1)
      return NextResponse.json(
        { error: "No pre-filled profile for this account — use the full onboarding." },
        { status: 404 }
      );
    const { row, table } = candidates[0];

    // Editing the skill radios wins; otherwise fall back to the label the
    // registration list carried. Neither → member must pick one.
    const skill_rating = [1, 2, 3, 4, 5].includes(ratingOverride)
      ? ratingOverride
      : skillLabelToRating(row.skill_label || "");
    if (!skill_rating)
      return NextResponse.json(
        { error: "Pick your technical skill rating — we couldn't detect one from your registration." },
        { status: 422 }
      );

    // Atomic claim (fails if raced)
    const { data: claimed, error: cErr } = await svc
      .from(table)
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

    // Insert permanent user (denormalized — roster can be dropped later).
    // Channels are considered joined: the roster is the registration record.
    const { error: uErr } = await svc.from("users").insert({
      id: user.id,
      auth_email: user.email,
      workspace_email: row.email,
      zedu_id: normalizeZeduId(row.zedu_id || ""),
      full_name,
      github_url,
      telegram_handle: telegram,
      skill_rating,
      channels_verified: true,
      active_org_id: orgId,
    });
    if (uErr) {
      // Roll back claim so the email stays claimable
      await svc.from(table).update({ claimed_by: null, claimed_at: null }).eq("email", row.email);
      // Surface duplicate nicely
      if (String(uErr.message).includes("duplicate"))
        return NextResponse.json({ error: "This identity is already registered" }, { status: 409 });
      throw uErr;
    }

    await svc.from("user_orgs").upsert({ user_id: user.id, org_id: orgId }, { onConflict: "user_id,org_id" });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "confirm failed" }, { status: 500 });
  }
}

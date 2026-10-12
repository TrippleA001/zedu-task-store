import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isMaskedEmail,
  maskedEmailLike,
  normalizeEmail,
  normalizeZeduId,
} from "@/lib/validation";

export type RosterRow = {
  email: string;
  zedu_id: string;
  full_name: string | null;
  github_url: string | null;
  claimed_by: string | null;
  org_id: string | null;
};

export type ResolvedRoster = { row: RosterRow } | { error: string; status: number };

const COLUMNS = "email, zedu_id, full_name, github_url, claimed_by, org_id";

// Each org keeps its own registration list (015 adds roster_neo; Egret keeps
// the original public.roster), so the same person can appear on several
// orgs' rosters independently. Mirrored in scripts/import-roster.ts —
// the script stays dependency-light, keep the two maps in sync.
export const ROSTER_TABLE_BY_SLUG: Record<string, string> = {
  "zedu-egret": "roster",
  "zedu-neo": "roster_neo",
};

/** Roster table for an org slug; null when the org has no registration list. */
export function rosterTableForSlug(slug: string | null | undefined): string | null {
  return (slug && ROSTER_TABLE_BY_SLUG[slug]) || null;
}

/** Roster table for an organizations.id; null when unknown / unmapped. */
export async function rosterTableForOrgId(svc: SupabaseClient, orgId: string): Promise<string | null> {
  const { data, error } = await svc.from("organizations").select("slug").eq("id", orgId).maybeSingle();
  if (error) throw error;
  return rosterTableForSlug(data?.slug);
}

// Resolve a registration email (full, or the abcd***@domain mask the
// onboarding dropdown shows) + Zedu ID pair to exactly one unclaimed roster
// row. Masked input can match several rows; the Zedu ID picks the right one.
// `table` is the selected org's registration list (rosterTableForSlug).
export async function resolveRosterIdentity(
  svc: SupabaseClient,
  rawEmail: string,
  zid: string,
  table: string
): Promise<ResolvedRoster> {
  const zidNorm = normalizeZeduId(zid);
  let rows: RosterRow[];

  if (isMaskedEmail(rawEmail)) {
    const pattern = maskedEmailLike(rawEmail);
    if (!pattern)
      return { error: "Pick your registration email from the suggestions below the input.", status: 400 };
    const { data, error } = await svc.from(table).select(COLUMNS).ilike("email", pattern);
    if (error) throw error;
    rows = (data || []) as RosterRow[];
  } else {
    const { data, error } = await svc
      .from(table)
      .select(COLUMNS)
      .eq("email", normalizeEmail(rawEmail))
      .maybeSingle();
    if (error) throw error;
    rows = data ? [data as RosterRow] : [];
  }

  if (rows.length === 0)
    return { error: "No registration found for that email — check the spelling.", status: 404 };

  const zidMatches = rows.filter((r) => normalizeZeduId(String(r.zedu_id)) === zidNorm);
  if (zidMatches.length === 0)
    return { error: "That Zedu ID doesn't match this email. Check your registration email.", status: 403 };

  const unclaimed = zidMatches.find((r) => !r.claimed_by);
  if (!unclaimed)
    return { error: "This email has already been claimed. Contact support.", status: 409 };

  return { row: unclaimed };
}

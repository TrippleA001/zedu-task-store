import fs from "node:fs";
import path from "node:path";
import { config as dotenv } from "dotenv";

// Import roster CSV with headers (Egret and Neo rosters both parse; extra
// columns are ignored). Maps Telegram + Technical Skill into the roster
// profile columns (014) so those members onboard via the confirm screen
// instead of the wizard:
// Full name, Email, Zedu username (ID), Email used to join the Zedu workspace,
// Telegram User name, Github url, Technical Skill (Pre AI era)
// Usage: tsx scripts/import-roster.ts ./roster.csv [--org zedu-neo]
// Each org's rows go to that org's own roster table (015; default zedu-egret
// → public.roster) and are stamped with the target org (010+ tenancy).
import { createClient } from "@supabase/supabase-js";

// Mirror of DEFAULT_ORG_SLUG in lib/org.ts (not imported: that module is
// server-only). Keep the two in sync.
const DEFAULT_ORG_SLUG = "zedu-egret";

// Mirror of ROSTER_TABLE_BY_SLUG in lib/roster.ts (the script stays
// dependency-light). Each org keeps its own registration list (015), so the
// same person can appear on several orgs' rosters. Keep the two maps in sync.
const ROSTER_TABLE_BY_SLUG: Record<string, string> = {
  "zedu-egret": "roster",
  "zedu-neo": "roster_neo",
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur = "", row: string[] = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (c === "\r") { /* skip */ }
      else cur += c;
    }
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

async function main() {
  dotenv({ path: ".env.local" });
  dotenv(); // also allow plain .env
  const file = process.argv[2] || "./roster.csv";
  const orgFlag = process.argv.indexOf("--org");
  const orgSlug = orgFlag >= 0 ? process.argv[orgFlag + 1] : DEFAULT_ORG_SLUG;
  const text = fs.readFileSync(path.resolve(file), "utf8");
  const rows = parseCsv(text);
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = {
    name: header.findIndex((h) => h.includes("full name")),
    email: header.findIndex((h) => h === "email"),
    zid: header.findIndex((h) => h.includes("zedu")),
    workspace: header.findIndex((h) => h.includes("workspace")),
    github: header.findIndex((h) => h.includes("github")),
    telegram: header.findIndex((h) => h.includes("telegram")),
    skill: header.findIndex((h) => h.includes("skill")),
  };
  if (idx.email < 0 || idx.zid < 0) throw new Error("CSV must include Email and Zedu username (ID) columns");

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL! || process.env.SUPABASE_URL!, (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!);

  const { data: org, error: orgErr } = await sb
    .from("organizations")
    .select("id")
    .eq("slug", orgSlug)
    .maybeSingle();
  if (orgErr) throw orgErr;
  if (!org) throw new Error(`Org "${orgSlug}" not found — run migration 013 (seeds zedu-neo) or create the org first.`);
  const rosterTable = ROSTER_TABLE_BY_SLUG[orgSlug];
  if (!rosterTable)
    throw new Error(
      `No roster table configured for org "${orgSlug}" — create one (see 015_roster_neo.sql), then register it in scripts/import-roster.ts and lib/roster.ts.`
    );

  let ok = 0, skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const email = (r[idx.email] || "").trim();
    const zedu_id = (r[idx.zid] || "").trim();
    if (!email || !zedu_id) { skipped++; continue; }
    const { error } = await sb.from(rosterTable).upsert({
      full_name: (r[idx.name] || "").trim() || email,
      email,
      zedu_id,
      workspace_join_email: idx.workspace >= 0 ? (r[idx.workspace] || "").trim() || null : null,
      github_url: idx.github >= 0 ? (r[idx.github] || "").trim() || null : null,
      telegram_handle: idx.telegram >= 0 ? (r[idx.telegram] || "").trim() || null : null,
      skill_label: idx.skill >= 0 ? (r[idx.skill] || "").trim() || null : null,
      org_id: org.id,
    }, { onConflict: "email" });
    if (error) { console.error(`row ${i}: ${error.message}`); skipped++; }
    else ok++;
  }
  console.log(`Roster import done (${orgSlug} → ${rosterTable}): ${ok} upserted, ${skipped} skipped`);
}

main().catch((e) => { console.error(e); process.exit(1); });

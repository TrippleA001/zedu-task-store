-- 015_roster_neo.sql
-- Team Neo gets its own registration list so the same person can sit on
-- several orgs' rosters independently (one row per org — no shared email
-- uniqueness). Egret keeps the original public.roster untouched; the
-- importer and the onboarding flows resolve the table from the selected
-- org (see ROSTER_TABLE_BY_SLUG in lib/roster.ts).

create table if not exists public.roster_neo (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email citext unique not null,
  zedu_id text unique not null,
  workspace_join_email citext,
  github_url text,
  telegram_handle text,
  skill_label text,
  org_id uuid references public.organizations(id) on delete restrict,
  claimed_by uuid unique null,
  claimed_at timestamptz null,
  created_at timestamptz default now() not null
);
create index if not exists roster_neo_email_idx on public.roster_neo (email);
create index if not exists roster_neo_unclaimed_idx on public.roster_neo (email) where claimed_by is null;

-- Same posture as public.roster: service-role only, no client policies.
alter table public.roster_neo enable row level security;

-- Stamp any rows written before this migration; the importer stamps new
-- ones (no-op on a fresh table).
update public.roster_neo
   set org_id = (select id from public.organizations where slug = 'zedu-neo')
 where org_id is null;

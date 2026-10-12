-- 013_org_teams_banner.sql — Tenancy completion (Phase 9-11).
-- 1. Canonical sub-teams: per-org `sub_teams` rows replace the free-text
--    users.sub_team column. Teams are managed from /admin (create, rename,
--    drag-and-drop assignment); onboarding keeps sub_team_id NULL.
-- 2. Admin org scoping: users.admin_org_id (NULL = super admin, sees every
--    org; set = scoped to that org only).
-- 3. Per-org announcement banner: organizations.banner_text, rendered by the
--    deep-green bar at the top of every page. Text only — never HTML.
-- 4. Seeds the second org, 'Team Neo' (slug 'zedu-neo'). Members join it via
--    admin assignment; nothing else changes for the default org.
-- Run in Supabase SQL editor (after 012_org_rename.sql).

-- 1a. Sub-teams table. Names are unique per org; rows are service-role only
-- (no client policies — every read/write goes through the admin API).
create table if not exists public.sub_teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz default now() not null,
  unique (org_id, name)
);
alter table public.sub_teams enable row level security;

-- 1b. Move users.sub_team (free text) to users.sub_team_id. Existing values
-- become real teams under the default org, then the text column is dropped.
alter table public.users
  add column if not exists sub_team_id uuid references public.sub_teams(id) on delete set null;

insert into public.sub_teams (org_id, name)
select (select id from public.organizations where slug = 'zedu-egret'), u.sub_team
from (select distinct sub_team from public.users where sub_team is not null and sub_team <> '') u
on conflict (org_id, name) do nothing;

update public.users u
set sub_team_id = s.id
from public.sub_teams s
where s.org_id = (select id from public.organizations where slug = 'zedu-egret')
  and s.name = u.sub_team
  and u.sub_team_id is null;

alter table public.users drop column if exists sub_team;

-- 2. Admin scoping. NULL admin_org_id = super admin (default for the
-- existing role='admin' rows); set = that admin only ever sees this org.
alter table public.users
  add column if not exists admin_org_id uuid references public.organizations(id) on delete set null;

-- 3. Banner. Backfilled with the copy that was hardcoded in app/layout.tsx
-- so the storefront looks unchanged after this migration runs.
alter table public.organizations add column if not exists banner_text text;

update public.organizations
set banner_text = 'Stage 1 verification is open — complete your ToDo milestone to claim your receipt.'
where slug = 'zedu-egret'
  and banner_text is null;

-- 4. The second org. Safe on re-run.
insert into public.organizations (name, slug)
values ('Team Neo', 'zedu-neo')
on conflict (slug) do nothing;

-- Organizations become world-readable: logged-out visitors see the
-- storefront banner (previously authenticated-only from 010). Names,
-- slugs and banner text are public-facing; nothing sensitive lives here.
drop policy if exists "orgs_read_authenticated" on public.organizations;
create policy "orgs_read_public" on public.organizations
  for select using (true);

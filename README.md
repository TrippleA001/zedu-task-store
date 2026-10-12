# Zedu Egret Store — Task Verification & Onboarding Portal

E-commerce metaphor (Catalog → Cart → Checkout → Order Receipt) where program
milestones are zero-cost products. Next.js App Router + Supabase + Mailgun.

## Contributors page publishing (cross-repo)

The generated page lives in the staging frontend repo, not here. The GitHub Action
(`.github/workflows/build-contributors.yml`) queries Supabase and publishes two files
into `HNG-ZEDU-EGRET/zedu-fe@dev` via the GitHub Contents API — Coolify then redeploys.

Target files:
- `src/app/(homepage)/contributors/index.ts` — generated data
- `src/app/(homepage)/contributors/page.tsx` — App Router page that renders it

```bash
npm run publish:contributors -- --dry-run   # preview, publishes nothing
npm run publish:contributors                # publish to CONTRIBUTORS_REPO
npm run preview:contributors                # local HTML preview only
```

Repo secrets (`Settings → Secrets and variables → Actions`):

| Secret | Purpose |
|---|---|
| `CONTRIBUTORS_REPO_TOKEN` | Fine-grained PAT on `HNG-ZEDU-EGRET/zedu-fe`, **Contents: Read and write** |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_…` value |

Optional **Variables**: `CONTRIBUTORS_REPO`, `CONTRIBUTORS_REPO_BRANCH`, `CONTRIBUTORS_REPO_DIR`.

Notes:
- Output is deterministic (no timestamps), so a nightly run with no new submissions
  produces no commit and no redeploy.
- Stale-sha conflicts are retried, and `concurrency` serialises overlapping runs.
- `[skip ci]` in the commit message prevents the fork's own CI from firing.

## Resetting a test account

`supabase/dev/reset_test_account.sql` clears a test user's submissions, orders,
notifications and profile, and releases their `roster` claim so the same account can
onboard again. The roster claim is **not** covered by any cascade.

## Migrations

Run in order in the Supabase SQL Editor:
1. `supabase/migrations/001_init.sql` — roster, users, products, orders, submissions + RLS
2. `supabase/migrations/002_notifications.sql` — in-account notifications (order receipts)
3. `supabase/migrations/003_cart.sql` — persisted cross-device cart + Realtime sync
4. `supabase/migrations/004_weeks_tasks.sql` — week_number + per-task submission_schema + values JSONB (backfills existing submissions)
5. `supabase/migrations/005_change_requests.sql` — profile change-request queue + owner-only RLS read
6. `supabase/migrations/006_admin_roles.sql` — `users.role` (member/admin) + queue index; drops the client-side users UPDATE policy (all profile writes are service-role). Promote an admin with:
   `update public.users set role='admin' where workspace_email='…';`
7. `supabase/migrations/007_task1_schema.sql` — moves Task 1's checkout form (deployed URL + GitHub repo) from a hardcoded fallback into its product row (admin-editable in `/admin`)
8. `supabase/migrations/008_task_open.sql` — `products.is_open` replaces the code-bound `TASK_OPEN` gate; backfills tasks 1–5 open, new tasks closed by default. Toggle per task from `/admin` (or set `is_open` directly)
9. `supabase/migrations/009_products_realtime.sql` — live catalog updates: adds `products` to the `supabase_realtime` publication so open storefronts refetch the moment a task is edited from `/admin` (focus/visibility refetch covers clients opened before this migration runs)
10. `supabase/migrations/010_organizations.sql` — multi-tenancy core: `organizations` + `user_orgs` junction + `users.active_org_id`; `org_id` on roster/products/orders/submissions; task numbers unique per org; backfills everything into a single `Zedu Egret` org so behavior is unchanged
11. `supabase/migrations/011_task_policy.sql` — per-task policy: `products.prereq_stages` (range/list syntax, empty = previous stage) + `products.attempts_policy` (`single` | `multiple`); submissions gain `attempt_number` + `is_current` with one-current-attempt-per-task enforced by partial unique index (replaces the per-org unique user/stage rule)
12. `supabase/migrations/012_org_rename.sql` — the default org (`Zedu Egret`) now displays as `Team Egret` in the onboarding dropdown and profile switcher (slug `zedu-egret` unchanged — internal only)
13. `supabase/migrations/013_org_teams_banner.sql` — tenancy completion: canonical per-org `sub_teams` (replaces free-text `users.sub_team`), `users.admin_org_id` (NULL = super admin), `organizations.banner_text` (per-org announcement bar), seeds the `Team Neo` org (`zedu-neo`), and makes org rows world-readable so logged-out visitors see the banner
14. `supabase/migrations/014_roster_profile.sql` — roster rows carry the profile details collected at registration (`telegram_handle`, `skill_label`) so imported members can confirm their profile on first login instead of retyping it; the onboarding wizard remains the fallback for rows without them

## Opening a task later

Tasks stay visible and **Unlocked** after their prerequisite, but `Add to cart` is
greyed out ("opening soon") until the task is opened. Open it from the admin
console (`/admin` → **Open checkout** on the task's card, or the **Open** checkbox
in the edit form). The checkout API enforces the same `products.is_open` flag
server-side (returns 423 otherwise) — no redeploy needed.

## Quick start

```bash
cp .env.example .env.local   # fill keys (see below)
npm install
# Run supabase/migrations/001_init.sql in Supabase SQL Editor
npm run import:roster ./roster.csv
npm run dev                  # http://localhost:3000
```

## Env vars (`.env.local`, never commit)

| Var | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dashboard → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same page → publishable key (`sb_publishable_...`) |
| `SUPABASE_SECRET_KEY` | Same page → secret key (`sb_secret_...`, new format) or legacy service_role JWT |
| `GITHUB_PAT` | GitHub → Settings → Developer settings → Fine-grained PAT: Repository `Contents: Read`, `Metadata: Read`, public repos |
| `MAILGUN_API_KEY` / `MAILGUN_DOMAIN` / `MAILGUN_FROM` | Mailgun → Sending → Domains / API keys (optional; skipped if placeholder) |
| `CONTRIBUTORS_WEBHOOK_URL` / `CONTRIBUTORS_WEBHOOK_TOKEN` | GitHub repo dispatches URL + PAT with `Contents: write` (optional locally) |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` locally |

## Key flows

- `/login` → Google OAuth → `/auth/callback` → `/` or `/onboarding`
- `/onboarding` — Step 1: roster email dropdown + Zedu ID verify; Step 2: profile + 4 channel checkboxes; Step 3: skill 1–5 (sub-team greyed out, auto-assigned later)
- `/` — storefront: Task 1 active ($0.00), later tasks locked until prereq.
  Tasks are grouped into Week 1 / Week 2 sections; the checkout form is
  driven by each task's `submission_schema` (Task 3 needs a video + APK
  drive link, mobile repo, and a MERGED PR link).
  Cart is persisted in `public.carts` and synced web↔mobile over Realtime —
  closing the drawer minimizes (floating chip reopens); checkout or
  "Remove from cart" clears it on all devices.
- `POST /api/checkout` — schema-driven per `submission_schema`: HTTPS + SSRF guard for `live_url`, HTTP-200 app check, GitHub `!private && size>0`, Drive host check, GitHub PR **merged** check, duplicate guard, `ZE-2026-XXXX` order, Mailgun + webhook fire-and-forget

## Scripts

- `npm test` / `npx tsc --noEmit` / `npm run build`
- `npm run import:roster ./roster.csv` — CSV headers: `Full name,Email,Zedu username (ID),Email used to join the Zedu workspace,Github url`
- `npx tsx scripts/build-contributors.ts` — writes `public/contributors/zedu-egret/index.html` (also via GitHub Action)

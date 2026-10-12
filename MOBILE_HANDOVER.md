# MOBILE_HANDOVER.md — Zedu Egret Store mobile app spec

Handover for the agent building the **mobile app in a separate repository**
(target: Expo / React Native + TypeScript, APK via EAS). Everything below is
the exact backend + protocol contract. **No web code changes are needed** —
Phase 0 (cart persistence + Bearer auth) is already live in `task_commerce/`.

Related docs in this repo: [`AGENTS.md`](./AGENTS.md) (agent working guide),
[`PRD.md`](./PRD.md) (product intent), [`README.md`](./README.md) (setup).

## 1. What you are building

A native mobile client with full feature parity against the web storefront:

| # | Screen | Web source of truth | Backend |
|---|---|---|---|
| 1 | Login (Google OAuth) | `app/login/page.tsx` | Supabase Auth |
| 2 | Onboarding wizard (3 steps) | `app/onboarding/page.tsx`, `step-two.tsx` | `POST /api/onboarding/verify`, `POST /api/onboarding/complete` |
| 3 | Storefront catalog + stage locks | `app/page.tsx` | `GET /api/products`, `GET /api/orders` + `is_open` per product |
| 4 | Cart + checkout | `app/page.tsx`, `components/cart-drawer.tsx`, `lib/use-cart.ts` | `carts` table (Realtime) + `POST /api/checkout` |
| 5 | Order receipts / success | `components/success-panel.tsx` | `GET /api/orders` |
| 6 | Notifications inbox | (header badge) | `GET/PATCH /api/notifications` |
| 7 | Contributors listing | `app/contributors/page.tsx` | existing static/published output |

## 2. Backend connection

- Supabase project URL + anon (publishable) key — **public values**, request
  them from the lead along with:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - Web API base URL (deployed store, e.g. `https://store.<team>.…`) for the
    `/api/*` routes below.
- **Secret keys (`SUPABASE_SECRET_KEY`, `GITHUB_PAT`, Mailgun) never leave
  the server.** If any screen design needs privileged data, call the API
  route — never embed secrets in the app.


## 3. Auth (read carefully — most common integration failure)

- Provider: **Google OAuth via Supabase Auth** (`supabase.auth.signInWithOAuth({ provider: "google" })`).
- Redirect config (lead must register in **both** Supabase Dashboard → Auth → URL Configuration **and** Google Cloud OAuth client):
  - Expo dev: `exp://<slug>/--/auth/callback`
  - Standalone APK: `<your-scheme>://auth/callback` (e.g. `io.egret.store://auth/callback`)
- Session: same Supabase project as web; each device holds its own session
  (normal — no session sharing needed).
- **Every API call below must send** `Authorization: Bearer <supabase_access_token>`
  using the current session's access token. Web uses cookies; mobile uses the
  header. Both are accepted (`lib/api-auth.ts`: cookie first, Bearer fallback,
  verified server-side via `auth.getUser`).
- Unauthenticated calls return `401 { error: "Not authenticated" }` → route
  the user back to Login.

## 4. API route contracts (all relative to the web API base URL)

> Phase 1 change: checkout is now schema-driven. It accepts the new
> `{ userId, productId, taskNumber, values }` body; the legacy
> `{ stageNumber, todoAppUrl, taskRepoUrl }` body still works (mapped to
> Task 1's schema). Available tasks are grouped by week on the storefront;
> `submission_schema` on each product defines its required fields
> (`live_url` | `github_repo` | `drive_url` | `github_pr` | `text`).
> PR links must reference a MERGED PR — open or closed-unmerged is rejected
> (422). See `supabase/migrations/004_weeks_tasks.sql` for current tasks.

### `GET /api/products` — no auth
`{ items: [{ id, title, description, price, stage_number, week_number, is_open, submission_schema }] }`
(sorted by week, then stage). Stage 1 = `$0.00` active; Stage 2+ lock semantics below.
`is_open` gates checkout: `false` → grey the button out ("opening soon"); the
server enforces the same flag with a 423 if checkout is forced.

Live catalog updates (Phase 5, migration `009_products_realtime.sql` — required
or the channel below never fires): the storefront keeps the catalog in sync
without a reload, and the app should mirror this exactly:

1. Fetch `/api/products` on screen open (as today).
2. Subscribe to Realtime on `public.products` (anon key, no filter — everyone
   sees the same catalog):

   ```ts
   supabase
     .channel("products")
     .on("postgres_changes",
       { event: "*", schema: "public", table: "products" },
       () => refetchProducts()) // debounce ~250 ms; leads save in bursts
     .subscribe();
   ```

3. On app foreground (RN `AppState` → `active`) refetch `/api/products` —
   the web equivalent is window focus + `visibilitychange`, and it covers
   sleep gaps where the socket dropped. Cheap: one uncached GET.

### `GET /api/orders` — Bearer auth
`{ orders: [...], stages: number[] }` — `stages` = completed stage numbers,
drives locks + progress.

### `POST /api/checkout` — Bearer auth
Body: `{ userId, productId, taskNumber, values }` where `values` maps each
required `submission_schema` key to the user's URL/text (e.g. Task 3:
`{ video_drive, apk_drive, mobile_repo, merged_pr }`). Legacy body
`{ userId, productId, stageNumber, todoAppUrl, taskRepoUrl }` still works.
`userId` must equal the token's user (403 otherwise). Server validates in
order: fields (400) → per-field schema checks (400 required missing; 422
invalid: https + SSRF for `live_url`, public + non-empty for `github_repo`,
Drive host for `drive_url`, MERGED status for `github_pr`) →
product/task match (400/404) → purchasable gate (**423**) → prereq (**423**)
→ duplicate (**409**). Success: `{ ok: true, orderId, order_number: "ZE-2026-XXXX", email }`.

### `GET /api/notifications` / `PATCH /api/notifications` — Bearer auth
GET → `{ items: [{ id, kind, title, body, order_number, read_at, created_at }], unread }` (latest 50).
PATCH `{ ids?: string[] }` → `{ ok: true }` (omitted = mark all read).

### `POST /api/onboarding/verify` — no auth
Body `{ workspace_email, zedu_id, org_id? }` → `{ ok: true, prefill }` or
400/404/409/403 with display-ready `error`. `org_id` selects the org whose
registration list is checked (each org keeps its own list); omit it for the
default org.

### `POST /api/onboarding/complete` — Bearer auth
Body `{ workspace_email, zedu_id, org_id?, full_name, github_url, telegram_handle, skill_rating (1-5), channels: [4 required keys] }` → `{ ok: true }` or 400/403/404/409. Pass the same `org_id` as verify.

### `GET /api/roster/emails?q=&org_id=&limit=` — no auth
`{ items: [{ email, hint }] }` for the Step-1 dropdown. `org_id` picks the
registration list; omitted = all lists merged.

### `POST /api/change-requests` — Bearer auth (Phase 2)
Request a profile edit for admin review — the app never edits `users`
directly. Body `{ field, new_value, note? }` where `field` ∈
`full_name | github_url | telegram_handle | skill_rating` (emails, Zedu ID
and sub_team are fixed). Server validates `new_value` per field (400 unknown
field, 422 invalid, 400 unchanged, 409 pending-duplicate) and captures the
previous value itself — never send `old_value`. Success:
`{ ok: true, request: { id, field, old_value, new_value, status } }`.
Read pending/status via Supabase RLS:
`sb.from("change_requests").select("*").eq("user_id", uid)` (owner read only).

## 5. Cart sync protocol (exact contract — implement verbatim)

Table `public.carts` (migration `supabase/migrations/003_cart.sql`):

```sql
user_id uuid primary key references users(id) on delete cascade,
product_id uuid not null references products(id) on delete cascade,
todo_url text default '', repo_url text default '',
created_at timestamptz default now(), updated_at timestamptz default now()
```

- RLS: owner-only select/insert/update/delete. Client writes use the **anon
  key** with the user's session (RLS enforces `auth.uid() = user_id`).
- One row per user (upsert `onConflict: "user_id"`). Single-item cart.

Sync channel (Supabase Realtime, anon key):

```ts
supabase
  .channel(`cart:${userId}`)
  .on("postgres_changes",
    { event: "*", schema: "public", table: "carts", filter: `user_id=eq.${userId}` },
    (payload) => {
      if (payload.eventType === "DELETE") clearLocalCart();
      else if (payload.new.updated_at > lastSeenUpdatedAt) applyRow(payload.new);
    })
  .subscribe();
```

Rules (mirror web `lib/use-cart.ts`):

1. On login: fetch own row → hydrate cart (product lookup by `product_id`
   from `/api/products`), URLs, `updated_at`.
2. On local change: upsert row immediately (debounce URL keystrokes ~600 ms);
   set `updated_at = now()`.
3. On remote event: apply only if `payload.new.updated_at` is newer than
   local `updated_at` (last-write-wins). DELETE always applies.
4. On successful checkout (either device): **delete the row**. The remote
   DELETE event clears the other device automatically.
5. On app foreground **or** the `online` event: if a local write/delete
   failed while offline (dirty flag), push it first; otherwise re-fetch the
   row. This is what converges offline edits — the web client does exactly
   this (`lib/use-cart.ts`: `dirtyRef`/`removePendingRef` + `online`
   listener). Never silently drop a failed write.
6. Drawer semantics: closing minimizes (row stays); explicit "Remove"
   deletes the row everywhere. Show a cart badge while a row exists.

## 6. Copy-don't-rewrite modules

Pure TypeScript, no Next.js imports — copy these files into the mobile repo
(keep in sync manually if they change):

- `lib/validation.ts` → `isHttpsUrl`, `isBlockedHost`,
  `parseGithubRepo`, `parseGithubPr`, `parseDriveUrl`, normalizers. Reuse for
  client-side pre-checks so the user gets instant feedback; server re-validates
  anyway. Render checkout inputs from each product's `submission_schema` — an
  empty/missing schema means checkout is disabled (the server returns 422).
  (`lib/store.ts` no longer exists: the open/closed gate is `is_open` on each
  product — there is no client-side map to copy.)

## 7. Screen-by-screen notes

1. **Onboarding**: 3 steps per `PRD.md` §4.1 + `app/onboarding/`. Step 1:
   email dropdown (`roster/emails`) + Zedu ID → `verify`. Step 2: profile
   fields + 4 channel checkboxes. Step 3: skill 1–5 (sub-team greyed out).
   Finish → `complete`. Respect each error message verbatim.
2. **Storefront**: week sections with task cards; per-task state machine
   from web `app/page.tsx`: done (in `stages`) → "Completed"; unlocked +
   `is_open` → "Add to cart"; unlocked but closed (`is_open=false`) → greyed
   "opening soon"; locked → "Complete Task N-1 first".
   `unlocked = task===1 || stages.includes(task-1)`.
3. **Cart/checkout**: bottom-sheet ≈ web `CartDrawer`; inputs rendered from
   the product's `submission_schema`; "Place order ($0.00)" disabled until
   all required fields are filled; POST checkout with `{ taskNumber, values }`;
   success screen shows `order_number` + email status (mirror `SuccessPanel`).
4. **Notifications**: badge = `unread`; tap-all-read calls PATCH.
5. **Contributors**: render the published static page in a WebView or fetch
   its data — ask the lead which output (HTML vs data file) is current.

## 8. APK build (Expo)

```sh
npx create-expo-app egret-store-mobile --template blank-typescript
npm i @supabase/supabase-js @react-native-async-storage/async-storage \
  expo-auth-session expo-crypto expo-web-browser
# app.json: scheme "io.egret.store", EAS projectId
npx expo install expo-dev-client   # dev builds
eas build --profile preview --platform android   # → installable .apk
```

Register the scheme + `exp://` redirects (see §3) before testing login.
`eas.json` preview profile should use `developmentClient: false`,
`distribution: "internal"` for a shareable APK.

## 9. Sync verification checklist (run before handover)

1. Add to cart on web → cart screen opens on mobile (<2 s).
2. Edit URLs on mobile → web drawer shows them.
3. Remove on mobile → web chip disappears (and reverse).
4. Checkout on web → mobile cart clears + receipt appears (and reverse).
5. Kill/reopen mobile with airplane mode mid-edit → foreground refresh
   converges to the latest `updated_at` row.
6. Stage 2 closed: mobile "Add to cart" greyed exactly like web; server
   returns 423 if forced.
7. Fresh login on mobile after web onboarding → lands on storefront, not
   onboarding (same `users` row).

## 10. Out of scope / do NOT duplicate server-side

Checkout validation, order creation, emails, roster claim, contributors
publish — all stay in this repo's API routes + Actions. Mobile is a
**client only**. Never embed `SUPABASE_SECRET_KEY`, `GITHUB_PAT`, or
Mailgun keys in the app.


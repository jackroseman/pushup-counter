# Push-up Battles: architecture & delivery plan

> Status: **draft for review**. Nothing here has been created or deployed yet: no Supabase
> project, no secrets, no builds. See [SPEC.md](SPEC.md) for the product side and
> [schema.sql](schema.sql) for the draft database migration.

## 1. Overview

```
 iPhone app (Expo SDK 58, RN 0.88)                     Supabase (one project per env)
 ┌────────────────────────────────────┐               ┌───────────────────────────────────┐
 │ existing: ARKit depth counter,     │  HTTPS (JWT)  │ Auth: Sign in with Apple          │
 │ analysis, local history            │──────────────▶│ Postgres: tables + RLS + views    │
 │ new: supabase-js client, auth,     │  PostgREST /  │   (metrics computed at query time)│
 │ sync queue, battles UI,            │  RPC          │ Edge Functions (Deno):            │
 │ realtime channel, push handling    │──────────────▶│   submit-set, redeem-invite,      │
 └────────────────────────────────────┘               │   notify, finalize,               │
          ▲            ▲   Realtime (WebSocket)       │   delete-account                  │
          │            └──────────────────────────────│ Realtime: private battle:<id>     │
          │ push                                      │   channels (broadcast + presence) │
 ┌────────┴────────┐  HTTPS (Expo push API)           │ pg_cron: finalize every minute    │
 │ Expo Push → APNs│◀─────────────────────────────────│ DB webhooks → notify              │
 └─────────────────┘                                  └───────────────────────────────────┘
 Universal links: https://<domain>/b/<token> → apple-app-site-association + landing page
```

**The phone stays the measuring instrument; the server stays the referee.**

* Counting and per-rep measurement run on-device, unchanged.
* The server stores only **raw measurements** and computes every derived number
  (depth %, quality, tempo, scores, standings, stats) in SQL views at query time.
* That gives one source of truth: there is no "battle score" column that can drift from the
  reps behind it.
* **One deliberate exception**: when a battle completes, its final standings are frozen into
  `battle_results`, because results are locked once a battle is over (see "Locked results"
  below).

## 2. Supabase pieces

| piece | use |
|---|---|
| **Auth** | **Sign in with Apple** (native via `expo-apple-authentication` → `supabase.auth.signInWithIdToken({ provider: 'apple' })`). There are no passwords. A `profiles` row holds the public `@username`. Email/magic link could be added later for Android. |
| **Postgres** | The normalized schema in `schema.sql`: `profiles`, `devices`, `push_tokens`, `friendships`, `battles`, `battle_invite_links`, `battle_participants`, `detector_configs`, `sets` (nullable `battle_id`), `reps`, `set_traces`, `set_flags`, plus `battle_results` (locked final standings, written only by `finalize_battles()`). Row Level Security is on for every table. Derived data comes from views: `rep_metrics` → `set_metrics`, `battle_entries` → `battle_standings_live` → `battle_standings` (locked rows for completed battles, live rows otherwise), `user_stats`. |
| **Realtime** | Private **broadcast + presence** channels `battle:<uuid>` for live battles. Access is controlled by RLS on `realtime.messages`: only participants of that battle may read/write. The client joins with `{ config: { private: true } }`, and "Allow public access" is turned off in the Realtime settings. Postgres-changes subscriptions are not needed: the battles screen refetches on push/focus. |
| **Edge Functions** | `submit-set`: validates and inserts battle sets (the hard anti-cheat checks), then calls `submit_set` as the service role. Solo sets use the RPC directly under RLS. `redeem-invite`: token → participant row (+ friendship). `notify`: called by DB webhooks, cron and other functions; it looks up tokens and sends via the Expo Push API. `finalize`: optional HTTP wrapper; the work itself is the SQL function `finalize_battles()` on `pg_cron`. `delete-account`: deletes the auth user (cascades to all their data). |
| **Cron** | `pg_cron`: `finalize_battles()` every minute; reminder pushes every 15 min. |

Why **metrics in views, not tables**: the user asked for normalized data with metrics
computed on the backend at query time. At this scale (a set is about 50 reps and one trace
row), the views stay cheap. If they ever get slow, the same SQL can back a
**materialized view** or a cache table refreshed at battle completion, without changing
the API (noted in `schema.sql`).

Why **locked results** (`battle_results`), the one stored derived table: the product rule is
that a result is final once the battle ends. Two options were considered:

* **Pin `scoring_version` and keep queries deterministic** (no stored results). Rejected:
  the version pins the *formula*, but a result also depends on its *inputs*: plausibility
  rules in `rep_metrics`, `set_flags` exclusions, detector-math fixes, and view edits. Any of
  those would silently change old winners, and keeping every old rule alive forever as
  versioned code is fragile.
* **Snapshot at finalize** (chosen). `finalize_battles()` marks the battle `completed` and,
  in the same transaction, inserts the standings computed at that moment (rank, winner,
  good reps, tempo score, metric value, best set, scoring version, `locked_at`) into
  `battle_results`. There is never a moment where a battle is completed but unlocked.
  `battle_standings` serves these rows for completed battles, and `user_stats` W/L/D reads
  them, so nothing downstream recomputes a finished battle. Clients can only read their own
  battles' rows (RLS, no write grants), and an `UPDATE` trigger rejects changes even from
  the service role. Raw sets/reps stay, so the charts still render; only the verdict is
  frozen. `scoring_version` is still kept so a battle *in progress* during a formula rollout
  keeps the formula it started with.

The cost is a small table (one row per participant per finished battle), and the rows are
written once and never updated, so the usual "derived data drifts" problem doesn't apply.

Why **store the detector config** (`detector_configs`): quality (Full/Good/Shallow) is
derived from raw distances plus the thresholds the phone used. Storing the thresholds once
(deduplicated) lets the server recompute exactly what the phone showed, even after tuning
changes in a later OTA.

### Shared logic

The depth-ratio and quality rules exist in TypeScript (`src/core/scoring.ts`,
`analysis.ts`) and are mirrored in SQL (`depth_ratio()`, `rep_metrics`, `set_metrics`).

* Add a Jest test that runs fixture sets through both and compares the results. The SQL
  side runs in the CI `db` job below.
* Edge Functions (Deno) can import the same pure TS from `src/core` for validation, so
  there is no third copy.

## 3. Data flow

**Solo set (signed in)**
1. The set is saved locally, exactly as today.
2. The sync queue uploads it: `rpc('submit_set', record)`.
   * Idempotent on `(user_id, client_set_id)`, so a retry is safe.
   * A set recorded offline uploads later.

**Battle set**
1. The set is saved locally first, so it is never lost.
2. It is POSTed to `functions/v1/submit-set` with the user's JWT. The function validates it
   and calls `submit_set`.
3. DB triggers re-check membership, the deadline (server clock) and attempts left.
4. A trigger queues a notification in the outbox and `notify` sends "Bob did 28" (§9
   Phase 3 notes).

**Results**
* `select * from battle_standings where battle_id = …` (`locked = true` once the battle
  is completed; provisional before that).
* Plus `rep_metrics` for the charts (per-rep depth/tempo) and `set_traces` for the trace
  overlay.

**Stats**
* `select * from user_stats where user_id = …`

## 4. Push notifications (Expo)

* `expo-notifications` + `expo-device`:
  1. Ask permission with a primer screen (SPEC §8).
  2. `getExpoPushTokenAsync({ projectId })`.
  3. Upsert into `push_tokens` keyed by `device_id`, so there is one token per
     installation.
* APNs key: EAS manages push credentials (`eas credentials`). We never handle the `.p8`
  ourselves.
* Sending: `notify` → `https://exp.host/--/api/v2/push/send`.
  * Batches of up to 100.
  * Reads receipts later. `DeviceNotRegistered` → set `push_tokens.disabled_at`.
  * Optionally use an Expo access token ("enhanced push security"), stored as a Supabase
    function secret.
* Tapping a notification: the payload has `url: "pushupcounter://battle/<id>"`, and the
  app's linking handler routes it (also on cold start).

## 5. Deep links & universal links

* **Custom scheme** (works in every build): `pushupcounter://battle/<id>`, `…/invite/<token>`.
* **Universal links**: `https://<domain>/b/<token>`.
  * Needs a domain we control (open question; for example a small Vercel site).
  * The site serves `/.well-known/apple-app-site-association` (`applinks` for
    `<TeamID>.com.jackroseman.pushupcounter`) and a landing page with the battle preview +
    an App Store/TestFlight link.
  * App side: `ios.associatedDomains: ["applinks:<domain>"]` in `app.config.ts`. This is a
    **native/entitlement change**, so it goes in the one native batch.
  * Dev variant (`.dev` bundle id) needs its own AASA entry.
* Invite tokens are random 32-hex strings (`battle_invite_links`). They can expire, can be
  revoked, and have a use count. The landing page reads public battle info only through the
  `redeem-invite` function (anonymous `GET` preview, authenticated `POST` redeem).

## 6. Live battles: Realtime design & cost

* Channel `battle:<id>`, private, with **presence** (`{userId, ready, calibrated}`) and
  **broadcast** `rep` events `{repIndex, quality, tMs}`.
* The receiver keeps `max(repIndex)` per player, so duplicates and reordering are harmless.
  On reconnect, a client re-broadcasts its current state.
* The start time comes from the DB (`starts_at = now() + 5s`). Clients estimate their clock
  offset with a few `server_now()` round trips (NTP-style: take the lowest-latency sample),
  then schedule Go locally.
* Authorization policies on `realtime.messages` are in `schema.sql`. Notes:
  * Supabase caches them per connection, so a removed participant keeps access until they
    reconnect. That is acceptable.
  * We do **not** `ALTER TABLE realtime.messages` (Supabase manages it).
* **Free-plan cost**:
  * Quota: 2 M Realtime messages and 200 peak connections per month. A broadcast is billed
    as 1 send + 1 per receiver.
  * Rep ticks: a 50-rep live battle is about 2 × 50 × 2 ≈ 200 messages, plus presence.
    That's thousands of battles a month.
  * An optional 5 Hz distance stream for a live "ghost" chart is about 2 players × 5 Hz ×
    120 s × 2 ≈ 2,400 messages per battle. That's fine for friends, but it is opt-in.

## 7. Environments, CI/CD

### Supabase projects

| env | Supabase project (ref) | app build that talks to it | migrations deployed from |
|---|---|---|---|
| staging | `pushup-battles-staging` (`qkfdkeoijboazztnliob`) | EAS env `development` (Pushup Dev, branch `dev`) | push to `dev` |
| production | `pushup-battles-prod` (`qjvmkqajlvpzfyynbetn`) | EAS envs `preview` + `production` (branch `main`, TestFlight / App Store) | push to `main` |

Both are free-plan projects in `us-east-1`, created in phase 1. Project refs aren't secret
(they are in the public URL).

* Two projects = the free plan's limit of 2 active projects.
* Free projects **pause after ~1 week of inactivity**. Staging probably will. Unpausing is a
  click; production will have traffic. (Pro is an open question.)
* The client config is **public by design**: `EXPO_PUBLIC_SUPABASE_URL` and the
  anon/publishable key are stored as **EAS environment variables** per environment
  (`development`, `preview`, `production`) and read at runtime (`src/backend/config.ts`).
  Without them the app runs in offline solo mode.
* The service-role key is used **only** inside Edge Functions (Supabase sets it
  automatically). It never goes in the app or the repo.

### Repo layout (added in phase 1)

```
supabase/
  migrations/20261031191027_battles_initial.sql    ← from docs/battles/schema.sql + app_settings
  migrations/20261031191033_battles_cron.sql       ← pg_cron: finalize-battles every minute
  migrations/20261031191149_battles_hardening.sql  ← advisor fixes (private schema, grants, FK indexes)
  migrations/20261031200357_identity.sql           ← phase 2b: username check, device + push token
                                                     RPCs, delete_my_account, FK-cascade fixes
  functions/
    _shared/expoPush.ts  (pure helpers, unit-tested by jest: __tests__/expoPush.test.ts)
    notify/              (phase 2b: Expo push sender; later phases add more functions)
  tests/       (node:test on PGlite: RLS + state-machine + metrics + settings tests; `npm run test:db`)
```

### GitHub Actions (CI, on PRs: no secrets needed)

* The required `checks` job now also runs `npm run test:db`: the migrations (except
  `*_cron.sql`) are applied to an in-process Postgres (PGlite) with small auth/realtime
  stubs, then RLS, state-machine, metric and settings tests run (`supabase/tests/`).
  Edge Function helpers in `supabase/functions/_shared` are unit-tested by jest;
  `deno check supabase/functions/notify/index.ts` passes locally (not yet in CI).

### GitHub Actions (CD for the backend, after merge)

* Workflow `supabase-deploy.yml` (phase 1):
  * Runs on push to `dev` → environment `staging`, and to `main` → environment
    `production`, when `supabase/migrations/` changes. Never on PRs. Each GitHub
    environment only accepts its own branch.
  * Steps: `supabase link --project-ref $SUPABASE_PROJECT_REF`, `supabase db push --dry-run`,
    `supabase db push`, then `supabase functions deploy --no-verify-jwt --use-api` (phase 2b;
    also triggered by changes in `supabase/functions/`). Functions authorize requests
    themselves.
* Secrets: `SUPABASE_ACCESS_TOKEN` (repo secret; the job skips with a warning until it
  exists), `SUPABASE_PROJECT_REF` (per environment), optional `SUPABASE_DB_PASSWORD`
  (the CLI otherwise uses a temporary login role derived from the token).
* PR CI still needs no secrets (CONTRIBUTING §10).
* The backend deploy stays in **GitHub Actions**, not EAS Workflows. EAS Workflows keep
  doing what they do now (fingerprint → OTA or build), and their free-plan minutes are kept
  for the app.

### Migration safety (old apps keep running)

Several app versions talk to the same database: old TestFlight builds, and OTA updates
still downloading. So migrations are **expand → migrate → contract**:

1. Add new columns/tables/functions (nullable or defaulted). Never rename or drop in the
   same release.
2. Ship the app that uses them (OTA or build).
3. Remove the old things only after all supported runtimes stop using them.

RPC and view changes get new versions (`submit_set_v2`) instead of edits in place. App
uploads carry `data_version` (the `SessionRecord.version`) and `scoring_version` lives on
battles.

### EAS (app)

* Unchanged: `deploy-dev.yml` (push to `dev`) and `deploy.yml` (push to `main`).
  * fingerprint → OTA if the native fingerprint matches, otherwise build.
  * Phases 3–5 are JS-only and ship as OTA updates.
* **TestFlight**: add a release step that runs
  `eas build -p ios --profile production --auto-submit` (or `eas submit -p ios --latest`)
  using the existing `submit.production` profile. Two options:
  * a manual GitHub/EAS workflow (`workflow_dispatch`)
  * a tag `v1.2.0` that triggers `build` + `submit` jobs in a new `.eas/workflows/release.yml`
  * Recommendation: manual, because builds are scarce (see below).
* App Store Connect API key for submit: stored in EAS credentials (`eas credentials`), not
  in GitHub.

## 8. Native changes: one batch, minimal builds

The free Expo plan has **15 iOS builds/month**, so **every native change goes into a
single batch, and every later battle phase ships as OTA updates.**

The native batch (phase 2, one PR, `version` 1.1.0 → **1.2.0**):

| change | why |
|---|---|
| `expo-notifications` (+ config plugin, push entitlement) | invites, results |
| `expo-apple-authentication` (+ "Sign in with Apple" capability) | auth |
| `expo-secure-store` | store the Supabase session securely (Keychain) |
| `expo-device` | push token only on real devices; device model for `devices` |
| `expo-linking` scheme + `ios.associatedDomains` | deep / universal links |
| `react-native-screens`, `react-native-safe-area-context` (+ `@react-navigation/native-stack`) | if we adopt React Navigation (open question) |
| `expo-application` | stable installation id |
| `NSCameraUsageDescription` text tweak | mention battles ("…to count reps in battles") |

Build budget for the batch: about **3 builds**.

| build | used for |
|---|---|
| `development` | dev client, so hot reload has the new modules |
| `preview` | internal |
| `production` | TestFlight, via EAS Submit |

Leave buffer for one failed build. Everything after that (phases 3–5) is JS and goes OTA.

Things to check before that build so we don't need another:

* Push entitlement on both bundle ids (`.dev` and main).
* Associated domains on both bundle ids.
* The Sign in with Apple capability enabled in the Apple Developer portal for both.
* Confirm `runtimeVersion` (appVersion policy) moves to 1.2.0, so OTA updates for new
  native code never reach 1.1.0 installs.

### App Store / TestFlight requirements

* **Account deletion in-app** (Guideline 5.1.1(v)): Profile → Delete account →
  `delete-account` function.
* **Sign in with Apple** is our only login. Guideline 4.8 matters only if we add Google
  etc. later.
* **User-generated content** (usernames, battles with others; Guideline 1.2): report,
  block, and a way to act on reports (`set_flags`, `friendships.status = 'blocked'`).
* A privacy policy URL, plus updated App Privacy "nutrition label" answers (identifiers,
  usage data, fitness data linked to the account).
* **TestFlight**:
  * Internal testers (up to 100, App Store Connect users) get builds immediately.
  * External testers (up to 10,000) need Beta App Review for the first build of a version.
  * Builds expire after 90 days.

## 9. Phased plan

| phase | scope | ships as | exit criteria |
|---|---|---|---|
| **0. Design** | this PR: spec, schema draft, architecture | docs | Sunny approves the decisions / answers the open questions |
| **1. Backend foundation** ✅ (PR `feat/battles-phase-1`) | Staging + prod Supabase projects, `supabase/` migrations (applied to both, advisors fixed), DB tests in CI `checks`, `supabase-deploy.yml`, GitHub environments `staging`/`production`, EAS env vars, server-side `app_settings` | backend only | migrations apply cleanly in CI and on staging; RLS tests green |
| **2a. Native batch** ✅ (same PR) | All native deps from §8, `expo install --check` fixes, version 1.2.0, URL scheme, Sign in with Apple + push entitlements, React Navigation, Supabase client, optional sign-in prompt after solo sets | **3 builds** (dev, preview, TestFlight internal) once merged | dev build signs in with Apple against staging |
| **2b. Identity** ✅ (PR `feat/battles-phase-2b`) | Username picker, profile, solo set sync (upload queue + backfill), account deletion, push token registration, `notify` Edge Function (test push) | OTA | sets show in Supabase staging, a test push arrives |
| **3. Friends + async battles** ✅ (PR `feat/battles-phase-3`, JS only) | Friends, invite links + universal links (domain + AASA live), push notifications, async max-reps/timed, battles home/detail/invite/results (basic) | OTA | two testers complete an async battle end to end from a push |
| **4. Live battles** | Lobby, presence, synced countdown, rep broadcast, reconnect, checkpointing, waiting screen | OTA | 10 live battles on poor networks with no wrong results |
| **5. Polish & hardening** | Multi-day battles, all 4 metrics, comparison charts, stats/streaks, report/block, outlier flags, App Attest (needs a native change: fold into the next build that's needed anyway), external TestFlight | OTA (+ any native change batched) | Beta App Review passed |
| **6. App Store** | Privacy policy, screenshots, review | production build | live on the App Store |

Each phase lands on `dev` through normal PRs (`feat/*`), then a `dev` → `main` release PR,
per CONTRIBUTING.

### Phase 2b notes

* **Profile**: chosen right after the first sign-in (skippable with "Later"; the Account
  screen offers it again). Apple's name, which Apple only sends on the first sign-in, prefills
  the display name.
* **Devices**: a random per-install id (`installationId.v1` in AsyncStorage) →
  `register_device()`. Push tokens go through `register_push_token()`, which moves a token
  to the newest account that signed in on that phone. Sign-out deletes this phone's token.
* **Set backup**: every eligible local set (incl. ones from before sign-in) is uploaded with
  `submit_set()` (idempotent on the local id), oldest first, after sign-in, after each new
  set and when the app comes back to the foreground. Data errors (SQLSTATE 22/23) are
  skipped for good; network errors retry later. Clearing local history keeps the backup.
* **Account deletion**: `delete_my_account()` deletes the auth user; FKs cascade. Battles the
  user created and other people's results stay (the creator / inviter becomes null).
  Follow-up: Apple asks apps to also revoke the Sign in with Apple token on deletion; that
  needs an Apple key (client secret) in a server function (not done yet).
* **Push**: `notify` Edge Function. A Supabase secret key (`apikey` header) may notify any
  users (used by later phases); a signed-in user may only send a test push to themselves.
  Tokens Expo reports as `DeviceNotRegistered` are disabled. Push receipts are not checked
  yet. iOS delivery needs an APNs key in EAS credentials.

### Phase 3 notes

Shipped as JS + backend only: the iOS fingerprint is unchanged against the 1.2.0 build, so
it goes out as an OTA update. Live battles are phase 4.

* **Friends** (`friendships`, one row per pair): `send_friend_request(username)` (accepts
  instead if they already asked you; at most 50 open requests), `respond_friend_request`,
  `remove_friend` (also cancels a request you sent), `block_user` / `unblock_user` (a block
  also declines open invites between the two), `my_friends()`, `search_users(query)`
  (excludes people who blocked you). Friends see **only battle results** of each other
  (`friend_battle_record(user)`: W/D/L and your battles together); solo sets stay private.
* **Battles**: `create_battle(jsonb)` → `{battleId, inviteToken}` for async max-reps or
  timed (60/120 s) battles. Only accepted friends can be invited in-app; anyone with a link
  can join. Up to `async_max_participants` (8). Invitees accept / decline by updating their
  own `battle_participants.status` (RLS + `tg_participant_guard`). The creator can play
  first while the battle is pending, and everybody sees the posted scores before their own
  attempt. `my_battles(battle?)` returns the list / detail with live standings (locked
  results once completed). `cancel_battle` for the creator.
* **Invite links**: `create_invite_link`, `revoke_invite_link`, `invite_preview(token)`
  (works signed out, shows who invited you and the scores so far), `redeem_invite(token,
  add_friend)` (joins and, by default, befriends the creator). Tokens are 32 hex chars,
  expire with the invite (never after the deadline) and have `link_max_uses` (7).
  The app shares `pushupcounter://invite/<token>` today. Once `invite_links.web_base_url`
  is set in `app_settings`, it shares `https://<domain>/b/<token>` instead and already
  parses those links. Universal links still need the native batch (see below).
* **Settings** (`app_settings`, read by the app at start): `async_battle_defaults`
  (deadline 24 h with 6/24/72 h choices and a 168 h max, invite expiry 24 h, timed
  presets, 1 attempt, link uses, max-reps auto end: 15 s without a rep or 10 min) and
  `notifications` (reminders 2 h before the deadline and at half time).
* **Battle sets** go through the `submit-set` Edge Function (validates the payload, then
  `submit_set` as the service role). The app queues them on the phone first
  (`battleUploads.v1`), so an attempt recorded offline uploads when the app comes back
  (the server still accepts it up to 5 minutes after the deadline). Battle sets are
  not sent through the solo backup queue. Max-reps sets end by themselves after 15 s
  without a rep; timed sets stop at the time.
* **Which reps count** (bug report on staging set `4b9620bb…`: 12 Full + 3 Good showed
  `good_reps = 3`): the battle count was already right. `battle_entries` counts
  `quality >= 'good'` and plausible, which includes Full. The confusion was the name:
  `set_metrics.full_reps / good_reps / shallow_reps` are disjoint buckets, so
  `good_reps` means "Good but not Full". `set_metrics` now also has
  **`good_or_better_reps`** (Full + Good, plausible), which is exactly what a battle
  counts; that set counts 15. A DB test pins `battle valid_reps = full + good =
  good_or_better_reps`, with Shallow and implausible reps excluded.
* **Push**: table triggers write a `private.notification_outbox` row (invite, accepted /
  declined, opponent played, result, cancelled, reminder, friend request / accepted).
  The app calls `notify` with `{drain: true}` right after an action, and a `pg_cron` job
  (`notify-drain`, every minute, via `pg_net`) wakes it as a safety net. `notify` claims
  rows (`claim_notifications`, `for update skip locked`), builds the text from the facts
  (`_shared/notificationContent.ts`) and sends through Expo. Every push carries a `url`
  (`pushupcounter://battle/<id>` or `pushupcounter://friends`); taps route through React
  Navigation linking, also on cold start. The cron only knows the `notify` URL after
  `notify` has run once on that project (it registers itself with `register_notify_url`).
* **App**: Start → **Battles** (Your move / Waiting on others / Results), New battle,
  Battle detail (rules, standings, accept/decline, start attempt, share/turn off links,
  cancel), Friends (search, requests, block), Friend (record, challenge), Invite (deep-link
  target). Signing in is only needed for Battles; solo stays anonymous.
* **One-phone testing on staging**: `supabase/staging/test_bot.sql` adds `@pushup_bot`,
  which accepts friend requests and invites and plays its attempt within a minute;
  `select testing.bot_challenge('<username>', 'timed', 60)` makes it challenge you.
  Staging only; removal steps are in the file.
* **Native change still needed (batch it into the next build)**: universal links need
  `ios.associatedDomains: ["applinks:<domain>"]` in `app.config.ts` for both bundle ids
  (`com.jackroseman.pushupcounter` and `.dev`), plus the domain serving
  `/.well-known/apple-app-site-association` and a `/b/<token>` landing page. Then set
  `invite_links.web_base_url`. No app code change is needed for that.

## 10. Risks

* **Free-tier pausing** of staging slows testing. Possible answers: a keep-alive ping, or
  upgrading staging/prod when real users arrive.
* **Clock skew in live battles**: handled with server time and offsets. The worst case is a
  start out of sync by a few hundred ms. That's acceptable for friends, and results are
  computed from server-validated data anyway.
* **SQL and TS scoring diverging**: covered by the shared fixtures test (§2).
* **Build budget**: one botched native build costs 1/15 of the month. Run `npx expo-doctor`
  and a local `expo prebuild` dry-run before triggering builds.

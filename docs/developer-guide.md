# Developer guide

This is the starting point for working on Rep Royale. How to open a PR, run CI, set up
the dev client, and ship a release are in [CONTRIBUTING.md](../CONTRIBUTING.md) and
[RELEASING.md](RELEASING.md). This guide is the architecture and the conventions behind
those steps.

## The back end has the opinions; the front end implements the back end

That is the core rule.

The database decides what is true: who is winning, whose turn it is, how a list is
ordered, which call to action to show, what a status means, what a record is, which
sets fall inside a window, and whether someone is eligible. Those decisions live in
Postgres views and RPCs, protected by row-level security (and `security_invoker` so
RLS still applies when a view or function runs). The iPhone app fetches that result,
formats it for the screen, and lays it out. It does not re-derive a winner, a section,
or a "your turn" flag from raw rows.

In practice:

| Kind of decision | Lives in | The app does |
| --- | --- | --- |
| Outcomes (won, lost, draw, goal reached, missed, cancelled, expired, forfeited) | Views / RPCs | Show the status key and the copy that goes with it |
| Turn state ("your move", waiting, in progress, finished) | Views / RPCs | Render the section the server named |
| Sort order and grouping | Views / RPCs | Keep the order they arrived in |
| Call to action (accept, play, open, rematch) | Views / RPCs | Bind the named action to the screen |
| Status keys and eligibility | Views / RPCs / triggers | Trust the key; do not invent a parallel rule |
| Records (wins, ties, losses, head-to-head, league ranks) | Views / RPCs | Display the numbers |
| Time windows (start, end, "days left", what counts today) | Views / RPCs, using the server clock | Format the timestamps and labels the server provides |

Two things stay on the phone on purpose, and are not a violation of the rule:

* **Counting.** The phone is the measuring instrument. Depth, calibration, and per-rep
  quality run in `modules/pushup-sensors` and `src/core`. The server stores the raw
  measurements and recomputes scores in SQL so both sides agree.
* **Formatting and layout.** Names, dates, typography, and navigation belong in the
  app. `friendlyError` in `src/battles/model.ts` is a mapping from a server error
  string to user-facing copy, not a new rule.

If a screen would look different depending on a rule you are about to write in
TypeScript, that rule belongs in a migration first.

### Checklist for a new feature

1. **Design the screens and the product rules first** (see [Conventions](#conventions)).
   Write down the opinions: outcome, turn, sort, CTA, window, eligibility.
2. **Put those opinions in Postgres.** Add a new migration with
   `npx supabase migration new <name>` (`supabase/migrations/<UTC timestamp>_<name>.sql`).
   Never edit a migration that has already been merged.
3. **Prefer a `security_invoker` view or RPC** so RLS on the underlying tables still
   applies. Use `SECURITY DEFINER` only when RLS would recurse, or when an
   unauthenticated preview must run (for example `invite_preview` and
   `friend_invite_preview`), and keep those functions tightly scoped.
4. **Grant `execute` on purpose.** Authenticated users get the RPCs the app calls.
   Service-role-only functions (`finalize_challenges`, `lease_notifications`, and the
   rest of the notify outbox) are not granted to `authenticated` or `anon`.
   `invite_preview` / `friend_invite_preview` are the ones granted to `anon`.
5. **Add database tests** to `supabase/tests/cases.mjs` and run `npm run test:db`.
   Cover the rule, the RLS case (a user cannot see or change someone else's row), and
   the invalid transition. Migrations that end in `_cron.sql` need `pg_cron` and are
   skipped by the in-process tests; keep them thin wrappers around functions that the
   other tests already cover.
6. **Keep the migration backwards compatible** with the app version already installed:
   add columns and functions first, remove them in a later release. Database changes
   and app changes ship through different pipelines (see [Release flow](#branches-and-release-flow)).
7. **In the app, fetch, format, and lay out.** Add a thin RPC wrapper if needed
   (`src/battles/api.ts`, `src/invites/api.ts`, `src/backend/*Client.ts`). Put display
   helpers in Jest-tested modules. Do not re-implement the opinion in TypeScript.
8. **Keep UI copy plain and generic**, so a later rule change does not break the
   sentence (see [Conventions](#conventions)).
9. **Run `npm run ci`**, and in the PR say whether the change is OTA-safe or needs a
   native build. Do not leave dev or test scaffolding in the shipped tree.

Tunable defaults (form-score weights, challenge lengths, friend visibility, the
sign-in prompt, invite-link limits) already live in `public.app_settings`, not in
hard-coded app values. The app reads them at launch and falls back to
`src/backend/appSettings.ts` only when it is offline.

## Architecture

```
iPhone app (Expo SDK 58, React Native 0.88)          Supabase (staging / production)
┌─────────────────────────────────────────┐         ┌──────────────────────────────────┐
│ Counting: ARKit module + src/core       │  JWT    │ Auth: Sign in with Apple         │
│ UI: Today / Compete / You               │────────▶│ Postgres: tables, RLS,           │
│ supabase-js: RPCs, auth, sync           │ PostgREST│   security_invoker views, RPCs  │
│ Local history (AsyncStorage)            │         │ Edge Functions: submit-set,      │
└─────────────────────────────────────────┘         │   notify                         │
         │                                           │ pg_cron: finalize, notify drain  │
         │  universal links                          └──────────────────────────────────┘
         ▼
  web/ on Vercel (https://reproyale.vercel.app)
  invite page /i/<code> and apple-app-site-association
```

### The app

The store name is **Rep Royale: Push-up Battles**; the home-screen name is **Rep Royale**.
The slug, URL scheme (`pushupcounter://`), and bundle ids keep the older Pushup Counter
name on purpose.

* `App.tsx` — providers and the root navigator.
* `src/ui/` — design system (tokens in `src/ui/tokens.ts`).
* `src/navigation/` — Today, Compete, and You tabs, stack routes, and linking
  (`pushupcounter://` and universal links).
* `src/screens/` — the screens themselves, including `screens/compete/` and the set flow.
* `src/session/` and `src/core/` — running a set, and the pure TypeScript detector,
  calibration, guidance, tilt, and analysis.
* `src/progress/` — goals, Today and You models, formatters, nudges.
* `src/battles/` — challenge and friend models, the thin RPC wrappers in `api.ts`,
  New challenge, and the set upload queue.
* `src/backend/` — the Supabase client, Sign in with Apple, identity, sync, and
  device / push-token registration. Without `EXPO_PUBLIC_SUPABASE_URL` and
  `EXPO_PUBLIC_SUPABASE_ANON_KEY` the client is `null` and the app runs offline,
  solo, with sign-in hidden. Those values are the publishable anon key and are
  public by design; RLS protects the data. Never put a service-role or secret key
  in an `EXPO_PUBLIC_` variable or in the app.
* `src/invites/` — personal friend invite links.
* `src/notifications/` — the in-app notification opt-in prompt and banner.
* `src/storage/` — AsyncStorage history and settings.
* `modules/pushup-sensors/` — the local Expo Module (Swift / Kotlin). Expo Go does
  not work; use the Pushup Dev development build.

### Supabase

There is one hosted project per environment:

| Git branch | GitHub environment | Supabase project         | EAS environment |
| ---------- | ------------------ | ------------------------ | --------------- |
| `dev`      | `staging`          | `pushup-battles-staging` | `development`   |
| `main`     | `production`       | `pushup-battles-prod`    | `production`    |

The live schema is `supabase/migrations/`, applied in timestamp order. Older notes in
[docs/battles/](battles/) still use the "battles" name; the product and the current
tables say "challenges". Some tables were renamed in place (`battles` → `challenges`,
`battle_participants` → `challenge_participants`, and so on), so you will see both
names in the migration history.

**Tables** (public): `profiles`, `devices`, `push_tokens`, `friendships`,
`friend_invite_links`, `challenges`, `challenge_participants`,
`challenge_invite_links`, `challenge_results`, `detector_configs`, `sets`, `reps`,
`set_traces`, `set_flags`, `deleted_sets`, `programs`, `program_segments`,
`goal_enrollments`, `notification_prefs`, `app_settings`. Private tables include
`notification_outbox` (queued pushes; not exposed to clients), `server_config`,
and `friend_invite_redemptions`.

Row-level security is on for every table. Clients read and write only through
policies and RPCs, with a few direct table reads under RLS (`app_settings` at
launch, `notification_prefs` for reminder settings). Challenge results are frozen
into `challenge_results` when a challenge completes, so a later view change
cannot rewrite an old winner.

**Views** (all created `with (security_invoker = true)`):

* Metrics: `rep_metrics` → `set_metrics`.
* Challenges: `challenge_entries` → `challenge_standings_live` → `challenge_standings`
  (locked rows for completed challenges, live rows otherwise).
* Progress: `daily_totals`, `weekly_totals`, `monthly_totals`, `goal_for_date`,
  `user_stats`.

The app almost never selects a view directly. Screens call RPCs, and those RPCs read
the views (for example `my_challenges` builds each participant's score from
`private.challenge_rows`, which sits on the standings views).

**RPCs the app calls** (see `src/battles/api.ts`, `src/invites/api.ts`, and
`src/backend/`):

* Challenges: `my_challenges`, `create_challenge`, `cancel_challenge`,
  `create_invite_link`, `revoke_invite_link`, `invite_preview`, `redeem_invite`,
  `friend_challenge_record`. Accept / decline is a direct update of the caller's
  `challenge_participants` row (`invited` → `accepted` or `declined`), which a
  trigger validates.
* Friends: `my_friends`, `search_users`, `send_friend_request`,
  `respond_friend_request`, `remove_friend`, `block_user`, `unblock_user`,
  `my_friend_invite`, `reset_friend_invite`, `friend_invite_preview`,
  `redeem_friend_invite`.
* Progress and league: `my_progress`, `my_league`, `enroll_goal`.
* Identity: `username_available`, `register_device`, `register_push_token`,
  `delete_my_account`, `delete_set`, `submit_set` (solo sets only).

`my_challenges` returns the caller's open challenges plus those finished in the last
30 days (or one challenge, if `p_battle` is set), including participants, ranks,
winners, and, for the creator, active invite links. Scores and ranks come from the
standings views, not from a number the client computes.

**Accepting, declining, and leaving.** The schema allows a participant to update only
their own row (`participants_self_update`). Valid transitions are `invited` →
`accepted` or `declined`, and `accepted` → `forfeited` (which sets `left_at`). There
is no dedicated leave RPC today, and the app does not yet expose a leave or forfeit
action.

**Edge Functions** (`supabase/functions/`, deployed with `--no-verify-jwt`; each
function authorizes the request itself):

* `submit-set` — the only way a best-set challenge attempt is written. Validates the
  payload, calls `submit_set` as the service role with the verified user id, then
  runs `finalize_challenges` and wakes `notify`. Solo sets use the `submit_set` RPC
  directly under RLS.
* `notify` — drains the notification outbox and sends Expo pushes. Title and body
  are built at send time from live facts. Shared code lives in
  `supabase/functions/_shared/` (`expoPush.ts`, `pushSender.ts`,
  `notificationContent.ts`, `setValidation.ts`).

**Cron** (`supabase/migrations/*_cron.sql`): `finalize_challenges()` every minute,
and a safety-net drain of `notify` if the outbox is not emptied sooner.

### web/ on Vercel

`web/` is its own package. It is not part of the app bundle or the EAS fingerprint,
and CI's `should-ship` job ignores it, so a web-only merge does not publish an OTA
or start a build.

It serves `https://reproyale.vercel.app`: the friend invite page at `/i/<code>`
(server-rendered by `web/api/invite.js`, which calls `friend_invite_preview` as
`anon`), `/.well-known/apple-app-site-association` for universal links, and a small
home page. The Vercel project's Root Directory is `web`. Pull requests get preview
deployments; `main` deploys to production. Details, commands, and environment
variable *names* are in [web/README.md](../web/README.md).

## Branches and release flow

```
feat/* / fix/* / chore/* / docs/*   →   PR into dev   →   release PR dev → main
        (CI only)                     (Pushup Dev)         (TestFlight / production)
```

* **Features and fixes** branch from `dev` and open a PR **into `dev`**. Squash-merge
  once `checks` is green.
* **Releases** use `scripts/release.sh`, which opens (or refreshes) a PR **`dev` →
  `main`** and never merges it. Wait for `checks`, then merge with a **merge
  commit**, not squash, so `dev` and `main` keep a shared history.
* **Hotfixes** branch from `main`, PR into `main`, then merge `main` back into `dev`.
* Never force-push `main` or `dev`, and do not commit directly to them.

The full branch, commit, and PR rules are in [CONTRIBUTING.md](../CONTRIBUTING.md).
The exact ship recipe is in [RELEASING.md](RELEASING.md).

### CI: `checks`, `should-ship`, `ship`

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every commit to a
PR into `dev` or `main`, and on every push to `dev` or `main`. Work branches are
checked through their PR only.

| Job | What it does | Required to merge? |
| --- | --- | --- |
| `checks` | `npm ci`, `expo lint` (0 errors, `--max-warnings 16`; the cap only goes down), `jest --ci`, `npm run test:db`, `node --test scripts/tests/eas-ship-cases.mjs`, `tsc --noEmit`, `npm --prefix web run check`, `expo export --platform ios` | **Yes.** Do not rename this job without updating branch protection. |
| `expo-doctor (advisory)` | `npx expo-doctor` | No |
| `should-ship` | On a push to `dev` or `main` only: whether the commit changed app code. Ignores markdown, `docs/`, `__tests__/`, `supabase/`, `.github/`, `tools/`, and `web/`. | No |
| `ship` | Starts `eas-ship.yml` for that exact SHA, only if `checks` passed and `should-ship` said yes | No |

A docs-only or tests-only merge, or a merge whose `checks` job failed, does not start
a ship and does not cancel one that is already running. A started ship skips if its
commit is no longer the branch tip, so a superseded run cannot publish stale code.

### OTA update vs a native build

`scripts/eas-ship.sh` fingerprints the project with `eas fingerprint:generate` (the
same hash EAS builds record):

* **A build of that profile already has this fingerprint** (finished, queued, or
  building, any age): a JS-only change. Publish an OTA update to the branch's
  channel (`development` → Pushup Dev, `production` → TestFlight). Phones check on
  launch, download in the background, and apply the update on the next launch.
* **No build has this fingerprint:** a native change. On `development`, start
  `.eas/workflows/build-dev.yml`. On `production`, the app `version` in `app.json`
  and `package.json` must have been bumped; otherwise the job fails and publishes
  nothing. A new version starts `.eas/workflows/build-production.yml` (store build
  plus upload to TestFlight). The same run then publishes an OTA of this commit for
  the new runtime, so the new build's Updates tab is never empty.

Runtime version (`app.config.ts`): the store app uses `appVersion` (`expo.version`).
The dev client uses `fingerprint`, so a native change on `dev` gets a new Pushup Dev
build without a version bump, and an old dev build never receives an update it cannot
run.

**OTA-safe:** anything in `src/`, `App.tsx`, images and assets, detector tuning, copy.
**Needs a native build:** `modules/`, adding or upgrading a package with native code,
an Expo SDK upgrade, or native config in `app.json` / `app.config.ts` (permissions,
plugins, bundle id, icons, splash).

### Conserve EAS builds

EAS builds are limited (see [RELEASING.md](RELEASING.md) for the current budget).
Builds happen only for a native change or a manual run: at most one dev build and
one store build per native change. JS-only work must leave the native fingerprint
unchanged and ship as an OTA. Do not start `build-dev.yml` or
`build-production.yml` by hand unless you need a new binary (for example the dev
client expired after 14 days, or you are retrying an upload with
`eas submit -p ios --id <build id>` — that retry does not use a new build).

The EAS workflows in `.eas/workflows/` have no push trigger. They only run when
`eas-ship.sh` starts them or when someone runs them by hand.

### Migrations and Edge Function deploys

[`.github/workflows/supabase-deploy.yml`](../.github/workflows/supabase-deploy.yml)
is a separate workflow. It runs only on a **push** to `dev` (staging) or `main`
(production) when `supabase/migrations/` or `supabase/functions/` changed, never on
pull requests. It applies pending migrations (`supabase db push`) and then deploys
every Edge Function (`supabase functions deploy --no-verify-jwt --use-api --yes`).
Folders that start with `_` are shared code, not functions. After a deploy it wakes
`notify` once so the function can register its URL with the database.

### Syncing production data into staging

Dev builds talk to staging, which is nearly empty. To test on real-shaped data, copy
production into it. Run **Actions → Sync staging from production**
([`sync-staging.yml`](../.github/workflows/sync-staging.yml)), which is manual only. It is
free and takes about a minute. Leave `dry_run` on to read production and print row counts;
turn it off to write. It only runs from `dev` or `main`.

* **Mechanism:** [`supabase/staging/sync-from-prod.mjs`](../supabase/staging/sync-from-prod.mjs)
  uses the Supabase Management API and the existing `SUPABASE_ACCESS_TOKEN`, with no
  database password. Production is read through the read-only query endpoint. Staging is
  emptied and refilled in **one transaction**, so a failure leaves it as it was. Project
  refs: staging is `SUPABASE_PROJECT_REF` in the `staging` environment, production is the
  repo variable `PROD_PROJECT_REF`. The script refuses to run if they are the same or the
  target's name does not contain "staging".
* **Copied:** profiles, devices, friendships, invite links, challenges, participants,
  results, sets, reps, traces, goal enrollments, programs, detector configs, and the auth
  users and identities.
* **Never copied:** `push_tokens` (staging must never push to a real phone), the
  notification outbox, `private.server_config` (the staging notify URL), `app_settings`
  (staging owns its tuning), auth sessions and tokens. The test bot
  (`supabase/staging/test_bot.sql`) is kept.
* **Scrubbed:** every user except `@jack` loses email, phone and metadata and gets a made-up
  Apple subject, so only `@jack` can sign in (with Apple, on a dev build). Usernames and
  display names are kept. After a sync you sign in again, because sessions are not copied.
* **Migration safe:** the columns to insert come from staging's catalog, limited to the keys
  present in production's rows. A column only staging has takes its default; a column only
  production has is ignored; a table only staging has is left alone. A new `NOT NULL`
  column without a default fails the load and rolls it back, as it would on production's
  real rows. Migrations are not replayed, so a backfill inside a new dev migration does not
  touch copied rows. To rehearse a release, sync first, then apply the pending migrations.
* **Public repo:** the log shows row counts only. Never add output of row values, SQL or an
  API response body, and never upload the data as an artifact.

## Local development and testing

Requirements, the Pushup Dev client, Metro / tunnel, and environment variable
*names* are in the [README](../README.md#2-local-development-pushup-dev) and in
[CONTRIBUTING.md](../CONTRIBUTING.md#7-local-development-dev-client--hot-reload).
In short: Node 22, a Face ID iPhone on iOS 26, the Pushup Dev build (Expo Go will
not work), then `npm install` and `npm run dev` or `npm run dev:tunnel`.

```bash
npm test             # Jest (jest-expo). Covers detection, analysis, progress models,
                     # challenges, the league, friends, linking, and set-flow helpers.
npm run test:db      # supabase/migrations + RLS tests on in-process Postgres (PGlite)
npm run lint         # expo lint
npm run typecheck    # tsc --noEmit
npm run ci           # lint && jest --ci && test:db && tsc --noEmit
npm run doctor       # expo-doctor (advisory in CI)
```

`npm run ci` is the same core as the `checks` job, minus the ship-script tests, the
web invite-page check, and the `expo export` bundle smoke test, which CI also runs.
Before you push, `npm run ci` should be green. Database work also needs new or
updated steps in `supabase/tests/cases.mjs`.

To look at UI without a phone, see "Rendering screens" below.

### Rendering screens

You can see the real app on any computer, with no phone, simulator or Mac. The web preview in
`tools/preview/` builds the app's own screens for the browser and screenshots them in an
iPhone-sized window (402 × 874 points), using canned data in place of Supabase. Use it before
designing a change to an existing screen, so the "before" is the app and not a drawing of it, and
when a PR touches UI.

```bash
npm ci
npm --prefix tools/preview run setup     # once
npm --prefix tools/preview run screens   # Today, Compete, You, empty states, and the challenges flow
npm --prefix tools/preview run capture -- challenges-tour   # same tour, with an .mp4 recording
```

Screenshots go to `tools/preview/out/captures/<flow>/` (git-ignored). The dedicated challenges
flow (`tools/preview/flows/challenges.js`) walks Your turn on Today and Compete, an invite,
Waiting, challenge detail, New challenge for each type and length, You > Challenges with the
period picker, a friend's head-to-head record, a finished result, and the empty states
(`challenges-empty`, `challenges-none`, `challenges-busy`). Record the tour with
`capture -- challenges-tour` (omit `--no-video`); the `.mp4` lands next to the screenshots.
Other flows (a full set with simulated push-ups, onboarding, invite links) are covered in
[docs/ui-preview.md](ui-preview.md), which is also the place for fixtures and adding your own.

Things to know:

* **The data is a fixture.** The shapes mirror the RPCs the app calls (`my_challenges`,
  `my_league`, `friend_challenge_record` and so on). When a back end change alters a shape, update
  `tools/preview/mock/fixtures.js`, or that screen renders empty. A flow can override one RPC to
  show a state the defaults don't, such as many challenges waiting on you.
* **It is not an iPhone.** The web has no status bar or home indicator, uses a flat tab bar
  instead of the native iOS 26 one, SVG icons instead of SF Symbols, and Inter instead of the
  system font. Sensors, haptics, native sheets and performance still need a check on a phone.
* **It never reaches a real back end.** Every request goes to the fixture, and the build refuses
  to start without its stand-ins. Nothing from `tools/preview/` is in the app bundle, and a unit
  test fails if app code imports it. Do not add a preview script to the root `package.json`: it
  would change the native fingerprint.
* **Mockups start from it.** Take the real screenshot, then draw only what changes, label it
  MOCKUP, and keep it in the app's style (the style guide Page).

## Conventions

**Plain, generic UI copy.** Write copy that still makes sense if the rule behind it
changes. Prefer "Challenge update" and "{name} is on {n} reps this week" over a
sentence that names a specific trigger such as "took the lead." The notification
spec calls this out explicitly in
[docs/notification-experience.md](notification-experience.md); use the same
standard for on-screen copy. Do not mention implementation details, formulas, or
internal names ("RPC", "fingerprint", "battle_id") in the UI.

**No dev or test leftovers in shipped code.** Do not leave debug switches, DEV-only
diagnostics, unused feature flags, temporary fixtures, or commented-out experiments
in `src/`, `supabase/`, or anything else that ships. Preview and capture tooling
belongs under `tools/`, which is not part of the app fingerprint. A missing
`accessibilityLabel` in the app is a real fix, not test scaffolding.

**Design first for new features.** Agree the screens and the empty states before
writing product code. Existing sources of truth are the rebrand frames and empty
states in [docs/rebrand/](rebrand/), the notification specification, and (for work
in progress) the design Pages those docs point at. Implementation then follows the
checklist above: opinions in the database, the app implements what the database
returns.

**Commits.** Conventional Commits (`feat`, `fix`, `docs`, …), as in
[CONTRIBUTING.md](../CONTRIBUTING.md#2-commits). The merge-commit subject on
`dev` / `main` becomes the EAS Update message, so keep it readable.

**Secrets.** Never commit tokens, database passwords, Apple credentials, or `.env`
files. Secret *names* and where they live are listed in
[CONTRIBUTING.md](../CONTRIBUTING.md#10-secrets). This guide does not repeat values
or identifiers.

## Where to read more

* [CONTRIBUTING.md](../CONTRIBUTING.md) — branches, PRs, CI, the dev client, rollbacks,
  secrets.
* [docs/RELEASING.md](RELEASING.md) — what happens after a merge, OTA vs a native
  build, the `dev` → `main` recipe, the build budget, by-hand commands.
* [docs/notification-experience.md](notification-experience.md) — the living contract
  for every push (trigger, recipient, copy, destination, throttling) and the in-app
  opt-in flow.
* [docs/battles/ARCHITECTURE.md](battles/ARCHITECTURE.md) and
  [docs/battles/SPEC.md](battles/SPEC.md) — earlier protocol and architecture notes.
  They still say "battles"; the live schema is `supabase/migrations/`.
* [docs/rebrand/](rebrand/) — design system, 30 flow frames, 15 empty states, and the
  implementation plan.
* [docs/ui-preview.md](ui-preview.md) — web preview and UI capture for PRs.
* [web/README.md](../web/README.md) — the invite page and apple-app-site-association
  on Vercel.
* [README.md](../README.md) — what the app does, how counting works, and local setup.

## Known tech debt: opinions that still live in the app

These helpers implement product rules in TypeScript that should move into views or
RPCs, so the app can just display what the database returns. Tracked here so new
work does not add to them.

Resolved in the open-challenge work (`my_open_challenges`, `challenge_record_periods`,
`my_challenge_record`, and the upgraded `friend_challenge_record` / `my_challenges`):

* Challenge list sections, sort order, `can_do_push_ups`, and call to action — the
  app lays out `my_open_challenges` (`YourTurnList` on Today and Compete). Today's
  leftover "your move" card is gone; without action rows, only "Challenge a friend"
  remains when the person has friends.
* Period picker options and ranges come from `challenge_record_periods`. The app
  passes the chosen `from` / `to` into the record RPCs. W-T-L, forfeits as a
  footnote, and declined invites omitted are computed in the record RPCs.
  `friend_challenge_record` also returns `bestSet`.
* Result wording, whether to crown a winner, whose score to showcase, and whether
  the detail is a head-to-head card, standings, or a team goal come from
  `my_challenges` (`resultTitle`, `resultCrowned`, `resultShowcaseUserId`,
  `detailLayout`, `needsResponse`, `myOutcome`, `myOutcomeLabel`).
* New most-reps and team challenges use `durationDays` (1 / 7 / 14 / 30) starting
  at the creator's local midnight, so the "Today" / "This week" / "This month"
  labels are gone from the New challenge sheet.

Still open:

* **Rematch defaults.** `rematchParams` maps a stored `durationDays` or leftover
  calendar window onto the create form. A rematch RPC should return the
  `create_challenge` payload directly.

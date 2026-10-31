# Contributing to Pushup Counter

This guide covers how code gets from your editor to a phone: branches, commits, pull
requests, CI checks, deploys (CD) and rollbacks. Read it before your first PR.

## TL;DR

```bash
git switch dev && git pull
git switch -c feat/short-description        # branch off dev
npm run dev:tunnel                          # or scripts/dev-server.sh: hot reload on the phone
# ...code; commit small, conventional commits...
npm run ci                                  # jest + db tests + tsc, the same checks CI runs
git push -u origin feat/short-description
gh pr create --base dev --fill              # PR into dev; CI must be green to merge
```

## 1. Branch model

| branch      | what it is                                   | deploys to (EAS)                                   |
|-------------|----------------------------------------------|----------------------------------------------------|
| `main`      | Released code. Protected: changes only by PR. | **preview** channel / `preview` builds ("Pushup Counter") |
| `dev`       | Integration branch for the next release.      | **development** channel / dev client builds ("Pushup Dev") |
| `feat/*`, `fix/*`, `chore/*`, `docs/*` | Short-lived work branches, cut from `dev`. | nothing (CI only) |
| `hotfix/*`  | Urgent fix to released code, cut from `main`. | nothing until merged |

Flow:

* **Features and fixes:** branch from `dev` and open a PR **into `dev`**.
* **Releases:** open a PR **`dev` → `main`** (title e.g. `Release 1.2.0`). Merging it
  ships to the preview app.
* **Hotfixes:** branch `hotfix/...` from `main` and PR into `main`. After it merges, merge
  `main` back into `dev` (PR `main` → `dev`) so `dev` doesn't regress.
* Never force-push `main` or `dev`, and don't commit directly to them.

Branch names: `<type>/<short-kebab-description>`, e.g. `feat/rep-tempo-chart`,
`fix/calibration-left-right`, `chore/bump-expo-58`.

## 2. Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add per-rep tempo chart
fix(calibration): invert left/right hint on iPhone 16
chore(deps): bump expo to 58.0.x
docs: explain OTA vs native builds
```

* Types: `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `chore`, `ci`, `build`.
* Keep each commit focused, and keep the tests passing in each commit.
* The commit message of the merge to `main`/`dev` becomes the **EAS Update message**, so
  make it readable.

## 3. Pull requests

* Keep PRs small. One topic per PR.
* Fill in: **what** changed, **why**, **how you tested it** (device + build), and whether
  it is **OTA-safe or needs a native build** (see section 6).
* Required to merge into `main`: a green **`checks`** CI job, and the branch must be up to
  date with `main`. Approvals aren't required, because there is a single maintainer and
  GitHub doesn't let you approve your own PR. Add a required approval once there is a
  second reviewer.
* Merge with **squash** for feature PRs (one clean commit on `dev`). Use a **merge
  commit** for `dev` → `main` release PRs, so `dev` and `main` keep a shared history.

## 4. CI (GitHub Actions, `.github/workflows/ci.yml`)

Runs on every commit pushed to a PR into `main` or `dev`, and on pushes to `dev` and work
branches:

| job                        | what it does                                              | required |
|----------------------------|-----------------------------------------------------------|----------|
| `checks`                   | `npm ci`, `jest --ci`, `npm run test:db` (migrations + RLS tests on PGlite), `tsc --noEmit`, `expo export --platform ios` (bundle smoke test) | **yes**: PRs that fail are blocked |
| `expo-doctor (advisory)`   | `npx expo-doctor` (dependency/config health)              | no (network-dependent) |

Run the same checks locally before pushing:

```bash
npm run ci           # jest --ci && npm run test:db && tsc --noEmit
npm run test:db      # only the database tests (supabase/tests, in-process Postgres)
npm run doctor       # expo-doctor
```

Don't rename the `checks` job without updating branch protection.

## 5. CD (EAS Workflows, `.eas/workflows/`)

Deploys run **only after a merge** (a push to `dev` or `main`), never on PR events.

| file              | trigger        | target                                                  |
|-------------------|----------------|---------------------------------------------------------|
| `deploy-dev.yml`  | push to `dev`  | profile `development`, channel `development`, EAS env `development` |
| `deploy.yml`      | push to `main` | profile `preview`, channel `preview`, EAS env `preview`  |

Each workflow: tests → **fingerprint** (a hash of everything native) → is there already a
build of that profile with this fingerprint?

* **Yes (JS/asset-only change)** → publish an **OTA update** to the channel.
* **No (native change)** → start a **new build**. Install it from the build page in
  the Expo dashboard.

Watch runs at expo.dev → project → Workflows, or with `eas workflow:runs`.
Validate a workflow before pushing: `eas workflow:validate .eas/workflows/deploy-dev.yml`.

### Backend (Supabase)

| branch | GitHub environment | Supabase project | EAS environments using it |
|--------|--------------------|------------------|---------------------------|
| `dev`  | `staging`          | `pushup-battles-staging` | `development` |
| `main` | `production`       | `pushup-battles-prod`    | `preview`, `production` |

* Schema changes are **migrations** in `supabase/migrations/` (`<UTC timestamp>_<name>.sql`).
  Never edit a migration that has been merged; add a new one. Create one with
  `npx supabase migration new <name>`.
* Test them: add steps to `supabase/tests/cases.mjs` and run `npm run test:db`. Migrations
  ending in `_cron.sql` need pg_cron and are skipped by the tests.
* `.github/workflows/supabase-deploy.yml` runs `supabase db push` **only on a push to `dev`
  (staging) or `main` (prod)** when `supabase/migrations/` changes, never on PRs. The
  `production` environment only accepts `main`, and `staging` only `dev`.
* Tunable defaults (form-score weights, battle sizes, friend visibility, the sign-in
  prompt, invite links) live in the `public.app_settings` table, not in code. Change them
  with a migration (or SQL on the dashboard for a quick experiment); the app reads them at
  launch and falls back to `src/backend/appSettings.ts` defaults offline.
* Database changes and app changes ship separately. Keep migrations backwards compatible
  with the app version that is already installed (add columns/functions first, remove
  them in a later release).

## 6. OTA update vs full build, and bumping `version`

* **OTA-safe:** anything in `src/`, `App.tsx`, images/assets, detector tuning, copy.
* **Needs a native build:** `modules/` (Swift/Kotlin), adding/upgrading a package with
  native code, Expo SDK upgrades, native config in `app.json`/`app.config.ts`
  (permissions, plugins, bundle id, icons/splash), or `package.json` changes that alter the
  fingerprint.
* `runtimeVersion` follows the app `version` (`policy: appVersion`). **If your PR makes a
  native change, bump `version` in `app.json` in the same PR** (e.g. 1.1.0 → 1.2.0).
  Otherwise OTA updates built for the new native code would also be served to old
  installs that don't have it, and could crash them.
* Mention "needs native build" in the PR description so the release PR shows it too.

## 7. Local development: dev client + hot reload

This app has a custom native module, so **Expo Go doesn't work**. Use the **Pushup Dev**
dev client (bundle id `com.jackroseman.pushupcounter.dev`). It installs next to the
preview app.

1. **Install the dev client once** (and again after each native change). Get the latest
   `development` build from expo.dev → project → Builds and open its page on your iPhone.
   To make one yourself: `eas build -p ios --profile development`. New iPhones must be
   registered first with `eas device:create`, and iOS needs
   **Settings → Privacy & Security → Developer Mode** turned on.
2. **Start Metro** (JS bundler with Fast Refresh):
   * Same Wi-Fi as the phone: `npm run dev` (= `expo start --dev-client`).
   * Anywhere (remote box, different network): `npm run dev:tunnel`, or the background
     helper:

     ```bash
     scripts/dev-server.sh          # (re)start Metro + tunnel in the background, print the URL
     scripts/dev-server.sh url      # print the current URL / deep link again
     scripts/dev-server.sh stop
     ```

     Logs are in `.expo/dev-server.log`. **The tunnel URL changes every time Metro
     restarts**, so re-run `scripts/dev-server.sh url` after a restart.
3. **Connect:** open Pushup Dev, then either tap the server in the list, use
   **Enter URL manually** with the printed `https://…on.expo.app` URL, or open the printed
   `exp+push-up-counter://expo-development-client/?url=…` deep link on the phone (e.g. paste
   it in Safari, or scan the QR code in the terminal).
4. **Edit and save:** JS/TS changes appear on the phone in about a second (Fast Refresh, state
   is kept). Shake the phone or three-finger long-press for the dev menu (reload, perf
   monitor, JS debugger). Native changes need a new dev client build (step 1).

`APP_VARIANT=development` (set by the `development` build profile and EAS environment)
switches the name/bundle id in `app.config.ts`. Without it you get the normal
"Pushup Counter" config.

## 8. Releasing (`dev` → `main`)

1. Make sure `dev` is green and its dev-client OTA/build works on a device.
2. If any native change went in since the last release, check that `version` was bumped.
3. `gh pr create --base main --head dev --title "Release x.y.z" --body "<changelog>"`.
4. Wait for CI `checks` to pass, then merge (merge commit).
5. The `Deploy preview` workflow runs. It publishes an OTA to `preview`, or starts a
   new preview build if anything native changed. For a build, install it from the build page.
6. Optional: tag the release, `git tag vX.Y.Z origin/main && git push origin vX.Y.Z`.

## 9. Rolling back

* **Bad OTA update:** republish the last good update to the channel:

  ```bash
  eas update:list --branch preview                    # find the last good update group
  eas update:republish --group <good-group-id>        # make it the newest update again
  # or
  eas update:rollback                                  # interactive; can also roll back to the embedded build
  ```

  Phones pick it up on the next launch (apply on the launch after that).
* **Bad code on `main`/`dev`:** open a revert PR (`git revert <sha>`). Don't force-push.
  Merging the revert runs the normal CD.
* **Bad native build:** reinstall the previous build from expo.dev → Builds, then revert the
  change. Bump `version` again when the fixed native build ships.

## 10. Secrets

Never commit tokens, database passwords, Apple passwords or `.env` files. EAS credentials
live on EAS.

* **CI (`ci.yml`) needs no secrets** and PR runs never get any.
* **`supabase-deploy.yml`** uses GitHub secrets:
  * `SUPABASE_ACCESS_TOKEN` (repository secret): a personal access token from
    supabase.com/dashboard/account/tokens. Without it the deploy job is skipped with a warning.
  * `SUPABASE_PROJECT_REF` (environment secret on `staging` and `production`).
  * `SUPABASE_DB_PASSWORD` (optional environment secret). Without it the CLI logs in
    with a short-lived role created from the access token.
* **EAS environment variables** (`eas env:list --environment <env>`) hold build-time config:
  `APP_VARIANT`, `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`. The
  `EXPO_PUBLIC_*` values are compiled into the app and are public by design (the Supabase
  *publishable* key; row-level security protects the data). Never put the service-role /
  secret key in an `EXPO_PUBLIC_` variable or in the app.
* Without the Supabase variables (e.g. a plain local `npx expo start`), the app runs in
  offline solo mode and hides sign-in.

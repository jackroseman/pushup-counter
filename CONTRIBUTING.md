# Contributing to Rep Royale (formerly Pushup Counter)

This guide covers how code gets from your editor to a phone: branches, commits, pull
requests, CI checks, deploys (CD) and rollbacks. Read it before your first PR.

## TL;DR

```bash
git switch dev && git pull
git switch -c feat/short-description        # branch off dev
npm run dev:tunnel                          # or scripts/dev-server.sh: hot reload on the phone
# ...code; commit small, conventional commits...
npm run ci                                  # lint + jest + db tests + tsc, the same checks CI runs
git push -u origin feat/short-description
gh pr create --base dev --fill              # PR into dev; CI must be green to merge
```

## 1. Branch model

| branch      | what it is                                   | deploys to (EAS)                                   |
|-------------|----------------------------------------------|----------------------------------------------------|
| `main`      | Released code. Protected: changes only by PR. | **production** channel / store builds on TestFlight ("Rep Royale") |
| `dev`       | Integration branch for the next release.      | **development** channel / dev client builds ("Pushup Dev") |
| `feat/*`, `fix/*`, `chore/*`, `docs/*` | Short-lived work branches, cut from `dev`. | nothing (CI only) |
| `hotfix/*`  | Urgent fix to released code, cut from `main`. | nothing until merged |

Flow:

* **Features and fixes:** branch from `dev` and open a PR **into `dev`**.
* **Releases:** run `scripts/release.sh` (PR **`dev` → `main`**, see
  [docs/RELEASING.md](docs/RELEASING.md)). Merging it ships to TestFlight (OTA, or one store
  build if the version was bumped for a native change).
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

Runs on every commit pushed to a PR into `main` or `dev`, and on pushes to `dev` or
`main` (the merge commit). Work branches are checked through their PR (not twice):

| job                        | what it does                                              | required |
|----------------------------|-----------------------------------------------------------|----------|
| `checks`                   | `npm ci`, `expo lint` (0 errors, `--max-warnings 16`; the cap only goes down), `jest --ci`, `npm run test:db` (migrations + RLS tests on PGlite), `tsc --noEmit`, `expo export --platform ios` (bundle smoke test) | **yes**: PRs that fail are blocked |
| `expo-doctor (advisory)`   | `npx expo-doctor` (dependency/config health)              | no (network-dependent) |

Run the same checks locally before pushing:

```bash
npm run ci           # lint && jest --ci && npm run test:db && tsc --noEmit
npm run lint         # expo lint (ESLint, eslint.config.js)
npm run test:db      # only the database tests (supabase/tests, in-process Postgres)
npm run doctor       # expo-doctor
```

Don't rename the `checks` job without updating branch protection.

After a push to `dev` or `main`, a `should-ship` job (not required to merge) decides
whether the commit has app changes, and a `ship` job starts `eas-ship.yml` only if
`checks` has passed for that exact SHA.

## 5. CD (`.github/workflows/eas-ship.yml`, `.eas/workflows/`)

On `dev`, deploys run **only after a merge** **and only after the `checks` job for
that exact commit has passed**, never on PR events, and never when those checks
failed. Until the next `dev` → `main` release, `main` still ships on push. After that
release, merges to `main` use the same gate. The full recipe is in
[docs/RELEASING.md](docs/RELEASING.md). In short:

| file                                 | trigger                     | does |
|--------------------------------------|-----------------------------|------|
| `.github/workflows/eas-ship.yml`     | after `checks` pass on a push to `dev` / `main`, or by hand | `scripts/eas-ship.sh`: OTA update if a build has this fingerprint, else start a build workflow |
| `.eas/workflows/build-dev.yml`       | started by eas-ship, or by hand | dev client build (`development`) |
| `.eas/workflows/build-production.yml`| started by eas-ship, or by hand | store build + upload to TestFlight (`production`) |

* **JS/asset-only change** → OTA update to the branch's channel, in minutes, no EAS build
  and no EAS queue.
* **Native change** → one build, plus an OTA update of the same commit for the new runtime
  (so the build's Updates tab is never empty). On `main` only if `version` was bumped;
  otherwise the ship fails, tells you to bump it, and publishes nothing.

Watch ships under GitHub → Actions → EAS ship, builds at expo.dev → project → Workflows.
Validate an EAS workflow: `eas workflow:validate .eas/workflows/build-dev.yml`.

### Backend (Supabase)

| branch | GitHub environment | Supabase project | EAS environments using it |
|--------|--------------------|------------------|---------------------------|
| `dev`  | `staging`          | `pushup-battles-staging` | `development` |
| `main` | `production`       | `pushup-battles-prod`    | `production` |

* Schema changes are **migrations** in `supabase/migrations/` (`<UTC timestamp>_<name>.sql`).
  Never edit a migration that has been merged; add a new one. Create one with
  `npx supabase migration new <name>`.
* Test them: add steps to `supabase/tests/cases.mjs` and run `npm run test:db`. Migrations
  ending in `_cron.sql` need pg_cron and are skipped by the tests.
* `.github/workflows/supabase-deploy.yml` runs `supabase db push` **only on a push to `dev`
  (staging) or `main` (prod)** when `supabase/migrations/` or `supabase/functions/` changes, never on PRs. It also deploys
  every Edge Function in `supabase/functions/` (folders starting with `_` are shared code). The
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
* Production `runtimeVersion` follows the app `version` (`policy: appVersion`). **If your PR
  makes a native change, bump `version` in `app.json` and `package.json` before it is
  released** (e.g. 1.1.0 → 1.2.0). `eas-ship.sh` refuses to publish an OTA to `production`
  when the version already has a store build with different native code.
* The dev client (`APP_VARIANT=development`) uses `policy: fingerprint`, so dev builds need
  no version bump: a native change on `dev` just makes a new Pushup Dev build.
* Mention "needs native build" in the PR description so the release PR shows it too.

## 7. Local development: dev client + hot reload

This app has a custom native module, so **Expo Go doesn't work**. Use the **Pushup Dev**
dev client (bundle id `com.jackroseman.pushupcounter.dev`). It installs next to the
TestFlight app.

1. **Install the dev client once** (and again after each native change). Get the latest
   `development` build from expo.dev → project → Builds and open its page on your iPhone.
   To make one yourself: `eas workflow:run .eas/workflows/build-dev.yml --ref dev` (or
   `eas build -p ios --profile development`; either uses 1 of the monthly builds). New iPhones must be
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

`APP_VARIANT=development` (set in the `development` EAS environment)
switches the name/bundle id in `app.config.ts`. Without it you get the normal
"Rep Royale" config.

## 8. Releasing (`dev` → `main`)

Follow [docs/RELEASING.md](docs/RELEASING.md): bump `version` if anything native changed,
run `scripts/release.sh`, wait for `checks`, merge (merge commit), and watch Actions → EAS
ship. Retry a failed upload without a new build: `eas submit -p ios --id <build id>`.

One-time setup for the upload (done):
* App Store Connect app record **"Rep Royale: Push-up Battles"**, bundle id
  `com.jackroseman.pushupcounter`, Apple ID `6829467517`, set in `eas.json` as
  `submit.production.ios.ascAppId`.
* An App Store Connect **team API key** (App Manager role) stored in EAS credentials and
  assigned to this project for EAS Submit (`eas credentials -p ios` → production →
  App Store Connect: Manage your API Key). `eas submit` and the workflow use it
  automatically; no Apple ID login or 2FA is needed. **Never commit the `.p8` file**
  or put key paths in `eas.json`. To rotate: revoke the key in App Store Connect → Users
  and Access → Integrations, create a new one, and add/assign it with the same menu.
* Name: the App Store record is "Rep Royale: Push-up Battles" (plain "Rep Royale" was
  taken); the home-screen name is `expo.name` in `app.json` ("Rep Royale"). The slug,
  URL scheme (`pushupcounter://`) and bundle ids keep the old name on purpose: changing
  them would break the EAS project link, invite links and the App Store record.

## 9. Rolling back

* **Bad OTA update:** republish the last good update to the channel:

  ```bash
  eas update:list --branch production                    # find the last good update group
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
* **`eas-ship.yml`** uses `EXPO_TOKEN` (repository secret, an Expo access token). Without it
  the job is skipped with a warning.
* **`supabase-deploy.yml`** uses GitHub secrets:
  * `SUPABASE_ACCESS_TOKEN` (repository secret): a personal access token from
    supabase.com/dashboard/account/tokens. Without it the deploy job is skipped with a warning.
  * `SUPABASE_PROJECT_REF` (environment secret on `staging` and `production`).
  * `SUPABASE_DB_PASSWORD` (optional environment secret). Without it the CLI logs in
    with a short-lived role created from the access token.
  * The Supabase CLI version is pinned in the workflow (`version:`); bump it on purpose.
* **EAS environment variables** (`eas env:list --environment <env>`) hold build-time config:
  `APP_VARIANT`, `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`. The
  `EXPO_PUBLIC_*` values are compiled into the app and are public by design (the Supabase
  *publishable* key; row-level security protects the data). Never put the service-role /
  secret key in an `EXPO_PUBLIC_` variable or in the app.
* Without the Supabase variables (e.g. a plain local `npx expo start`), the app runs in
  offline solo mode and hides sign-in.

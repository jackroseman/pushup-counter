# Rep Royale (Expo / React Native, iOS-first)

Formerly "Pushup Counter". App Store / TestFlight name: **Rep Royale: Push-up Battles**.
The home-screen name is **Rep Royale** (`expo.name` in `app.json`). The slug, URL scheme
(`pushupcounter://`) and bundle ids keep the old name on purpose.

Put a Face ID iPhone face-up on the floor under your chest and do push-ups. The app uses
the **TrueDepth / Face ID camera (ARKit)** to measure how far your face is from the phone
and **counts every rep from that depth**. You don't need to touch the phone. Each rep is
scored **Full**, **Good** or **Too shallow**. A live depth chart plots distance while you
work.

The app is **dark only**. After a short onboarding you land on three tabs: **Today**,
**Compete** and **You**. You can set a daily goal, join a friends league, and start
head-to-head or team **challenges**. Sign in with Apple to back up sets and compete with
friends. Icons are **SF Symbols** on iOS (`expo-symbols`, medium weight) with the SVG set
as the fallback on web and Android. Buttons, the daily ring, the rep count and the
3-2-1 countdown animate; with Reduce Motion on, those become simple crossfades.

Minimum iOS is **26**. Because of a custom native module, **Expo Go will not work** — use
the **Pushup Dev** development build or the TestFlight app.

> **Contributing?** Read [CONTRIBUTING.md](CONTRIBUTING.md) for the branch model
> (`dev` → `main`), PRs, CI, CD and the dev client.
>
> **Design.** The rebrand plan, 30 flow frames and 15 empty states live in
> [docs/rebrand/](docs/rebrand/). Tokens are in `src/ui/tokens.ts`.
>
> **Challenges and the backend.** Friends, the league, challenges, sign-in and
> notifications run on Supabase. The live schema is `supabase/migrations/`. Protocol and
> architecture notes are in [docs/battles/](docs/battles/) (they still use the older
> "battles" name; the product UI says "challenges").
>
> **Releases.** [docs/RELEASING.md](docs/RELEASING.md).

* Expo SDK 58 · React Native 0.88 · TypeScript (strict) · Node 22 in CI
* Custom native code lives in a local Expo Module (`modules/pushup-sensors`, Swift + Kotlin)

The version in this repo is **1.3.0**. That version is on `dev`; the `dev` → `main`
production release and TestFlight build of 1.3.0 are a separate, explicit step.

---

## 1. What you see in the app

### Onboarding

Shown once for a new install: **Welcome** → **pick a daily goal** (or skip) → **How it
works**. People who already have the app skip this.

### Today

Today's date, a ring and count toward the daily goal (if you have one), a week strip, and
shortcuts into the league and any challenge that needs a move. **Start a set** begins the
set flow. Phones without Face ID see an explanation instead of Start.

### Compete

A segmented control: **League** and **Challenges**. Signed-out people see a sign-in pitch.

* **League.** This week's board among friends. An (i) sheet explains it in two lines:
  every push-up you do this week counts, most reps wins, and the board starts fresh every
  week.
* **Challenges.** Best set (1 day, 3 days or 1 week, or a timed set), most reps (today,
  this week or this month), a streak face-off, or a shared team goal. **New challenge**
  opens as a sheet (Cancel and a centered title). Challenges are with people on your
  friends list. Invite links still work for a specific challenge.
* **Friends.** The friends list and a friend page (this week's reps, best set, shared
  record).

New challenges always count **reps**. Older Depth / Tempo / Form challenges created from
1.2.x builds can still exist on the server.

### You

Your recent sets, records and goal status, with Settings behind the gear. Signed out:
Sign in. Signed in without a username: **Pick a username**. **All sets** is the full
history list.

### Settings

* **Daily goal**
* **Count out loud** — on by default; when it is on, the app speaks the rep count during
  a set
* **Notifications**, plus **Daily reminder** and **Quiet hours** when a goal is set (or
  "Set a daily goal to get reminders")
* When signed in: **Pass ping** (a friend passes you) and **Sunday recap** (how your week
  went)
* When signed in: **Profile**, **Sets backed up**, **Sign out**, **Delete account**

### A set

1. **Lay your phone flat.** A level shows until the phone is level.
2. **Center your face.** The live face view, with Phone flat / Centered. An (i) opens
   How it works.
3. **Ready.** A 3-2-1 countdown: "Keep looking down at your phone." **Start over** goes
   back to centering.
4. **Counting.** The big count, a quality pill for the last rep, and a **Live depth**
   chart with "Face centered" or "Can't see your face." A speaker button mutes the voice
   for this set. **End set** finishes (or **Finish attempt** in a challenge). Closing
   after you have reps asks whether to discard the set.
5. If the phone stops lying flat, the set ends on **Set ended** ("Your phone moved") with
   the reps so far, then Start another set or Done.
6. **Summary.** The count first, a quiet badge, today's progress and the depth split;
   **Done**, then **Challenge a friend** and **Set details**.
7. **Set details.** Reps, time, pace, the depth split and a pace curve. **Delete set**
   removes a solo set on the phone and on the server (it stays gone after the next sync,
   including from another phone). Sets played in a challenge cannot be deleted.

Sets are stored on the device (AsyncStorage) and, when you are signed in, backed up to
the server.

---

## 2. Local development (Pushup Dev)

This app has a custom native module, so **Expo Go doesn't work**. Use the **Pushup Dev**
dev client (bundle id `com.jackroseman.pushupcounter.dev`). It installs next to the
TestFlight app ("Rep Royale").

Requirements:

* **Node 22** (what CI uses)
* An **Apple Developer Program** membership to sign device builds
* An Expo account, already linked to this project
* A **Face ID iPhone** running iOS 26 or later. Counting needs the TrueDepth camera.
  On other phones the app explains that it can't count.

**Install the dev client once** (and again after each native change). Get the latest
`development` build from expo.dev → the project → Builds and open its page on the
iPhone. To make one: `eas workflow:run .eas/workflows/build-dev.yml --ref dev` (or
`eas build -p ios --profile development`). New iPhones must be registered first with
`eas device:create`. Turn on **Settings → Privacy & Security → Developer Mode**.

Then:

```bash
npm install
npm run dev            # same Wi-Fi as the phone: expo start --dev-client
npm run dev:tunnel     # or the background helper below, when you are not on the same network
```

```bash
scripts/dev-server.sh          # start Metro + tunnel in the background, print the URL
scripts/dev-server.sh url      # print the current URL / deep link again
scripts/dev-server.sh stop
```

Logs are in `.expo/dev-server.log`. The tunnel URL changes when Metro restarts. Open
Pushup Dev, pick the server, enter the printed `https://…on.expo.app` URL, or open the
printed `exp+push-up-counter://expo-development-client/?url=…` deep link. JS/TS changes
reload on the phone (Fast Refresh). Shake the phone or three-finger long-press for the
dev menu. Native changes need a new Pushup Dev build.

`APP_VARIANT=development` (set in the `development` EAS environment, and by
`scripts/dev-server.sh`) switches the name and bundle id in `app.config.ts`. Without it
you get the store app config from `app.json`.

### Environment variables (names only)

Never commit tokens, database passwords, or `.env` files (`.env*.local` is gitignored).

* **App / EAS environments** (`eas env:list --environment <env>`): `APP_VARIANT`,
  `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`. The `EXPO_PUBLIC_*`
  values are compiled into the app and are public by design (the Supabase publishable
  key; row-level security protects the data). Never put a service-role or secret key in
  an `EXPO_PUBLIC_` variable or in the app.
* Without the Supabase variables (for example a plain local `npx expo start`), the app
  runs in offline solo mode and hides sign-in.
* **CI** needs no secrets. **EAS ship** uses `EXPO_TOKEN` (a repo secret). **Supabase
  deploy** uses `SUPABASE_ACCESS_TOKEN` (repo secret), `SUPABASE_PROJECT_REF`
  (environment secret on `staging` and `production`), and optionally
  `SUPABASE_DB_PASSWORD`.

Build profiles (`eas.json`):

| profile       | what it is                                                              |
|---------------|-------------------------------------------------------------------------|
| `development` | Pushup Dev dev client, internal distribution, `development` channel     |
| `production`  | App Store / TestFlight build (`production` channel; CD uploads it)      |

Rebuild the native client only when `modules/`, native config in `app.json` /
`app.config.ts`, or a package with native code changes. JS/TS-only changes reload
locally and, once merged, ship as an OTA update.

A local Mac build is optional (`npx expo prebuild --platform ios`, then
`npx expo run:ios --device`). `ios/` and `android/` are gitignored (Continuous Native
Generation).

---

## 3. Tests, lint and typecheck

```bash
npm test             # Jest (jest-expo)
npm run test:db      # supabase/migrations + RLS tests on in-process Postgres (PGlite)
npm run lint         # expo lint (0 errors, --max-warnings 16; the cap only goes down)
npm run typecheck    # tsc --noEmit
npm run ci           # lint && jest --ci && test:db && tsc --noEmit
npm run doctor       # expo-doctor (advisory in CI)
```

Jest covers rep detection, analysis, calibration and guidance, tilt, history and
settings, progress and today models, challenges, the league, friends, linking, tokens
and the set-flow helpers. `npm run ci` is the same set of checks as CI, minus the
`expo export` bundle smoke test (CI runs that too).

**UI preview:** to see UI changes without a phone, run the app in a browser with simulated
push-ups and canned data. Scripted flows save screenshots and `.mp4` recordings for PRs. See
[docs/ui-preview.md](docs/ui-preview.md) (`npm --prefix tools/preview run capture -- set-flow`).

---

## 4. Branch workflow

| branch     | what it is                              | ships to                                      |
|------------|-----------------------------------------|-----------------------------------------------|
| `main`     | Released code. Changes only by PR.      | **production** channel / TestFlight ("Rep Royale") |
| `dev`      | Integration branch for the next release | **development** channel / Pushup Dev          |
| `feat/*`, `fix/*`, `chore/*`, `docs/*` | Work branches, cut from `dev` | nothing (CI only) |
| `hotfix/*` | Urgent fix, cut from `main`             | nothing until merged                          |

* **Features and fixes:** branch from `dev`, open a PR **into `dev`**, wait for a green
  **`checks`** job, squash-merge.
* **Releases:** `scripts/release.sh` opens (or refreshes) a PR **`dev` → `main`**. It
  never merges. Wait for `checks`, then merge with a **merge commit** (not squash). See
  [docs/RELEASING.md](docs/RELEASING.md). The 1.3.0 production release is a separate,
  explicit go.
* **Hotfixes:** branch from `main`, PR into `main`, then merge `main` back into `dev`.
* Never force-push `main` or `dev`, and don't commit directly to them.

---

## 5. CI and shipping

**CI** (`.github/workflows/ci.yml`) runs on every commit to a PR into `dev` or `main`,
and on every push to `dev` or `main`. Work branches are checked through their PR only.

| job                      | what it does | required |
|--------------------------|--------------|----------|
| `checks`                 | `npm ci`, `expo lint` (0 errors, `--max-warnings 16`), `jest --ci`, `npm run test:db`, `tsc --noEmit`, `expo export --platform ios` | **yes** — a red run blocks the PR |
| `expo-doctor (advisory)` | `npx expo-doctor` | no |
| `should-ship`            | On a push to `dev` or `main` only: whether the commit has app changes. Ignores markdown, `docs/`, `supabase/`, `__tests__/`, `tools/` and `.github/`. Not required to merge. | no |
| `ship`                   | On a push to `dev` or `main`, starts `eas-ship.yml` as a reusable workflow for **that exact SHA**, only if `checks` passed and `should-ship` said yes | no |

**On `dev` today**, `eas-ship.yml` is no longer triggered by push alone. A red `checks`
run cannot publish an OTA or start a build. A docs-only merge, or a merge whose
`checks` failed, does not start a ship and does not cancel one that is already running.
A started ship checks out that SHA and **skips if it is no longer the branch tip**, so
a late run cannot publish stale code over a newer commit. Manual **Run workflow** on
EAS ship still requires a green `checks` job for that SHA.

**Until the next `dev` → `main` release, `main` still uses the previous ship-on-push
workflow.** After that release, merges to `main` use the same gate as `dev`.

When `eas-ship` does run, `scripts/eas-ship.sh` fingerprints the project with
`eas fingerprint:generate` (the same hash EAS builds record):

* **A build of that profile already has this fingerprint** (finished, queued or
  building, any age): a JS-only change. Publish an OTA update to the branch's channel
  (`development` → Pushup Dev, `production` → TestFlight). Phones check for updates on
  launch (`ON_LOAD`), download in the background, and run the update on the next launch.
* **No build has this fingerprint:** a native change. On `development`, it starts
  `.eas/workflows/build-dev.yml` (install the new Pushup Dev build when it is done). On
  `production`, it requires a `version` bump in `app.json` and `package.json`; otherwise
  it publishes nothing. A new version starts `.eas/workflows/build-production.yml` (store
  build + upload to TestFlight).

Runtime version (`app.config.ts`): the store app uses `appVersion` (`expo.version` in
`app.json`). The dev client uses `fingerprint`, so a native change on `dev` gets a new
Pushup Dev build without a version bump, and an old dev build never receives an update
it cannot run. JS-only PRs must leave the native fingerprint unchanged.

Internal (dev) builds expire after 14 days. An expired build still counts as "has this
fingerprint," so OTAs keep publishing; when you need to install the client again, run
`build-dev.yml` by hand.

By-hand commands and rollback steps are in [docs/RELEASING.md](docs/RELEASING.md) and
[CONTRIBUTING.md](CONTRIBUTING.md).

---

## 6. Supabase

| branch | GitHub environment | Supabase project           | EAS environment |
|--------|--------------------|----------------------------|-----------------|
| `dev`  | `staging`          | `pushup-battles-staging`   | `development`   |
| `main` | `production`       | `pushup-battles-prod`      | `production`    |

* Schema changes are **migrations** in `supabase/migrations/`
  (`<UTC timestamp>_<name>.sql`). Never edit a migration that has been merged; add a new
  one (`npx supabase migration new <name>`).
* Test them: add steps to `supabase/tests/cases.mjs` and run `npm run test:db`.
  Migrations ending in `_cron.sql` need pg_cron and are skipped by the tests.
* `.github/workflows/supabase-deploy.yml` runs `supabase db push` and deploys Edge
  Functions **only on a push to `dev` (staging) or `main` (prod)** when
  `supabase/migrations/` or `supabase/functions/` changes, never on PRs. It is
  independent of eas-ship. The `production` environment only accepts `main`, and
  `staging` only `dev`.
* Tunable defaults live in `public.app_settings`, not in code. The app reads them at
  launch and falls back to `src/backend/appSettings.ts` offline.
* Keep migrations backwards compatible with the app version that is already installed
  (add columns and functions first; remove them in a later release).

---

## 7. How counting works

```
modules/pushup-sensors (Swift)          src/core (pure TypeScript, unit-tested)
  ARKit face anchor  --{distance m,       RepDetector  --> Rep {quality, depthRatio, timing}
    tracked, ts} @≤30 Hz-->               Calibrator   --> top distance (median of a 2 s hold)
  UIDevice proximity --{near,ts}-->       TraceRecorder--> 10 Hz distance trace
    (supporting signal only)              analysis     --> SetAnalysis (tempo, depth, …)
  Core Motion gravity --> tilt            TiltMonitor  --> ends the set if the phone isn't flat
```

* **Native module** (`modules/pushup-sensors`):
  * `startFaceDistance(maxHz)` / `stopFaceDistance()`: an `ARSession` with
    `ARFaceTrackingConfiguration` (no camera preview). On each frame, the distance
    between the face anchor and the camera is throttled to about 30 Hz. Emits
    `onFaceDistance {distance, tracked, timestamp, offsetX?, offsetY?, pitch?, yaw?, roll?}`
    and `onFaceTrackingError`. The session lives in a shared `FaceSessionHub`; a
    watchdog restarts it if frames stop for more than 2 s while the app is active.
  * `<FaceMeshView>`: the native face view (iOS), bound to that same session. It renders
    the ARKit face mesh, not the camera image, and starts no second camera session.
  * `isFaceTrackingSupported()`: `ARFaceTrackingConfiguration.isSupported`. If it
    returns false, or the camera is denied, the app says it can't count.
  * `startProximity()` / `stopProximity()`: emit `onProximityChange`. Optional, never
    counts a rep on its own.
  * Gravity / tilt: Core Motion samples, used to require a flat phone and to end the
    set if it is picked up.
  * `enablePlaybackAudioSession()`: spoken counts can be heard with the silent switch
    on.
* **Rep detection** (`src/core/repDetector.ts`) is a depth state machine:
  * Distances are smoothed with a 3-sample median.
    `ratio = (top − d) / (top − floor)`, where `floor` is 8 cm.
  * **top**: ratio ≤ 0.20. **down**: you leave the top zone (that moment is the rep
    start). **bottom reached**: ratio ≥ 0.30. **counted**: you return to the top zone.
    A dip that never reaches 0.30 is discarded. Reps closer than 400 ms apart are
    ignored.
  * Scoring by the deepest tracked ratio: ≥ 0.70 **Full**, ≥ 0.45 **Good**, otherwise
    **Too shallow**.
  * Proximity only supports counting. A chest touch (near for ≥ 80 ms) during a cycle
    marks the rep as Full. It also covers ARKit losing your face when you are very
    close: losing the face at the bottom plus a touch gives a Full rep. Losing it
    without a touch is scored by the last depth tracked before losing it.
  * Timing per rep: `descentMs` (bottom − start), `ascentMs` (completion − bottom),
    `intervalMs` (completion − previous completion).
* **Guided calibration** (`src/core/guidance.ts`): `evaluatePose` checks face,
  distance, centering and head angle and picks one hint; `HoldTracker` fills a 2 s
  hold only while the distance stays steady; `CalibrationGuide` runs the `Calibrator`
  (median of that hold) once the hold completes. The on-screen UI is
  `src/session/FaceCentering.tsx`.
* **Charts** (`src/components/charts.tsx`, `react-native-svg`): `DistanceChart`,
  `LiveDistanceChart` (redraws from a ref buffer so sensor events don't re-render the
  screen) and `PaceCurve` on Set details.
* **Speech.** Settings → Count out loud, and the in-set speaker button, control whether
  the count is spoken. There are no haptics.

Saved with each set (`SessionRecord`): the reps (timestamps, depth, quality, timing),
and a distance **trace** downsampled to 10 Hz. Metrics are recomputed from that data
when a set is opened (`src/core/analysis.ts`), so older sets still open.

---

## 8. Layout

```
App.tsx                       entry; providers and the root navigator
app.config.ts                 APP_VARIANT: Pushup Dev name, .dev bundle id, fingerprint runtime
src/ui/                       design system (tokens, Text, Button, Icon, Ring, …)
src/navigation/               tabs (Today, Compete, You), stack routes, linking
src/screens/                  Today, You, Settings, set flow, onboarding, compete/, goal/
src/session/                  useSession, FaceCentering, set-flow view helpers
src/core/                     detector, calibration, guidance, tilt, analysis (pure TS)
src/progress/                 goals, today/you models, formatters, nudges
src/battles/                  challenge model, API, caches, New challenge, upload queue
src/backend/                  Supabase client, identity, sync, notifications
src/storage/                  AsyncStorage history and settings
src/components/               charts, the lay-flat level, notification prompt
modules/pushup-sensors/       local Expo Module (ios/*.swift, android/*.kt, src/*.ts)
supabase/                     migrations, Edge Functions, database tests
docs/rebrand/                 implementation plan, frames, empty states
docs/battles/                 challenge/league backend spec and architecture
docs/RELEASING.md             release recipe
scripts/                      dev-server.sh, eas-ship.sh, release.sh
tools/preview/                web preview and UI capture tooling (see docs/ui-preview.md)
__tests__/                    Jest tests
```

---

## 9. Limitations

* **Needs a Face ID iPhone running iOS 26, and a real device.** The simulator, older
  iPhones and Android phones can't count; the app explains this instead of showing
  Start. iPhone X / XS / XR have no iOS 26 and stay on the 1.2.x store build.
* ARKit face tracking is designed for faces roughly 20 cm–1 m away, and very close to
  the phone it often loses the face (handled as described above). Lighting, beards,
  hats and glasses can all affect it. Keep your face over the phone.
* If your chest triggers the proximity sensor, iOS blanks the screen until you push up.
  The app keeps counting, and can still speak the count.
* The camera is used only on the device to estimate distance. No images are saved or
  uploaded.
* Settings from older versions are migrated: the removed "Depth-only counting,"
  haptics and "Speak quality" toggles are dropped. Older saved sets still open.
* Expo Go is not supported. Use the Pushup Dev build or TestFlight.

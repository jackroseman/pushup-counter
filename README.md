# Rep Royale (Expo / React Native, iOS-first)

Formerly "Pushup Counter". App Store / TestFlight name: **Rep Royale: Push-up Battles**.

Put your iPhone face-up on the floor under your chest and do pushups. The app uses the
**TrueDepth / Face ID camera (ARKit)** to measure how far your face is from the phone,
and **counts every rep from that depth alone**. You don't need to touch the phone. Each rep
is scored **Full**, **Good** or **Shallow**. A live chart plots the distance while you
work. When you finish, an analysis screen shows your tempo (time between reps over the
set), depth per rep, and other metrics. All of it is saved with the set.

> **Contributing?** Read [CONTRIBUTING.md](CONTRIBUTING.md) for the branch model (`dev` → `main`),
> PRs and required CI checks, CD (OTA vs native builds), the dev client with hot reload, and
> rollbacks.

> **Push-up battles** (friends, challenges, leagues, notifications) run on Supabase. Design
> docs: [spec](docs/battles/SPEC.md), [architecture & phases](docs/battles/ARCHITECTURE.md).
> The live schema is `supabase/migrations/`. Releases: [docs/RELEASING.md](docs/RELEASING.md).

* Expo SDK 58 · React Native 0.88 · TypeScript (strict)
* Custom native code lives in a local Expo Module (`modules/pushup-sensors`, Swift + Kotlin).
  Because of that, **Expo Go will not work**. You need a *development build*, made with
  EAS Build or locally on a Mac.

---

## 1. Build and install on your iPhone with EAS (no Mac needed)

Requirements:

* An **Apple Developer Program** membership (**$99/yr**, https://developer.apple.com/programs/).
  You need it to sign builds and install them on a physical iPhone. A free Apple ID
  can't be used with EAS for device builds.
* An Expo account (free): https://expo.dev/signup
* A **Face ID iPhone** (iPhone X or newer, not an SE). Counting needs the TrueDepth
  camera. On other phones the app explains that it can't count.
* Node 20+.

Steps:

```bash
cd PushupCounter
npm install

# 0. Change the placeholder bundle id in app.json first (ios.bundleIdentifier =
#    "com.example.pushupcounter"). Use something unique, e.g. com.yourname.pushupcounter.

npm i -g eas-cli
eas login
eas init                 # links the project to your Expo account (adds extra.eas.projectId)

# Register your iPhone for ad-hoc/internal installs. This prints a URL/QR code:
# open it on the phone and install the provisioning profile it offers.
eas device:create

# Build the development client in the cloud (~10–20 min). EAS will ask to log in to
# your Apple account and will create the certificates/profiles for you.
eas build --profile development --platform ios
```

When the build finishes, open the link or QR code from EAS on the iPhone and install it.
The first time, iOS 16+ also requires **Settings → Privacy & Security → Developer Mode → On**
(this needs a restart).

Then run the JS bundler on your computer and open the app on the phone. Both need to be
on the same Wi-Fi network:

```bash
npx expo start --dev-client
```

Build profiles (`eas.json`):

| profile       | what it is                                                     |
|---------------|----------------------------------------------------------------|
| `development` | Dev client (loads JS from `expo start`), internal distribution |
| `production`  | App Store / TestFlight build (uploaded with `eas submit -p ios`; CD does it automatically) |

For the standalone app, install Rep Royale from TestFlight.

Rebuild only when the native code or config changes (`modules/`, `app.json`, or native
dependencies). For JS/TS-only changes, just reload.

## 2. Alternative: build locally on a Mac

You need a recent Xcode (the version Expo SDK 58 requires; see https://docs.expo.dev), CocoaPods, and Node.

```bash
npm install
npx expo prebuild --platform ios     # generates ./ios (git-ignored; Continuous Native Generation)
npx expo run:ios --device            # pick your plugged-in iPhone
```

The first time, open `ios/PushupCounter.xcworkspace` in Xcode. Under
*Signing & Capabilities*, choose your Team. A free Apple ID works for local installs,
but the app expires after 7 days. Then run again. You can also run `eas build --local`
on a Mac.

## 3. Using it

1. Pick a spot on the floor that fits the length of your body. Put the phone face-up
   under your chest/sternum (or chin) with the top of the phone toward your head, so the
   front camera can see your face.
2. Tap **Start** and get into the plank (top) position. **Guided calibration** shows the
   live face mesh with a checklist and tells you (on screen and by voice) what to fix:
   * **Face**: found / not found.
   * **Distance**: your top distance must be 25–80 cm ("too close" / "too far").
   * **Centered**: your face must be within ~12° of the camera axis. It says "shift
     left/right/forward/back" based on your face's offset from the camera.
   * **Head angle**: pitch within 25° and yaw within 20° ("look straight down at the phone").
   * **Steady**: once all checks pass, a ring fills over 2 s while you hold still. If your
     distance wobbles (std dev > 1.5 cm), you lose the face or a check fails, it restarts and
     says why.

   When the ring completes, the median of those 2 s becomes your **top distance** (the same
   median/MAD calibration as before). It shows "Top locked: N cm" and counts down 3 s. Tap
   **Redo calibration** during the countdown (or before your first rep) to do it again.
3. Do pushups. A rep counts when you go down at least 30% of the way from your top
   distance toward the phone and come back up. It speaks the count (plus "good"/"shallow"
   if the rep wasn't full) and buzzes.
4. While you work, use the **Chart | Face** toggle above the chart to switch between the live
   chart and the live face view (see below). Switching never affects counting. The **live chart** scrolls through the last 12 s of face distance.
   It shows your top line, the Good/Full depth thresholds (dashed) and a dot for each
   rep, coloured by quality. The badge shows the last rep's depth %, down/up time and the
   time since the previous rep.
5. Tap **End set** to open the **Set analysis** screen. Sessions are saved in **History**
   (on the device, AsyncStorage). Tap any past set to open its analysis again.

### Face view (TrueDepth measurements)

The face view is a native SceneKit view (`FaceMeshView` in `modules/pushup-sensors`). It
renders the **same ARKit session** that counts reps (it starts no second camera session), and
does **not** show the camera image:

* your face as a live **ARKit face mesh** (`ARSCNFaceGeometry` wireframe) on a dark
  background, updated at camera rate (30 fps);
* the **face ↔ phone distance** in cm (big number, the same value rep counting uses);
* the **closest point** of the mesh to the phone (the "lowest point"), marked with an orange dot
  and labelled with its own distance;
* **pitch / yaw / roll** in degrees (hidden in the small in-workout view);
* the **tracking state** (Tracking / Face lost / Camera starting).

The mesh and its numbers are computed and drawn natively. They do not cross the JS bridge;
only the existing ~30 Hz distance event (now with offset and angles) goes to JS. If the phone
gets hot, the view drops to 15 fps (serious) or 5 fps (critical) and says so. On a phone
without Face ID it shows a message instead.

### Set analysis

* **Metrics:**
  * total reps, set duration and active time
  * reps/min
  * average and median time between reps
  * **tempo trend**: mean interval of the last third of reps vs the first third, e.g.
    "Slowed down 35%" (beyond ±10% counts as slowing / speeding up)
  * average depth % and depth consistency (standard deviation: under 6 points is very
    consistent, under 12 is consistent, otherwise variable)
  * depth change, first third → last third
  * Full/Good/Shallow counts
  * average descent and ascent time
  * fastest and slowest rep
  * a few plain-language tips
* **Charts:**
  * **Time between reps** vs rep number, with an average line. This is the fatigue / pacing chart.
  * **Depth per rep** as bars coloured by quality, with the Full (70%) and Good (45%) lines.
  * **Whole-set face distance**, with rep markers and thresholds.
* **Rep table**: quality, depth %, down/up seconds and the gap before each rep.

Saved with each set (`SessionRecord`, version 2):

* the reps, each with timestamps (`startedAt`, `bottomAt`, `timestamp`), depth and depth
  ratio, quality, `descentMs`, `ascentMs` and `intervalMs`
* a distance **trace** downsampled to 10 Hz: `[msSinceStart, meters | null]`, where null
  means the face wasn't tracked. It is capped at 3000 points; longer sets get coarser
  resolution.

Metrics are recomputed from that data whenever a set is opened (`src/core/analysis.ts`),
so improvements to the analysis also apply to old sets. Sets saved by earlier versions
(without timing or a trace) still show their interval chart and metrics.

Settings on the start screen: **Speak quality** (say "good"/"shallow" after the count)
and **Haptics**.

## 4. How it works

```
modules/pushup-sensors (Swift)          src/core (pure TypeScript, unit-tested)
  ARKit face anchor  --{distance m,       RepDetector  --> Rep {quality, depthRatio, timing}
    tracked, ts} @≤30 Hz-->               Calibrator   --> top distance (median of 2 s)
  UIDevice proximity --{near,ts}-->       TraceRecorder--> 10 Hz distance trace
    (supporting signal only)              analysis     --> SetAnalysis (tempo, depth, ...)
```

* **Native module** (`modules/pushup-sensors`):
  * `startFaceDistance(maxHz)` / `stopFaceDistance()`: run an `ARSession` with
    `ARFaceTrackingConfiguration` (no camera preview is shown). On each frame, take the
    distance between the face anchor and the camera, throttled to about 30 Hz. Emit
    `onFaceDistance {distance, tracked, timestamp, offsetX?, offsetY?, pitch?, yaw?, roll?}`
    (offset from the camera axis in m and head angles in degrees, when tracked) and
    `onFaceTrackingError`. The session lives in a shared `FaceSessionHub`; a watchdog
    restarts it if frames stop for > 2 s while the app is active.
  * `<FaceMeshView showAngles />`: the native face view (iOS), bound to that same session.
  * `isFaceTrackingSupported()`: `ARFaceTrackingConfiguration.isSupported`. If it returns
    false, or the camera is denied, the app says it can't count.
  * `startProximity()` / `stopProximity()`: emit `onProximityChange`. This is optional.
  * `enablePlaybackAudioSession()`: counts can be heard with the silent switch on.
* **Rep detection** (`src/core/repDetector.ts`) is a depth state machine:
  * **Distances:** samples are smoothed with a 3-sample median.
    `ratio = (top − d) / (top − floor)`, where `floor` = 8 cm.
  * **Phases:**
    * **top**: ratio ≤ 0.20.
    * **down**: you leave the top zone. The moment you leave the top is the rep start.
    * **bottom reached**: ratio ≥ 0.30.
    * **counted**: you return to the top zone. A dip that never reaches 0.30 is
      discarded. Reps closer than 400 ms apart are ignored.
  * **Scoring** by the deepest tracked ratio:
    * ≥ 0.70: **Full**
    * ≥ 0.45: **Good**
    * otherwise: **Shallow**
  * **Proximity only supports counting, it never counts a rep.** A chest touch (near for
    ≥ 80 ms) during a cycle marks the rep as Full. It also covers ARKit losing your face
    when you're very close: losing the face at the bottom plus a touch gives a Full rep.
    Losing it without a touch is scored by the last depth tracked before losing it. While
    the sensor still reads near, the detector waits for it to clear before completing.
  * **Timing per rep:**
    * `descentMs` = bottom − start
    * `ascentMs` = completion − bottom
    * `intervalMs` = completion − previous completion
* **Guided calibration** (`src/core/guidance.ts`, unit-tested): `evaluatePose` checks
  face / distance / centering / head angle and picks one hint; `HoldTracker` fills the 2 s
  hold only while the distance std dev stays ≤ 1.5 cm (it restarts on movement, a lost face, a
  bad pose or a data gap); `CalibrationGuide` runs the existing `Calibrator` (median of the
  2 s hold) once the hold completes.
* **Charts** (`src/components/charts.tsx`, `react-native-svg`): `DistanceChart` (distance
  line with gaps, threshold lines, rep markers), `LiveDistanceChart` (redraws at 12 fps from
  a ref buffer, so sensor events don't re-render the screen) and `RepChart` (line/bar per rep).

## 5. Over-the-air updates (EAS Update) and CI/CD

* `updates.url` is the project's `u.expo.dev` URL; the app checks for updates on launch
  (`ON_LOAD`), downloads in the background and runs the update on the next launch.
* Channels: `development` (Pushup Dev) and `production` (TestFlight / App Store).
* Runtime version: `appVersion` for the store app, `fingerprint` for the dev client
  (`app.config.ts`).
* **CI** (`.github/workflows/ci.yml`): the required `checks` job runs lint, jest, the
  database tests, tsc and an `expo export` bundle test on every PR commit and on every
  push to `dev` or `main`.
* **CD** (`.github/workflows/eas-ship.yml`): after those `checks` pass on a merge to
  `dev` or `main`, a JS-only change is published as an OTA update in minutes; a native
  change starts one EAS build (`.eas/workflows/build-*.yml`). On `main` a native change
  needs a `version` bump first. A failed `checks` run does not ship.

Everything about shipping, including by-hand commands and the release steps, is in
[docs/RELEASING.md](docs/RELEASING.md).

## 6. Development

Hot reload on your iPhone with the **Pushup Dev** dev client (details in
[CONTRIBUTING.md §7](CONTRIBUTING.md#7-local-development-dev-client--hot-reload)):

```bash
scripts/dev-server.sh        # starts Metro + tunnel in the background, prints URL + deep link
npm run dev                  # or in the foreground, same Wi-Fi: expo start --dev-client
```

```bash
npm test             # Jest (jest-expo): detector, analysis, trace, scoring, calibration, guidance, history/settings
npm run test:db      # database tests (supabase/migrations on in-process Postgres)
npm run lint         # expo lint
npm run typecheck    # tsc --noEmit
npx expo-doctor
```

Layout:

```
App.tsx                       state-based navigation + settings
src/core/                     types, scoring, calibration, guidance, RepDetector, TraceRecorder, analysis, summary (pure TS)
src/session/useSession.ts     sensors → detector, live chart buffer, trace, speech, haptics, keep-awake, history
src/components/charts.tsx     SVG charts (live distance, full-set distance, per-rep line/bar)
src/components/calibration.tsx  calibration checklist + hold-still progress ring
src/screens/                  Start, Session (live chart), Summary (set analysis), History
src/storage/                  AsyncStorage history (+trace) and settings (with migration)
modules/pushup-sensors/       local Expo Module (ios/*.swift, android/*.kt, src/*.ts)
__tests__/                    Jest tests
```

## 7. Limitations / known caveats

* **Needs a Face ID iPhone and a real device.** The simulator, older iPhones and Android
  phones can't count; the app explains this instead of showing Start.
* ARKit face tracking is designed for faces roughly 20 cm–1 m away, and very close to the
  phone it often loses the face (handled as described above). Lighting, beards, hats and
  glasses can all affect it. Keep your face over the phone.
* If your chest triggers the proximity sensor, iOS blanks the screen until you push up.
  The app keeps counting through audio and haptics.
* The camera is used only on the device to estimate distance. No images are saved or
  uploaded.
* Settings from older versions are migrated: the removed "Depth-only counting" toggle is
  dropped. Older saved sets still open, but without a distance trace.
* **Version 1.1.0 needs a new build.** The face view is new native code, so the
  runtime version changed (it follows the app version). 1.0.x builds will not get this as an
  OTA update. Install the new build.
* The left/right centering hint comes from ARKit's camera axes and has not been checked on
  every device yet. If it seems reversed, tell us.
* Expo Go is not supported (custom native module). Use the Pushup Dev build or TestFlight.

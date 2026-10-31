# Pushup Counter (Expo / React Native, iOS-first)

Put your iPhone face-up on the floor under your chest and do pushups. The app counts
each rep with the **proximity sensor** (the one that blanks the screen during calls), and
uses the **TrueDepth / Face ID camera (ARKit)** to measure how far your face comes
toward the phone, so it can score every rep as **Full**, **Good** or **Shallow**.

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
* A **Face ID iPhone** (iPhone X or newer, not an SE) for depth scoring. Counting
  alone works on any iPhone that has a proximity sensor.
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
| `preview`     | Standalone release build, internal distribution (ad-hoc)       |
| `production`  | App Store / TestFlight build (`eas submit -p ios` afterwards)  |

For a standalone build that doesn't need your computer running, use
`eas build --profile preview --platform ios`.

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
2. Tap **Start**. Get into the plank (top) position during the 3-second countdown, then
   hold still for about 2 seconds while it calibrates your "top" distance.
3. Do pushups. Touch your chest (or get your face within a few cm) to the phone each rep.
   It speaks the count (plus "good"/"shallow" if the rep wasn't full) and buzzes.
4. Tap **End set** for a summary. Sessions are saved in **History** (on the device, AsyncStorage).

Settings on the start screen:

* **Depth-only counting**: count reps from the face distance alone, without needing to
  trigger the proximity sensor. This is useful if you don't want to touch the phone. It
  needs a successful calibration.
* **Speak quality**: say "good"/"shallow" after the count.
* **Haptics**.

## 4. How it works

```
modules/pushup-sensors (Swift)          src/core (pure TypeScript, unit-tested)
  UIDevice proximity  --{near,ts}-->      RepDetector  --> Rep {quality, depthRatio, ...}
  ARKit face anchor  --{distance m,       Calibrator   --> top distance (median of 2 s)
    tracked, ts} @≤30 Hz-->               scoring      --> Full / Good / Shallow
```

* **Native module** (`modules/pushup-sensors`, created with `create-expo-module --local`):
  * `startProximity()` / `stopProximity()`: turn on `UIDevice.isProximityMonitoringEnabled`
    and emit `onProximityChange {near, timestamp}`.
  * `startFaceDistance(maxHz)` / `stopFaceDistance()`: run an `ARSession` with
    `ARFaceTrackingConfiguration` (no camera preview is shown). On each frame, take the
    distance between the face anchor and the camera position, throttled to about 30 Hz.
    Emit `onFaceDistance {distance, tracked, timestamp}`, and `onFaceTrackingError` if
    something goes wrong.
  * `isFaceTrackingSupported()`: `ARFaceTrackingConfiguration.isSupported`.
  * `enablePlaybackAudioSession()`: sets the audio session to `.playback`, so counts
    can be heard with the silent switch on and your music is ducked.
  * Android: proximity through `SensorManager` (`TYPE_PROXIMITY`). Face tracking is not
    implemented and reports unsupported.
* **Rep detection** (`src/core/repDetector.ts`):
  * A rep is counted on the proximity **near → far** transition (you pushed back up).
  * Debounce: a "near" shorter than 80 ms is treated as noise. A rep completed less than
    400 ms after the previous one is ignored.
  * While the rep is happening, the detector tracks the smoothed (3-sample median)
    minimum face distance. Depth ratio = `(top − bottom) / (top − floor)`, where
    `floor` = 8 cm, and the result is clamped to 0–1.
    * ≥ 0.70: **Full**
    * ≥ 0.45: **Good**
    * Anything less: **Shallow**
  * **Proximity ⇒ full**: if the proximity sensor fired, your chest reached the phone,
    so the rep counts as Full. Also, ARKit often loses the face when it is very close; a
    rep where the face was lost at the bottom is treated as having reached full depth.
  * The depth score mainly matters for **depth-only** mode. In that mode, a rep is
    counted when you start in the top zone, go down past 30% of your range, and come back
    to the top zone (within 20% of the top). A proximity rep in the same cycle prevents
    double counting.
* **UI**: Start → Session (big counter, last-rep quality badge, sensor indicators) →
  Summary → History. `expo-keep-awake` keeps the device from auto-locking during a set.

## 5. Development

```bash
npm test             # Jest (jest-expo preset): detector, scoring, calibration, history
npm run typecheck    # tsc --noEmit
npx expo-doctor
```

Layout:

```
App.tsx                       state-based navigation + settings
src/core/                     types, scoring, calibration, RepDetector, summary (pure TS)
src/session/useSession.ts     wires the sensors, detector, speech, haptics, keep-awake and history
src/screens/                  Start, Session, Summary, History
src/storage/                  AsyncStorage history + settings
modules/pushup-sensors/       local Expo Module (ios/*.swift, android/*.kt, src/*.ts)
__tests__/                    Jest tests
```

## 6. Limitations / known caveats

* **Needs a real device.** The simulator has no proximity sensor and no TrueDepth camera.
  Depth scoring needs a **Face ID iPhone**. Other phones only count (the app shows
  a "Depth scoring unavailable" note).
* **The screen turns off while the proximity sensor reads "near".** iOS forces this and
  apps can't override it. The app keeps running and still speaks and buzzes, which is
  why there is audio and haptic feedback. The screen comes back on when you push up.
* It hasn't been confirmed whether ARKit keeps getting camera frames during the moments
  the screen is blanked by proximity. If it doesn't, those reps will simply count as Full
  through proximity.
* ARKit face tracking is designed for faces roughly 20 cm–1 m away. Very close to the
  phone, it often loses the face (which is handled as described above). Lighting, beards,
  hats and glasses can all affect it.
* The camera is used only on the device to estimate distance. No images are saved or
  uploaded.
* Android support is limited to proximity counting, and hasn't been tested.
* Expo Go is not supported (custom native module). Use the dev build.

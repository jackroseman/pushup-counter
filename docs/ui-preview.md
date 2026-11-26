# UI preview: run the app in a browser, script flows, record them

`tools/preview/` builds the real app for the web with stand-ins for the phone's sensors and the
backend, then drives it in Chromium (Playwright) to take screenshots and record `.mp4` videos of
scripted flows: Today, a full set with simulated push-ups, the summary, Compete, You and
Settings, onboarding, empty states, and any of those with Reduce Motion on.

Use it to review UI and UX changes, attach before/after recordings to a PR, and check that a
change did not break a flow. It's for developers and coding agents and needs no phone, no Mac and
no backend access.

## What it is, and what it isn't

**It is** the app's own screens, navigation, animations, copy and rep-counting logic, running
from the same source as the iPhone app. Push-ups come from a simulator that feeds the app the
same kinds of readings the iPhone's sensors produce, and the app's real `RepDetector` counts them.
Backend calls go to canned data, so nothing ever reaches Supabase.

**It isn't** an iPhone. Nothing here exercises:

* the TrueDepth camera, ARKit face tracking or the face mesh (the face view is a black field)
* Core Motion, haptics, the proximity sensor, speech timing, the silent switch, notifications
* native iOS pieces: the native tab bar, SF Symbols (the web shows the app's SVG fallback icons),
  native sheets and pickers, Sign in with Apple
* real device performance (60 fps, the JS thread under load) or iOS font rendering (on Linux the
  preview uses Inter; on a Mac it uses the system font)

So the preview is a fast first check. **Anything touching sensors, native views, performance or
the feel of an animation still needs a check on a real iPhone** (Pushup Dev, see CONTRIBUTING.md).

## Setup (once)

Needs Node 22 and the repo's own `npm ci`.

```bash
npm --prefix tools/preview run setup
```

This installs the preview's own dependencies into `tools/preview/node_modules` (react-dom,
react-native-web, playwright-core) and Playwright's video recorder. It uses an installed Google
Chrome when there is one. Otherwise, either install Playwright's Chromium:

```bash
node tools/preview/node_modules/playwright-core/cli.js install chromium
```

or set `PREVIEW_CHROME=/path/to/chrome`. Install `ffmpeg` (`brew install ffmpeg`,
`apt install ffmpeg`) to get `.mp4` files. Without it you get `.webm`.

> Why its own `package.json`? The app's `package.json` scripts and dependencies are part of the
> native fingerprint. Adding the preview there would change the dev runtime and force a new dev
> build. Under `tools/` it changes nothing for the app, and CI's `should-ship` job ignores `tools/`
> so tooling-only merges never publish an update.

## Commands

Run these from the repo root.

| Command | What it does |
| --- | --- |
| `npm --prefix tools/preview run build` | Builds the preview into `tools/preview/out/web` (about 10 s). Rebuild after changing app code. |
| `npm --prefix tools/preview run capture -- set-flow` | Runs one or more flows: screenshots and an `.mp4` per flow. |
| `npm --prefix tools/preview run capture -- all` | Runs every flow. |
| `npm --prefix tools/preview run capture -- set-flow --reduce-motion` | Same flow with iOS Reduce Motion on. |
| `npm --prefix tools/preview run capture -- today compete --no-video` | Screenshots only (faster). |
| `npm --prefix tools/preview run flows` | Lists the flows. |
| `npm --prefix tools/preview run web` | Opens the app in a phone-sized window you can click through (needs a display). Builds first if needed. Add `-- --user new` for a fresh install, `-- --user empty` for a signed-in user with no data, or `-- --rebuild` to rebuild. |

A failing step (a missing button, a wrong rep count) fails the command, prints the step that
failed and saves `zz-failed.png` beside that flow's other screenshots.

## Flows

| Flow | What it shows |
| --- | --- |
| `today` | Today for a signed-in user, 22 of 50 done, league and challenge cards |
| `set-flow` | Start a set → "Lay your phone flat" → level locks → 3-2-1 → 7 push-ups (**the count is checked**) → End set → summary → Done → Today |
| `phone-moved` | Push-ups, then the phone is picked up: the set ends on its own |
| `summary` | A 38-rep set (a new best set, checked) → summary → Set details → All sets |
| `compete` | League board, "How the league works", Challenges, a challenge, the New challenge sheet |
| `you-settings` | You tab and Settings |
| `onboarding` | Fresh install, signed out: Welcome → Pick a daily goal → How it works → Today |
| `empty` | Today, Compete, Challenges and You with no data |
| `invite-share` … `invite-first-run` | Friend invite links (`flows/invite.js`, 9 variants): share sheet, Copied, QR, Settings row, New friend on Friends, Add friend / added / already friends / own link / invalid link, signed out → Sign in with Apple → Pick a username, first run → Welcome with "invited you". Open with a path such as `i/k7m2qx9p` (no leading slash). |


Any flow can be run with `--reduce-motion`. The app has one (dark) appearance, so there is no
light/dark switch.

## Where the output goes

Everything goes into `tools/preview/out/` (git-ignored):

```
tools/preview/out/
  web/                              the preview build
  build.log                         expo export output
  captures/set-flow/01-today.png    numbered screenshots, in step order
  captures/set-flow/set-flow.mp4    the recording
  captures/set-flow-reduce-motion/  same flow with --reduce-motion
```

Screenshots are 402 × 874 points (iPhone 16 Pro / 17) at 3x, or 2x when the flow is also
recording a video. Videos are 804 × 1748. The browser clock starts at Wednesday 25 November
2026, 4:30 PM Eastern, so every run renders the same dates and numbers.

## Attaching recordings to a PR

GitHub **won't play an `.mp4` from a file link** (`github.com/.../blob/...`). On a phone you
mostly get a "View raw" button. Do one of these instead:

* **Drag the `.mp4` or `.png` into the PR description or a comment.** GitHub uploads it and plays
  it inline, on a phone too. This is the simplest option.
* If the files have to live in the repo (on a separate assets branch, never in `dev`), link the
  **raw** URL: `https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>.mp4`, or
  `https://github.com/<owner>/<repo>/raw/<branch>/<path>.mp4`.

Label them as web previews so nobody mistakes them for device recordings.

## How the preview build works (and why the app is untouched)

The app has no preview code in it. No `src/` file, native module or app config knows the preview
exists, and a unit test fails if one ever imports `tools/preview`. The swaps happen only while
the preview bundle is built:

1. `tools/preview/build.js` runs `expo export --platform web` with
   `EXPO_OVERRIDE_METRO_CONFIG=tools/preview/metro.config.js`. The app itself has no
   `metro.config.js`, so EAS builds, OTA updates and every other export use Expo's default config
   and never read the preview one. (That config also refuses to load unless `RR_PREVIEW=1`, which
   only `build.js` sets.)
2. `tools/preview/resolver.js` swaps three web modules while bundling:
   * `modules/pushup-sensors/src/PushupSensorsModule.web.ts` (always "unsupported") →
     `shims/PushupSensorsModule.ts`, the sensor simulator
   * `modules/pushup-sensors/src/FaceMeshView.tsx` → a black field (no camera in a browser)
   * `expo-secure-store` (has no web version) → `localStorage`, so a signed-in session can be seeded
3. `tools/preview/babelTransformer.js` makes `Platform.OS` read `'ios'` in `src/sensors.ts` only.
   Expo turns `Platform.OS === 'ios'` into `false` when it builds for the web, so without this the
   app would decide it has no Face ID camera before asking the simulator.
4. The build bakes in a fake backend address (`https://rr-preview.supabase.co`) and ignores any
   local `.env` files.
5. `build.js` checks that the simulator and the fake address made it into the bundle, and fails if
   they didn't (for example if a future Expo stops honouring the override).

`react-dom` and `react-native-web` live in `tools/preview/node_modules`, not the app's
dependencies: installed at the repo root they would add "web" to the app's platforms and change
the native fingerprint.

## The sensor simulator

`tools/preview/simulator/signals.ts` (pure functions, unit-tested against the real `RepDetector`)
and `tools/preview/shims/PushupSensorsModule.ts` (the module that emits the events) stand in for
the iPhone's sensors:

* **Face distance** (`onFaceDistance`, ~30 Hz): 0.42 m at the top. Each push-up is a smooth dip
  of 0.27 m (a "Full" rep) and back up, taking `periodMs` (default 2200 ms).
* **Gravity** (`onGravity`, 20 Hz): `flat` (under the app's 8° "flat" limit), `lean` (about 11°:
  not flat enough to start, not "moved"), or `tilt` (about 26°: past the 15° "phone moved" limit).
* **Stalled** gravity sends a reading every 700 ms instead of every 50 ms, so the level step never
  locks. Use it to hold the "Lay your phone flat" screen still.
* **Face lost** sends "not tracked" readings.

In the page it is `window.previewSim`:

```js
previewSim.flat()                 // lay the phone flat
previewSim.lean()                 // a few degrees off: the level step waits
previewSim.tilt()                 // pick the phone up (ends a running set)
previewSim.stall(true)            // slow gravity readings: level never locks
previewSim.loseFace() / previewSim.findFace()
previewSim.startReps(1100, 5)     // 5 push-ups, 1.1 s each, then hold at the top
previewSim.startReps(1100)        // keep going...
previewSim.stopReps()             // ...finish the push-up in progress, then hold
previewSim.expectedReps()         // push-ups done so far (what the app should show)
previewSim.state()
```

In flows use `ctx.sim.*` (the same methods) and `ctx.doReps(n, periodMs)`, which does exactly
`n` push-ups and then **fails the flow unless the set screen shows `n`** (it reads the count's
"N reps" accessibility label). Keep `periodMs` at 900 ms or more. Real push-ups are slower, and
the app ignores reps that come too close together.

In the interactive window (`run web`), click the page once, then use these keys: `f` flat,
`l` lean, `t` tilt, `s` stall on/off, `r` push-ups on/off, `x` face lost/found.

## The mock backend

The browser driver (`tools/preview/lib/browser.js`) answers every request to the fake Supabase
address from `tools/preview/mock/backend.js` and blocks every other outside request. The data is
in `tools/preview/mock/fixtures.js`: "Sunny", a month of sets, the "50 a day" program, four
friends, a league week and six challenges (active, pending, finished, team, streak). It is
generated from a fixed date and a seeded random generator, so every run is identical.

A flow picks a starting user and can override anything:

```js
options: {
  user: 'regular',            // 'regular' (default) | 'empty' (signed in, no data) | 'new' (signed out, fresh install)
  rpc: {
    my_league: (args, F) => ({ ...F.league, total: [] }),   // replace one RPC result (value or function)
  },
  tables: { profiles: [] },   // replace a REST table read (here: no profile yet -> pick a username)
  storage: { 'pushupcounter.goal.v1': null },   // set or clear a local storage key on first launch
},
```

**To add fixture data**, add it to `build()` in `mock/fixtures.js`, return it, and serve it from
`rpcDefaults` (RPCs) or `tables` (REST reads) in `mock/backend.js`. RPCs the mock doesn't know
return `null`, and unknown tables return no rows. The shapes mirror what
`src/backend/*Client.ts` and `src/battles/api.ts` read. When a backend change alters a shape,
update the fixture, or that screen will render empty or broken in the preview.

## Adding a flow

Create `tools/preview/flows/<name>.js`. It's picked up automatically:

```js
// Short description of what this flow shows.
module.exports = {
  order: 9,                                   // position in `all` and in `run flows`
  description: 'Goal sheet from Settings',
  options: { user: 'regular' },               // see "The mock backend"
  run: async ({ shot, tap, back, waitFor, pause, sim, doReps, has, page }) => {
    await tap('You', { last: true });         // by visible text; { last: true } = the last match
    await tap('Settings', { label: true });   // by accessibility label (icon buttons)
    await tap('Daily goal', { wait: 1500 });  // wait after the tap (default 1200 ms)
    await shot('goal-sheet');                 // -> 01-goal-sheet.png
  },
};
```

Helpers: `shot(name)` saves a numbered screenshot. `tap(text | /regex/, { label, last, wait })`
taps a control. `waitFor(text | /regex/, ms)` waits for text to appear. `pause(ms)` waits.
`has(text)` checks whether text is on screen. `back()` goes back like the back gesture. `sim.*` drives the sensors, `doReps(n, periodMs)`
does push-ups and checks the count, and `repCount()` reads the set screen's count. `page` is the
Playwright page for anything else. Every flow is recorded unless it sets `video: false`. A flow
fails after 2 minutes (set `timeoutMs` for longer ones).

Tips:

* Tabs stay mounted on the web, so text from a hidden tab can still match. `{ last: true }`
  usually picks the visible one, and a screen title is a safer target than body text.
* Prefer accessibility labels for icon buttons (`Settings`, `Close`, `New challenge`, `Share`).
  Adding a missing `accessibilityLabel` to the app is a real accessibility fix, not test code.
* To find what's on screen, run the flow with a `console.log(await page.evaluate(() => document.body.innerText))`.

## Tests and CI

`tools/preview/__tests__/` runs with the normal `npm test` (and in CI's `checks` job). It checks
that the simulator's push-ups are counted exactly by the real `RepDetector`, that the flat, lean
and tilt angles sit on the right side of the app's limits, that every swapped file and stand-in
exists, that the swaps apply to web builds only, and that no app file imports `tools/preview`.

The browser captures themselves are **not** run in CI. They need Chromium and ffmpeg and take
minutes, and their timing depends on the machine, so they would make the required `checks` job
slower and flaky. Run them locally, or in an agent's sandbox, when a change touches UI.

## Troubleshooting

* **"Preview tools are not installed"**: run `npm --prefix tools/preview run setup`.
* **"Could not start Chromium"**: install Chrome, run the `install chromium` command above, or set
  `PREVIEW_CHROME`.
* **A flow can't find a button**: the copy probably changed. Open `zz-failed.png` in that flow's
  folder, then update the flow.
* **"Expected the app to count N reps"**: rep counting or the session screen changed. Watch the
  flow's `.mp4`, and check it on a phone.
* **The app shows "This iPhone can't count reps"**: the preview build didn't apply the swaps. Run
  `npm --prefix tools/preview run build` again and read `tools/preview/out/build.log`.
* **Outside requests**: set `PREVIEW_DEBUG=1` to log the hosts the driver blocked.

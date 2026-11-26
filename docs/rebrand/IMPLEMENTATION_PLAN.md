# Rep Royale · Direction A implementation plan (code-grounded)

Base: `origin/dev` @ `bd1fced` (Merge PR #30, 2026-11-25 16:22 EST). Read-only review of the real code:
`App.tsx`, `src/navigation/RootNavigator.tsx` (987 lines: all routes, linking, app state, goal/nudge sync, local reminder),
every screen in `src/screens/**`, `src/components/**`, `src/theme.ts`, `src/session/useSession.ts`, `src/core/**`,
`src/progress/**`, `src/backend/**`, `src/battles/**`, `src/storage/**`, `src/notifications/prompt.ts`,
`modules/pushup-sensors` (Swift + TS), `app.json`, `app.config.ts`, `eas.json`, `.github/workflows/*`, `.eas/workflows/*`,
`scripts/eas-ship.sh`, `docs/RELEASING.md`, `__tests__/*` (24 suites) and the Supabase RPCs the app calls
(`my_progress`, `my_league`, `my_challenges`, `create_challenge`, `my_friends`, `friend_challenge_record`, `my_recap_ranks`, ...).

Spec: the Page "Rep Royale UI/UX audit & rebrand" (30 flow frames, 15 empty states, Today/Compete/You, dark only,
no haptics, keep face centering + live depth chart, no rep-by-rep, no Depth/Tempo/Form, skippable goal, iOS 26,
regular SF Pro Display Bold counter, empty-state rules).

## Progress

Updated 2026-11-26, 9:35 AM ET (America/New_York). The status column in §6 is the source of truth; this section keeps the notes.

| PR | Status | Link | Notes |
|---|---|---|---|
| test(db) flaky goal-close date | **Merged** | [#33](https://github.com/jackroseman/pushup-counter/pull/33) | Test file only (`supabase/tests/cases.mjs`); no backend logic. Merged first (`9a3518e`). |
| 1 · Tokens + primitives | **Merged** | [#31](https://github.com/jackroseman/pushup-counter/pull/31) | `src/ui/` tokens + all §1 components; `theme.ts` shim; `tokens.test.ts`. Merged (`a23503e`); `eas-ship` published development OTA `115abe8d-8012-4e7f-b4be-f897302ea2f4` (`115abe8d`) compatible with build `5a744b28`. |
| Docs (plan + frames in `docs/rebrand/`) | **Merged** | [#32](https://github.com/jackroseman/pushup-counter/pull/32) | Committed plan, 30 frames, 15 empty states, and README (`a5ca017`). |
| 2 · Copy + removals | **Merged** | [#34](https://github.com/jackroseman/pushup-counter/pull/34) | Removed `Settings.haptics` + `Haptics.impactAsync` (package stays until PR 4); `src/progress/format.ts` friendly dates; `"N to go"` replaces `usualLine`; `celebrate()` returns `{kind, value}` (with `first_set`); removed backend-logic copy (`LEAGUE_ABOUT`, `WEEK_LINE`, challenge rules, `"Tap for analysis"`, goal streak-history note); `End set` changed to `secondary`. Fingerprint unchanged; review screenshots in `rebrand/review-assets` (`pr2/`).. Merged (`c329b1e`); `eas-ship` published development OTA `b5ecb847-fc1b-4783-a894-5b723abcd43e` (runtime `4b5c2e60…`, build `5a744b28`). |
| 3 · Navigation shell | **Merged** | [#35](https://github.com/jackroseman/pushup-counter/pull/35) | Routes in `src/navigation/routes/`; Today / Compete (League + Challenges segments) / You tabs; Account → Settings, History → AllSets with native headers; root `SafeAreaView` removed; linking keeps every old path (`getStateFromPath` table in `linking.test`). `NATIVE_TABS = true` (native iOS tab bar; JS fallback on web/Android). Fingerprint unchanged. Merged (`8789c4f`); `eas-ship` published development OTA `b6e98641-244c-4766-9880-7ab4c2f3746f` (runtime `4b5c2e60…`, build `5a744b28`). |
| 4 · Native | **Merged** | [#36](https://github.com/jackroseman/pushup-counter/pull/36) | iOS 26.0 target; datetimepicker 9.2.1, expo-symbols, **expo-font** (required peer of expo-symbols); expo-haptics removed; FaceMeshView `variant` + `isFaceMeshVariantSupported()`; notification colour `#FFFFFF`; 1.3.0; **RR app icon** (`assets/icon.png`, 1024×1024 RGB, no alpha) and Android adaptive-icon background `#000000`; **`expo-splash-screen`** with `backgroundColor` `#000000` and no image. Fingerprint `c3f1457f593cc8acf58ea69cad24db10827f2d44`. Merged (`5eb58f7`); `eas-ship` started exactly one development build `49b3c09f-1bb9-48cf-9dbb-81a73a2d612b` (FINISHED, Xcode 27.1). Development OTA `0861d424-2104-4d41-b845-b2632367f2b6` published by hand after the build (`build-dev.yml` does not publish an OTA). |
| 5 · Today | **Merged** | [#38](https://github.com/jackroseman/pushup-counter/pull/38) | TodayScreen rewrite (frames 4, 13, E1–E3); leftover Today Account link removed. Merged 25 Nov 2026, 10:49 PM ET (`0e89e71`); `eas-ship` published development OTA `1aaf10f7-1931-4934-97b0-172de3bbd49f`. |
| 6 · First run + goal sheet | **Merged** | [#42](https://github.com/jackroseman/pushup-counter/pull/42) | Welcome, GoalPick with Skip, HowItWorks, onboarding gate, GoalSheet; HowToSheet deleted. Merged 25 Nov 2026, 10:51 PM ET (`6fb59bc`); development OTA `911e2fa6-25db-4658-966f-3a3c65d98e51`. |
| 7 · Set flow | **Merged** | [#40](https://github.com/jackroseman/pushup-counter/pull/40) | Frames 6–10: lay flat, face centering, 3-2-1, counting, phone moved. Merged 25 Nov 2026, 11:06 PM ET (`349748c`). No dedicated OTA (`eas-ship` superseded; landed in #45 OTA `98e92f0f-902a-467e-978d-dc2e43f707d7`). Later fixes: #47, #48, #49, #51, #52. |
| 8 · Summary, Set details, All sets | **Merged** | [#41](https://github.com/jackroseman/pushup-counter/pull/41) | Frames 11, 12, 15, E4, E7. Merged 25 Nov 2026, 11:07 PM ET (`62372f2`). No dedicated OTA (superseded; landed in #45 OTA `98e92f0f-902a-467e-978d-dc2e43f707d7`). |
| 9 · League | **Merged** | [#37](https://github.com/jackroseman/pushup-counter/pull/37) | Podium, your row, gap, countdown, Total/Improvement, (i) scoring, E8/E9. Merged 25 Nov 2026, 11:05 PM ET (`8aa744d`). No dedicated OTA (superseded; landed in #45 OTA `98e92f0f-902a-467e-978d-dc2e43f707d7`). |
| 10 · Challenges list + detail | **Merged** | [#43](https://github.com/jackroseman/pushup-counter/pull/43) | Grouped list, inline Accept/Decline, detail, ••• menu, result + Rematch; banner removed. Merged 25 Nov 2026, 11:05 PM ET (`b644bb5`). No dedicated OTA (superseded; landed in #45 OTA `98e92f0f-902a-467e-978d-dc2e43f707d7`). |
| 11 · New challenge | **Merged** | [#44](https://github.com/jackroseman/pushup-counter/pull/44) | formSheet with kind tiles, friends, Length; no metric; E12. Merged 25 Nov 2026, 11:08 PM ET (`f20de3c`). No dedicated OTA (superseded; landed in #45 OTA `98e92f0f-902a-467e-978d-dc2e43f707d7`). |
| 12 · Friends + invite | **Merged** | [#45](https://github.com/jackroseman/pushup-counter/pull/45) | Friends, Friend, invite share text, E13/E14. Merged 25 Nov 2026, 11:08 PM ET (`249e4cf`); development OTA `98e92f0f-902a-467e-978d-dc2e43f707d7` (also carries superseded #37, #40, #41, #43, #44). |
| 13 · You + Settings | **Merged** | [#39](https://github.com/jackroseman/pushup-counter/pull/39) | You home (frames 14, E5, E6) and grouped Settings + Daily reminder (frames 29, 30, E15). Merged 25 Nov 2026, 11:07 PM ET (`fa0ad4b`); development OTA `39919ae7-3cad-44c7-b2a3-e9517631da8a`. Save buttons landed later in #50. The SF Symbols `Icon.tsx` swap landed in #58. |
| Follow-up · Start a set on pending challenges | **Merged** | [#46](https://github.com/jackroseman/pushup-counter/pull/46) | Start a set was missing on pending most-reps, streak and team challenges. Merged 25 Nov 2026, 11:34 PM ET (`382bbb5`). No dedicated OTA (superseded; landed in #48 OTA `3dea3f96-0d10-4bfb-b6b6-73154f99d511`). |
| Follow-up · HowItWorks (i) and tsc | **Merged** | [#47](https://github.com/jackroseman/pushup-counter/pull/47) | Fixed the HowItWorks (i) crash, face centering stuck on Face not found, and a dev tsc error. Merged 25 Nov 2026, 11:31 PM ET (`7c668c1`); development OTA `05d39a56-6f2d-4947-b209-0ebcf3e75aee`. |
| Follow-up · Remove Start now | **Merged** | [#48](https://github.com/jackroseman/pushup-counter/pull/48) | Removed the unreachable Start now button from the lay-flat screen (advances automatically when the phone is flat). Merged 25 Nov 2026, 11:35 PM ET (`e219c68`); development OTA `3dea3f96-0d10-4bfb-b6b6-73154f99d511` (also carries superseded #46). |
| Follow-up · Face diagnostics | **Merged** | [#49](https://github.com/jackroseman/pushup-counter/pull/49), [#51](https://github.com/jackroseman/pushup-counter/pull/51) | Temporary diagnostics to investigate “face not found”. **Resolved: no regression.** ARKit face tracking needs some light; the 1.2.0 App Store build behaves the same in the dark. The 4-second restart (which kept resetting face tracking) was removed in #51. #49 merged 25 Nov 2026, 11:51 PM ET (`b473c14`), OTA `c22febca-b723-4d03-84fd-b804b2940134`. #51 merged 26 Nov 2026, 12:01 AM ET (`fc23a47`), OTA `867a5f4d-e146-43b0-b71d-0dc5932946e7`. Diagnostics and test switches were removed in #52. |
| Follow-up · Settings Save buttons | **Merged** | [#50](https://github.com/jackroseman/pushup-counter/pull/50) | Save buttons that stay grey until something changes on Daily reminder, Quiet hours, Profile and the goal sheet; a Discard changes? prompt; instant toggles on the main list. Merged 25 Nov 2026, 11:58 PM ET (`a7b5610`); development OTA `ad25f30f-0f39-4cbf-93c8-b4bccb39789a`. |
| Follow-up · Cleanup (part of PR 15) | **Merged** | [#52](https://github.com/jackroseman/pushup-counter/pull/52) | JS-only (fingerprint `c3f1457f593cc8acf58ea69cad24db10827f2d44`). Removed all dev-only code: the set-flow DEV diagnostics line and its tap toggle, the `[stop motion now]` / `[next sets: no motion]` switches and the motion-skip path, and the debug counters from #49/#51; the 4-second restart stays removed. Dead code removed: `src/progress/form.ts` (`formScoreForReps`, `formatFormScore`), `celebrationText`, `contributionFor`, `contributionLine`, `chartCeiling`, `components/SignInCard.tsx`, `components/progressChart.tsx`, legacy `Stat`, and BrandMark's 28 pt tile variant. Big numerals no longer clip at the top on iOS (see decisions). Lay-flat copy trimmed to “Lay your phone flat”. RR logo removed from Today. New shared `TabHeader` for Today / Compete / You. Merged 26 Nov 2026, 8:02 AM ET (`2bcafaf`); development OTA `394f753b-948d-4a01-8e4d-de80be94ccd4`. |
| 14 · Motion | **Merged** | [#60](https://github.com/jackroseman/pushup-counter/pull/60) | JS-only (fingerprint `c3f1457f593cc8acf58ea69cad24db10827f2d44`). Button press (0.98, 120 ms, already in), Today ring fill 600 ms, count roll 180 ms (set counter, Today count, 3-2-1 digits), 3-2-1 ring sweep, level lock, summary badge fade, phone-moved fade. Reduce Motion → crossfades (see decisions). Merged 26 Nov 2026 (`ebf512e`). |
| 15 · Cleanup + release | **Cleanup done, release pending** | Dead-code cleanup in [#52](https://github.com/jackroseman/pushup-counter/pull/52); remaining cleanup (theme shim, unused exports, lint cap, README/docs) is in [#61](https://github.com/jackroseman/pushup-counter/pull/61). | `theme.ts` shim removed (callers use `src/ui/tokens`). Leftover `components/Ring.tsx` deleted (`src/ui/Ring` is the real one). `components/ui.tsx` was already removed in #56. Lint cap lowered 26 → 16. README and docs rewritten for the current app, workflow and design. Unused exports removed (see [#61](https://github.com/jackroseman/pushup-counter/pull/61)). `scoreLabel` and `BattleMetric` kept (risk 8: 1.2.x clients can still create Depth/Tempo/Form challenges). Fingerprint unchanged. The `dev` → `main` release and the one approved production build of 1.3.0 are **not** in this PR; they wait on an explicit go. |
| Follow-up · SF Symbols `Icon.tsx` | **Merged** | [#58](https://github.com/jackroseman/pushup-counter/pull/58) | JS-only (fingerprint `c3f1457f593cc8acf58ea69cad24db10827f2d44`). `Icon` renders `expo-symbols` `SymbolView` on iOS (weight medium) and keeps the SVG set as the web/Android fallback. Native tab bar icons were already SF Symbols (`flame` / `crown` / `person.crop.circle`). Screenshots: `rebrand/review-assets` › `icons/`. Merged 26 Nov 2026 (`4c204aa`). |
| Follow-up · Gate eas-ship on green CI | **Merged** | [#59](https://github.com/jackroseman/pushup-counter/pull/59) | `eas-ship.yml` is a reusable workflow started by CI only after `checks` pass on that SHA. `should-ship` ignores docs, tests, `supabase/` and `.github/`. A ship skips if the SHA is no longer the branch tip. Live on `dev`; `main` keeps ship-on-push until the next `dev` → `main` release. Merged 26 Nov 2026 (`bf2abf6`). |

**Remaining**

- PR 15 release only: the `dev` → `main` release and the one approved production build of 1.3.0, on an explicit go. Cleanup itself is in [#61](https://github.com/jackroseman/pushup-counter/pull/61) (and earlier in #52 and #56).

**Decisions from PR 1 review (Sunny, 2026-11-25, America/New_York):**
1. **Shallow stays graphite** in the shim (the plan mapping). The near-invisible Shallow number on today's Set analysis and the in-set badge are dev-only; they go away when PRs 7/8 rebuild those screens.
2. **Splash and notification colour go in PR 4** (native): splash `backgroundColor` `#000000`, expo-notifications `color` `#FFFFFF` (today: navy `#0B0F1A` / amber `#FFB020`). Changing them now would change the fingerprint.
3. **Mockups win on two token values:** the ring track is 12 % white (`rgba(255,255,255,0.12)`), not graphite; caption is 12/400, not 12/500. The code already used the mockup ring track; the caption token is 400 in #31.
4. **`Countdown`** is the 3-2-1 Get ready ring (frame 8). The league "ends in 4d 7h" label is plain text in PR 9.
5. **Flaky `test:db` case** "switching on a later day closes yesterday": test-file-only fix, no backend logic. Fixed in [#33](https://github.com/jackroseman/pushup-counter/pull/33) and cherry-picked onto #31 and #32 so evening CI can pass before #33 merges. The assertion now compares `ended_on` to today in the profile time zone (user D is Europe/Paris by that point in the suite), not to JavaScript's America/New_York date via UTC `isoDate()`.

**Decisions from PR 3 review (Sunny, 2026-11-25, America/New_York):**
1. **Native tabs ship on in PR 3** (`NATIVE_TABS = true` in `src/navigation/tabs.ts`). A brief had put them in PR 4; the plan is the source of truth. This is JS-only (already-installed `react-native-screens` Tabs), so the fingerprint is unchanged and flipping the flag remains an OTA. Web and Android still use the JS tab bar. The full Liquid Glass look arrives with the PR 4 iOS 26 SDK build.
2. **Today's leftover "Account" link stays until PR 5**, which removes it. Frame 04 has no such link; Settings is reached from the You gear. In PR 3 the link already opens Settings.

**Decisions from PR 4 review (Sunny, 2026-11-25, America/New_York):**
1. **The RR app icon ships in this build.** Artwork from the brand board / frame 01 (`/workspace/design/pr4/icon-candidate-1024.png`): RR monogram under a thin three-point line, white on black. `assets/icon.png` is 1024×1024 RGB, no alpha (sRGB). Android adaptive-icon `backgroundColor` is `#000000`; the foreground and monochrome layers are the same mark on a transparent field (Expo placeholder layers replaced).
2. **The launch screen is explicitly black.** `expo-splash-screen` is added with `npx expo install` and configured `backgroundColor: '#000000'` with no image. (Without a splash config, the generated launch screen was already black via `systemBackgroundColor` in forced Dark mode; this makes the colour explicit and does not depend on the system colour.)

**Decisions from the cleanup PR (Sunny, 2026-11-26, America/New_York):**
1. **No dev-only code ships.** No diagnostics, debug switches or test hooks in screens. Kept on purpose: `app.config.ts` `APP_VARIANT` / `IS_DEV` (build and OTA variant), `expo-constants` / `expo-updates` metadata in `backend/identity.ts` (device registration), `TraceRecorder` (synced feature), `resetPushRegistrationCache` (backend test reset helper, not used by screens). No `__DEV__` checks remain in `src`.
2. **Deviation from frame 6 (lay flat):** the screen shows only the level (dial, crosshairs, target ring, dot) and the title "Lay your phone flat". The subtitle "Screen up, on the floor under your chest." and the "Tilt closer to center" pill are removed (`levelHint` deleted).
3. **Big numerals:** a `lineHeight` below the font size clipped the top of the digits on iOS (Today ring count, 3-2-1 countdown, in-set counter, summary reps, You stats). Hero text now uses the full line height (`heroLineHeight` = 1.19 × size) and negative margins (`heroTrim`) for the same 0.92 box, so size and position match the mockups. The in-set counter uses the same fix.
4. **Deviation from frame 4 (Today):** the RR monogram above "Today" is removed to save vertical space. The streak chip sits on the right of the title row.
5. **Tab titles line up:** Today, Compete and You use one `TabHeader` (`src/ui/TabHeader.tsx`): 8 pt below the top safe area, 44 pt title row, screen gutter inset, `largeTitle` 34/700, actions on the right of the title row, optional subtitle 2 pt under it (Today's date). Compete was 34/800 at 12 pt; Today and You had a 44 pt nav row above the title. **Deviation:** the You gear and the Compete actions sit in the title row rather than a separate nav row.

**Decisions from the motion PR (PR 14, JS-only, 2026-11-26, America/New_York):**
1. **Built-in `Animated` only.** No new packages. Opacity and `translateY` use the native driver; the SVG pieces (Today ring, 3-2-1 ring, level lock) use a small JS-driven tween (`useTween`) because `react-native-svg` props can't use the native driver. None of them run while reps are being counted.
2. **One Reduce Motion switch.** `src/ui/motion.ts`: `useReduceMotion` (`AccessibilityInfo.isReduceMotionEnabled` read at import, `reduceMotionChanged` listener) and `motionSpec(kind, reduced)`. Reduced: no scale, slide or sweep; rolls, level lock and fades are 200 ms crossfades; the ring fill and the 3-2-1 sweep jump (the Today ring crossfades in); button press dims to 70 % instead of scaling.
3. **Count roll never clips.** `RollingNumber` slides and fades the old and new number without any `overflow` mask, so the #52 full line height and negative margins still apply. The new number is on screen at once. No animation on first render.
4. **3-2-1 sweep:** the ring sweeps linearly through each second to the next step (3 → 2/3 → 1/3 → 0); the digit rolls on each tick.
5. **Level lock:** crossfade to green on both the target ring and the dot, with the green ring settling in from 8 pt larger (250 ms, ease-out, no bounce).
6. **Today animates when visible.** `TodayScreen` gets `active` (from `useIsFocused`); while Today is behind the set flow it keeps the last hero, so the ring fill and count roll play when you land back on it.
7. **Not animated (by design):** the live chart, face view, quality pill, progress bars, and anything in `useSession`.

## 0. What the code tells us (facts that shape the plan)

| Fact (file) | Consequence |
|---|---|
| Navigation is **React Navigation 7.21**, not expo-router: 4 JS bottom tabs + one native stack in `RootNavigator.tsx`; `headerShown: false` everywhere; root `SafeAreaView` in `App.tsx`. | Keep React Navigation. **No expo-router migration** (it would rewrite linking/push deep links for no user-visible gain). |
| `@react-navigation/bottom-tabs@7.21` ships `unstable/createNativeBottomTabNavigator` on top of `react-native-screens` Tabs (already a native dep, 4.30.1), with `sfSymbol` icons. | Native iOS tab bar (Liquid Glass when built with the iOS 26 SDK) needs **no new native package**. JS-only change, gated by one flag with a JS-tab fallback. |
| `@react-navigation/native-stack` is installed. | Native large-title headers, back chevron and swipe-back, and `presentation: 'formSheet'` sheets are JS-only. |
| No Reanimated, gesture-handler, expo-symbols, expo-glass-effect, @expo/ui or date picker installed. | Motion uses RN `Animated` (native driver for opacity/transform). Only two new native packages are needed: a time picker and SF Symbols. |
| `expo-haptics` is used in exactly one place (`useSession.onRep`), behind `Settings.haptics` (`storage/settings.ts`, Account › Haptics). `sanitizeSettings` drops unknown keys. | Removing haptics is a clean delete; old saved settings load fine. Removing the package is native, so it goes in the native PR. |
| `FaceMeshView.swift` draws its own labels (distance "FACE ↔ PHONE", state pill, angles, closest point, thermal) in blue/amber. Only `showAngles` is a prop. | The clean "Center your face" frame needs a small Swift change (`variant: 'minimal'`: no labels, white mesh, black background), in the native PR, plus a JS capability check like the existing `motionSupported()`. Until then: `showAngles={false}` plus a JS overlay. |
| iOS target is `16.4` (`app.json` expo-build-properties, `PushupSensors.podspec`). | Raise both to `26.0` in the native PR. |
| `create_challenge` does `coalesce(p->>'metric','rep_count')` and forces `rep_count` for timed sets. | Dropping Depth/Tempo/Form is **UI-only**: stop sending `metric`. |
| `my_league` builds members from all accepted friends with `coalesce(sum,0)`. | "Everyone at 0" on a new week needs no API change. |
| `my_challenges` returns open challenges + challenges finished in the last 30 days (limit 50). | Today's "your move" card and the Challenges list come from it. A lifetime head-to-head can't be rebuilt from it; only `friend_challenge_record` has that (per friend). |
| Daily local reminder is only scheduled when a goal has a target (`RootNavigator` reminder effect: `if (!target) return`). | Decided: no daily reminder without a goal. Keep this logic; no backend change. Settings replaces the time picker with one row, “Set a daily goal to get reminders”, that opens the goal sheet (E15). Today (E2) and You (E6) keep their quiet Set a daily goal prompts. |
| `celebrate()` (progress/today.ts) runs on **local** history only (`SummaryRoute`). | On a new phone a signed-in user can get a false "New best set". Fix client-side by merging `my_progress.sets` (`mergeWorkouts` already exists). |
| Push deep links from `supabase/functions/_shared/notificationContent.ts`: `pushupcounter://today`, `league`, `friends`, `challenge/<id>`, `invite/<token>` (plus `battle/<id>`). | New routes must keep these paths. Handled in the linking config; no server change. |
| CI (`ci.yml`): lint (max 26 warnings), jest, PGlite DB tests, tsc, `expo export` iOS. `eas-ship.yml`: on merge to dev, **OTA if a build has the fingerprint, else starts a dev build automatically**; main → production build only with a version bump. | Every PR except one must leave the native fingerprint unchanged, or it costs a build. All native changes go in **one PR**. |
| `dev` is already ahead of `main` with native changes (tilt/Core Motion module API, SDK 58 alignment `e6fc4c5`). | Production needs a new build anyway. **Don't release dev→main until the redesign's native PR has landed**, so one production build covers both. |
| Tests are pure-logic Jest suites (no RN rendering library). | Put every screen decision (empty states, ranks, gaps, grouping) in pure view-model functions under `src/progress` / `src/battles` / `src/ui/models`, and unit-test those. |

## 1. Design system: tokens and components (where they live)

New folder `src/ui/` (JS only). `src/theme.ts` becomes a temporary shim that re-exports the new palette under the old names, so unchanged screens go monochrome on day one; it's deleted in the cleanup PR.

**`src/ui/tokens.ts`**
- `color`: bg `#000000`, surface `#111113`, elevated `#1C1C1E`, graphite `#2C2C2E`, separator `rgba(255,255,255,0.10)`, label `#FFFFFF`, secondary `rgba(235,235,245,0.60)`, tertiary `rgba(235,235,245,0.30)`, signal `#30D158`, destructive `#FF453A`; `quality`: full = signal, good = label, shallow = graphite; ring track `rgba(255,255,255,0.12)` (12 % white, from the mockups, not graphite).
- `type` (system font = SF Pro; iOS switches to SF Pro Display at 20 pt and up): largeTitle 34/700, title1 28/700, title2 22/700, headline 17/600, body 17/400, subhead 15/400, footnote 13/400, caption 12/400; `hero` 28–150/700 `fontVariant: ['tabular-nums']`; **`counter` 180/700 tabular-nums, letterSpacing -4 (regular SF Pro Display Bold, no condensed face, no font files)**.
- `space` 4/8/12/16/20/24/32; `radius` tile 8, segmented 9, list 14, card 16, sheet 34, capsule 999; `hit` 44.
- `motion`: press 120 ms, standard 200–300 ms, ring 600 ms; easing `Easing.out(Easing.cubic)`; no bounce.

**Components (`src/ui/*.tsx`)**: `Text` (variants), `Button` (primary white / gray / tinted / plain / destructive-text, 56 pt capsule, Animated press scale 0.98), `IconButton` (circular nav-bar actions), `Icon` (`expo-symbols` `SymbolView` on iOS; SVG fallback on web/Android), `Card`, `ListGroup` + `ListRow` (icon tile, value, chevron, switch), `Segmented` (JS), `Pill` / `QualityPill` / `StreakChip`, `Avatar` (initials on graphite; "you" in white), `ProgressBar`, `Ring` (moved from `components/Ring.tsx`; white stroke on a 12 % white track, green + check when done), `WeekStrip`, `StatTile` (records grid), `FormSplitBar` (full/good/too shallow), `Podium`, `LeaderRow`, `EmptyState`, `Screen` (safe area + scroll + large title when not using the native header), `Countdown` (the 3-2-1 Get ready ring on frame 8; the league "ends in" label is plain text in PR 9).
Charts: restyle `components/charts.tsx` (`DistanceChart`/`LiveDistanceChart`: white line, green Full band, Top/Good/Full labels, no rep tick lines) and `components/progressChart.tsx` (weekly bars, today highlighted). `RepChart` goes away with rep-by-rep.

Dark only: `userInterfaceStyle: "dark"` already. Keep it; no light tokens.

## 2. Navigation and route changes

Current: `Stack(Main = Tabs(Today, Progress, League, Challenges), GoalSetup, Session, Summary, History, Account, ProfileSetup, Battle, NewBattle, Friends, Friend, Invite)`.

New (still React Navigation, `src/navigation/`; routes move out of the 987-line file into `src/navigation/routes/*.tsx` while app state stays in `RootNavigator`/`AppStateContext`):

```
Stack
├─ Onboarding: Welcome → GoalPick (Skip) → HowItWorks      (shown once; existing users skip)
├─ Main = NativeTabs
│   ├─ Today
│   ├─ Compete { segment?: 'league' | 'challenges' }      (League + Challenges merged)
│   └─ You                                                (records, milestone, recent sets; gear → Settings)
├─ GoalSheet            (formSheet; was GoalSetup)
├─ Session              (gestureEnabled: false; phases: placing → calibrating → locked → active)
├─ Summary              (just-finished set; phone-moved variant)
├─ SetDetails           (new; was the analysis half of Summary)
├─ AllSets              (was History)
├─ Settings             (was Account) → DailyReminder
├─ ProfileSetup         (username)
├─ Challenge            (was Battle) · NewChallenge (formSheet; was NewBattle) · Invite
└─ Friends → Friend · InviteFriends (Share sheet)
```

Linking (`linking.config`, keep every existing path): `''`/`today` → Today; `league` → Compete{league}; `challenges`/`battles` → Compete{challenges}; `progress` → You; `history` → AllSets; `account` → Settings; `friends`; `challenge/:challengeId` + alias `battle/:challengeId`; `invite/:token`. `backend/linking.ts` `parseAppLink` doesn't change. Remove the `App.tsx` root `SafeAreaView` (native tabs and large titles handle insets; screens without a header use `useSafeAreaInsets`).

Tab icons: `sfSymbol` `flame` / `crown` / `person.crop.circle` (no new package). Fallback: `const NATIVE_TABS = true` in `src/navigation/tabs.ts`; if the unstable navigator misbehaves on device, flip to JS `createBottomTabNavigator` with SVG icons (no build either way).

## 3. Frame → code mapping (reuse / restyle / new / delete) and data

| # | Frame | Code | Action | Data (all existing) |
|---|---|---|---|---|
| 1 | Welcome | `screens/onboarding/WelcomeScreen.tsx` | New | `auth.signInWithApple` for "I already have an account" |
| 2 | Pick a daily goal (Skip) | `onboarding/GoalPickScreen.tsx` + `ui/GoalPicker.tsx` extracted from `GoalSetupScreen` | New + extract | `PROGRAMS`, `CUSTOM_GOAL`, `saveChoice` → `enroll_goal` (signed in) / AsyncStorage |
| 3 | How it works | `onboarding/HowItWorksScreen.tsx` | New (replaces `HowToSheet`) | `progress/howto.ts` (copy rewritten), `HOWTO_KEY` |
| 4 | Today | `TodayScreen.tsx` rewrite; `routes/TodayRoute.tsx` | Rewrite | `buildToday` / `signedInViews` (`my_progress`); `fetchMyLeague` + `loadLeagueCache` (`my_league`); `api.myBattles` + `groupBattles` + `battleCache` (`my_challenges`); week strip from `ProgressModel.day` / `charts.day` |
| 5 | Goal sheet | `GoalSetupScreen.tsx` → `GoalSheet.tsx` (formSheet) | Restyle | `enrollments`, `saveChoice` |
| 6 | Lay your phone flat | `SessionScreen` placing + `components/level.tsx` | Restyle | `state.level` (`TiltMonitor`) |
| 7 | Center your face | `session/FaceCentering.tsx` (FaceMeshView + overlay) replaces `CalibrationPanel` UI | New view over existing logic | `state.guide` (`CalibrationGuide`: pose checks, `progress`, `message`), `state.flatCheck` |
| 8 | Get ready 3-2-1 | `SessionScreen` locked | Restyle (drop "TOP LOCKED · cm") | `state.countdown`; keep `recalibrate` as a quiet "Start over" |
| 9 | Counting | `SessionScreen` active + `charts.LiveDistanceChart` | Restyle: counter = `type.counter`; quality pill; live depth chart; gray End set; drop Chart/Face toggle and indicators | `state.count`, `state.lastRep`, `live` ref; "N to beat X" from the route `battle` + `rememberedBattle()` |
| 10 | Set ended (phone moved) | `SummaryScreen` variant when `record.endReason === 'tilt'`; `BattleScreen` `justPlayed.phoneMoved` | Restyle | `SessionRecord` |
| 11 | Set complete · new best | `SummaryScreen` rewrite; `SummaryRoute` | Rewrite | `phoneCountedReps`, `celebrate()` → structured `{kind, value}`, `buildToday` (goal progress), `FormSplitBar` from `record.reps`, challenge row from `battleCache` |
| 12 | Set details | `SetDetailsScreen.tsx` | New (from Summary's analysis half) | `analyzeSet` aggregates (avg depth, consistency, pace, tempo trend, split) + `DistanceChart` for the whole set. No per-rep table/charts |
| 13 | Today · goal done | `TodayScreen` | Same screen, done state | `ringProgress >= 1` |
| 14 | You | `YouScreen.tsx` (replaces `ProgressScreen`) | New | `useIdentity().profile`; `ProgressModel` / `my_progress` records, badges, `longestStreak`; last 3 from `historyStore` |
| 15 | All sets | `AllSetsScreen.tsx` (replaces `HistoryScreen`) | Rewrite | `historyStore` (cap 200) + `ProgressModel.day/week`; Clear history moves to Settings |
| 16 | Compete · signed out | `CompeteScreen.tsx` + `compete/SignedOut.tsx` (from `LeagueScreen` signed-out branch) | Restyle | `useBackend().session`, `signInWithApple` |
| 17 | Pick a username | `ProfileSetupScreen.tsx` | Restyle | `username_available`, profiles upsert |
| 18 | Compete · League | `compete/LeagueView.tsx` (from `LeagueScreen`) | Rewrite | `my_league` (`LeagueBoard.total/improvement`, `weekEnd`, `timeZone`) |
| 19 | League · no friends | `LeagueView` empty | Restyle | `board.total.length <= 1` |
| 20 | Compete · Challenges | `compete/ChallengesView.tsx` (from `BattlesScreen`) | Rewrite; inline Accept/Decline; no notification banner | `my_challenges`, `groupBattles`, `api.respond` |
| 21 | New challenge | `NewBattleScreen` → `NewChallengeSheet.tsx` (formSheet) | Restyle; **delete "What wins"**; kind tiles; Length segmented | `api.friends`, `api.createBattle` (no `metric`), `appSettings.asyncBattleDefaults` |
| 22 | Turn on notifications | `components/NotificationPrompt.tsx` (`ChallengeNotifications` sheet) | Restyle; only surface = sheet after the first create/accept/join | `notificationSurface`, `register_push_token` |
| 23 | Challenge · your move | `BattleScreen.tsx` → `ChallengeScreen.tsx` | Restyle; ••• menu (`ActionSheetIOS`) for Cancel/Leave + invite link | `my_challenges(p_battle)`, `cancel_challenge`, `create/revoke_invite_link` |
| 24 | Challenge invite | `ChallengeScreen` invited state + `InviteScreen` | Restyle | `api.respond`, `invite_preview`, `redeem_invite` |
| 25 | Challenge result | `ChallengeScreen` finished state | Restyle + Rematch | participants `rank/isWinner`; Rematch opens NewChallenge with `friendIds` + kind/length prefilled → `create_challenge` |
| 26 | Friends | `FriendsScreen.tsx` | Restyle; one tap target per row | `my_friends`, `search_users`, `respond_friend_request`; row subtitle = this week's reps from `my_league` (see §5 #12) |
| 27 | Friend | `FriendScreen.tsx` | Restyle | `friend_challenge_record`, `my_league` |
| 28 | Invite friends | `InviteFriends` = RN `Share.share` | New (no screen) | message with the App Store link + "@username" (no friend-invite token API exists) |
| 29 | Settings | `AccountScreen` → `SettingsScreen.tsx` | Rewrite as grouped list; drop Haptics; "Back up now" → status row; Clear history here | `useIdentity` (sync, push, signOut, deleteAccount), `Settings`, `NudgePrefs` |
| 30 | Daily reminder | `DailyReminderScreen.tsx` (from `ReminderCard`) | New; native time picker (after native PR). Only shown when a daily goal is set. | `NudgePrefs` ↔ `notification_prefs`, `nextLocalReminder` |

Empty states (pure rules in `src/ui/models/*.ts`, unit-tested):

| # | State | Rule (data) |
|---|---|---|
| E1 | Today day one | no local or server sets → hide streak chip, challenge card, week strip; show How it works link and the "Better with friends" card |
| E2 | Today no goal | `view.target == null` → count without ring, quiet "Set a daily goal" pill; no streak chip or week strip |
| E3 | Nothing yet today | sets exist, `reps === 0` today → no streak chip if 0; league card copy from the board; compact "Challenge a friend" row |
| E4 | First set | `celebrate` → `{kind:'first_set'}` when the merged history has 1 set |
| E5 | You no sets | `ProgressModel.empty` → one card replaces records + recent; First milestone 0/100 |
| E6 | You no goal | no enrollments → omit the streak tile; "Set a daily goal" row |
| E7 | All sets empty / quiet week | `history.length === 0`; or 0 this week → chart shows 0 and the list starts at the last active day |
| E8 | League new week | every `total.reps === 0` → starting-line rows, "Be the first on the board" |
| E9 | You haven't started | `me.reps === 0`, others > 0 → pinned row with the gap to the next person |
| E10 | No challenges | all `groupBattles` groups empty |
| E11 | Challenges, no friends | `friends.length === 0` → Invite friends |
| E12 | New challenge, no friends | picker becomes an Invite row; Send disabled |
| E13 | Friends empty | no friends or requests → search stays; Invite with a link |
| E14 | Friend, no challenges | `FriendRecord.played === 0` → "No challenges yet" |
| E15 | Settings · no daily goal | No enrollments → Daily goal reads Not set; hide the reminder time picker and quiet hours; one row, “Set a daily goal to get reminders”, opens the goal sheet |

## 4. Dependencies

| Package | Kind | Why | Build? |
|---|---|---|---|
| `@react-navigation/bottom-tabs/unstable` (already installed 7.21) + `react-native-screens` Tabs (already installed) | existing | native tab bar, SF Symbol tab icons, Liquid Glass on iOS 26 | No |
| `@react-navigation/native-stack` (installed) | existing | large titles, formSheet sheets | No |
| RN `Animated`, `AccessibilityInfo`, `ActionSheetIOS`, `Share`, `Switch` | built in | motion, Reduce Motion, ••• menus, share, switches | No |
| `@react-native-community/datetimepicker` (`npx expo install`) | **new native** | native time picker (frame 30) | Yes (native PR) |
| `expo-symbols` (`npx expo install`) | **new native** | SF Symbols in rows and buttons | Yes (native PR) |
| `expo-font` (`npx expo install`) | **new native** (required peer of `expo-symbols`; found by expo-doctor in PR 4) | needed by `expo-symbols` | Yes (native PR) |
| `expo-splash-screen` (`npx expo install`) | **new native** (PR 4 decision: set the launch screen black explicitly) | `backgroundColor` `#000000`, no image | Yes (native PR) |
| App icon `assets/icon.png` + Android adaptive-icon `backgroundColor` `#000000` | native assets / config (PR 4 decision) | Brand RR monogram, white on black, 1024×1024 RGB, no alpha | Yes (native PR) |
| `expo-haptics` | **remove** (native) | no haptics at all | Yes (native PR) |
| iOS deployment target 26.0 (`app.json` expo-build-properties + `PushupSensors.podspec`) | native config | Liquid Glass baseline | Yes (native PR) |
| `modules/pushup-sensors` FaceMeshView `variant` prop + `isFaceMeshVariantSupported()` | native module | clean face-centering view | Yes (native PR) |
| Reanimated / worklets / gesture-handler / expo-glass-effect / @expo/ui / expo-router | **not added** | not needed for the spec; would add risk and native weight | — |
| `@testing-library/react-native` (optional, devDependency) | JS dev only | a few render smoke tests | No |

Every non-native PR's acceptance criteria include "native fingerprint unchanged": run `npx @expo/fingerprint .` on the PR head and on `dev`, or `scripts/eas-ship.sh development --dry-run` with a token, and the hashes must match.

## 5. Backend: default is no change. Every data gap, and how it's covered

| # | UI wants | Current API | Verdict |
|---|---|---|---|
| 1 | Today league card (rank, gap to next, avatars) every day | `my_league` (already used by League and Friend) | Derive. One more call on Today focus; use `loadLeagueCache` first. `my_recap_ranks` no longer needed on Today. |
| 2 | Today "your move" card | `my_challenges` + `groupBattles` | Derive (cache with `rememberBattles`). |
| 3 | Week strip with checks | `my_progress.charts.day` (14 days with targets) / local `buildProgress().day` | Derive. |
| 4 | Streak chip number | `my_progress.currentStreak` / local `streaks()` | Derive (add a numeric `streak` to `TodayModel`). |
| 5 | "28 to go" | `target - todayReps` | Derive; `usual/delta` simply go unused. |
| 6 | Records grid, lifetime, total sets | `my_progress.records`, `lifetimeReps`, `longestStreak`, `sets.length` / local | Derive. |
| 7 | Next milestone bar | `my_progress.badges` / local badges | Derive. |
| 8 | League podium, your row, "45 more to pass Jack", countdown to week end | `my_league.total`, `weekEnd`, `timeZone` | Derive. |
| 9 | New week, everyone at 0 | `my_league` already returns every accepted friend with 0 | Derive; detect all-zero on the client. |
| 10 | In-set "31 to beat Brett", post-set challenge progress | `Battle.participants` (cached) | Derive; the server stays the source of truth after upload. |
| 11 | "New best set" / "First set" without false positives on a new phone | `my_progress.sets` + local history | Derive with `mergeWorkouts` before `celebrate()`. |
| 12 | Head-to-head W–L on **every** Friends row | Only `friend_challenge_record(p_user)`, one call per friend | v1: show this week's reps from `my_league` on rows, and W–L on the Friend page. **Only real API candidate:** an additive, read-only `my_friend_records()` batch RPC, if Sunny insists on W–L per row. Not proposed now. |
| 13 | "Invite friends" personal link (frame 28) | Invite tokens exist only per challenge | v1: share text with the App Store link + "add me @username". A friend-invite token would be a backend feature, so it's out of scope. |
| 14 | Username availability while typing | `username_available` | Exists. |
| 15 | "Sets backed up" status row | `useIdentity().sync` | Exists. |
| 16 | Rematch | `create_challenge` with the same kind/length/friends | Derive. |
| 17 | Notification ask once | `notificationSurface` + `register_push_token` | Exists. |
| 18 | Deep links from pushes after the IA change | `notificationContent.ts` URLs | Keep all paths in the client linking config. No server change. |
| 19 | Daily reminder for users who skipped the goal | Local and server reminders already need a target | Decided: no reminder, no backend change. Settings shows E15 (“Set a daily goal to get reminders” → goal sheet). Today (E2) and You (E6) keep their quiet prompts. |

**Depth / Tempo / Form: UI-only.** Delete the "What wins" chips and the `metric` state in `NewBattleScreen`, and stop sending `metric` (the server defaults to `rep_count`). Keep `BattleMetric`, `scoreLabel` and the DB enum, columns and `battle_metric_value`, because challenges already created (and ones created from 1.2.x builds that still show the chips) must keep rendering. No migration. An optional later hardening (coerce `metric` to `rep_count` inside `create_challenge`) only matters if old clients creating those challenges becomes a problem. Not recommended now.

**Net: zero backend/API changes proposed.** No migrations, RPCs or edge-function changes; the `supabase/` tree stays untouched, so `supabase-deploy.yml` never runs.

## 6. PR breakdown (into `dev`, in order). OTA unless marked

Each PR has to pass CI (`lint --max-warnings 16` with the count never going up, `jest`, `test:db`, `tsc`, `expo export`), a native-fingerprint check (unchanged, except PR 4), and include before/after screenshots compared with the mockups. After a merge to `dev`, and only after that merge commit's `checks` job is green, eas-ship publishes an OTA to Pushup Dev (PR 4 started the approved dev build instead). Device checks are listed per PR; foundation PRs are tested on Sunny's phone before the next one starts.

| PR | Scope | Acceptance criteria | Tests | Ships | Status |
|---|---|---|---|---|---|
| 1 · Tokens + primitives | `src/ui/tokens.ts` + components in §1; `theme.ts` shim maps old names to the new palette (accent → white, card → surface, quality → full green / good white / shallow graphite) | App goes monochrome with no layout changes; no screen logic touched; fingerprint unchanged | token sanity (contrast ≥ 4.5 for label/secondary on bg and surface) | OTA | **Merged** · [#31](https://github.com/jackroseman/pushup-counter/pull/31) (OTA `115abe8d`) |
| 2 · Copy + removals | Remove haptics (`Settings.haptics`, Account row, `Haptics.impactAsync` call; package stays until PR 4); friendly dates helper; "N to go" replaces the usual line; `celebrate()` returns `{kind, value}`; remove backend-logic copy (`LEAGUE_ABOUT`, `WEEK_LINE`, challenge rules text, "Tap for analysis"); End set no longer red | No vibration anywhere; old settings JSON with `haptics` loads | update `history.test` (settings), `progress.test` (celebrate kinds), new `format.test` | OTA | **Merged** · [#34](https://github.com/jackroseman/pushup-counter/pull/34) · OTA `b5ecb847` |
| 3 · Navigation shell | Route files out of `RootNavigator`; native tabs Today/Compete/You with sfSymbols (flag + JS fallback); Compete = League + Challenges bodies under `Segmented`; You = Progress body; Account → Settings; History → AllSets; native headers; remove root `SafeAreaView`; linking map in §2 | Every old deep link and push URL lands on the right tab/segment; back/swipe works; no behavior change in data | extend `linking.test` with a `getStateFromPath` table for all paths | OTA (check native tabs on the current dev build) | **Merged** · [#35](https://github.com/jackroseman/pushup-counter/pull/35) · OTA `b6e98641` |
| 4 · **Native (the only build-changing PR)** | iOS target 26.0 (app.json + podspec); add `@react-native-community/datetimepicker`, `expo-symbols`, **`expo-font`** (required peer), **`expo-splash-screen`** (`backgroundColor` `#000000`, no image); remove `expo-haptics`; FaceMeshView `variant: 'minimal'` (Swift: hide labels, white 35% mesh, black background) + `isFaceMeshVariantSupported()` in TS (web stub too); bump `app.json` + `package.json` to **1.3.0** here (the app config feeds the fingerprint, so the bump rides the same build); expo-notifications `color` `#FFFFFF`; **RR app icon** (1024×1024 RGB, no alpha) and Android adaptive-icon background `#000000` | `expo-doctor` clean; `expo export` OK; fingerprint changes **once**; on merge `eas-ship` starts **1 dev build**; install on an iOS 26 iPhone: counting, tilt end, face mesh, notifications, Apple sign-in still work | `sensors` capability test with the module mocked | **Dev build #1 (approved)** | **Merged** · [#36](https://github.com/jackroseman/pushup-counter/pull/36) · build `49b3c09f` · OTA `0861d424` |
| 5 · Today | `TodayScreen` rewrite + `ui/models/today.ts` (league card, your-move, week strip, streak chip, day-one, no-goal, goal-done rules); **remove the leftover Today "Account" link** (PR 3 decision: leave it until this rewrite; frame 04 has none — Settings is the You gear) | Frames 4, 13 and E1–E3 match; no Account link on Today; one `my_league` + one `my_challenges` call per focus, cached | `todayModel.test` for every rule | OTA | **Merged** · [#38](https://github.com/jackroseman/pushup-counter/pull/38) · OTA `1aaf10f7` |
| 6 · First run + goal sheet | Welcome / GoalPick (Skip) / HowItWorks; `ONBOARDED_KEY`; existing users (`HOWTO_KEY` set or any history) skip; GoalSheet as formSheet; delete `HowToSheet` | Fresh install shows 1→2→3; Skip lands on the E2 Today; reinstalls with history skip | `onboarding.test` (gate) | OTA | **Merged** · [#42](https://github.com/jackroseman/pushup-counter/pull/42) · OTA `911e2fa6` |
| 7 · Set flow | Placing / FaceCentering / Get ready / Counting / phone-moved per frames 6–10; restyled live chart; counter `type.counter` (SF Pro Display Bold 180, tabular); "N to beat"; drop Chart/Face toggle and indicators; use `variant="minimal"` when supported | On device: a 20-rep set counts the same as before (same `useSession`); tilt ends the set; Redo/"Start over" works; VoiceOver reads the count | `sessionView.test` (to-beat, countdown labels) | OTA | **Merged** · [#40](https://github.com/jackroseman/pushup-counter/pull/40) · no dedicated OTA (in #45 OTA `98e92f0f`) |
| 8 · Summary, Set details, All sets | Summary per frame 11 + E4; SetDetails (aggregates only, no rep-by-rep); AllSets grouped by day + weekly chart; Clear history in Settings; `celebrate` on merged history | No per-rep table or charts anywhere; no false "New best" after reinstall + sign-in | `summaryModel.test`, `allSets.test` | OTA | **Merged** · [#41](https://github.com/jackroseman/pushup-counter/pull/41) · no dedicated OTA (in #45 OTA `98e92f0f`) |
| 9 · League | `LeagueView`: podium, your row, gap, countdown, Total/Improvement segmented, (i) scoring sheet, E8/E9/no friends | All-zero week shows the starting line; ties are stable | `leagueModel.test` | OTA | **Merged** · [#37](https://github.com/jackroseman/pushup-counter/pull/37) · no dedicated OTA (in #45 OTA `98e92f0f`) |
| 10 · Challenges list + detail | `ChallengesView` (your move / invites / in progress / finished, inline Accept/Decline); `ChallengeScreen` (header, who leads, ••• menu, result + Rematch); notification banner removed (sheet only) | Frames 20, 22–25 + E10/E11; accept/decline/cancel/invite-link flows unchanged against staging | extend `battles.test` (rematch params, view grouping) | OTA | **Merged** · [#43](https://github.com/jackroseman/pushup-counter/pull/43) · no dedicated OTA (in #45 OTA `98e92f0f`) |
| 11 · New challenge | `NewChallengeSheet` formSheet: kind tiles, friends, Length segmented, time limit; **no `metric` sent**; E12 | Created challenges are `rep_count` (check the row on staging); old-metric challenges still render | `challengeFromSet.test` + new create-payload test | OTA | **Merged** · [#44](https://github.com/jackroseman/pushup-counter/pull/44) · no dedicated OTA (in #45 OTA `98e92f0f`) |
| 12 · Friends + invite | Friends, Friend, InviteFriends share text, E13/E14 | One tap target per row; requests accept/decline | `friendsModel.test` | OTA | **Merged** · [#45](https://github.com/jackroseman/pushup-counter/pull/45) · OTA `98e92f0f` |
| 13 · Settings + reminder (needs PR 4 installed) | Grouped Settings; DailyReminder with DateTimePicker + preview and quiet hours, only when a goal is set; Icon → SymbolView; E15 no-goal empty state | With a goal: reminder saves to `notification_prefs` and reschedules; picker is native. Without a goal: no time picker or quiet hours; one row, “Set a daily goal to get reminders”, opens the goal sheet (E15). No reminder is scheduled. | `nudges.test` additions (no-goal = no schedule) | OTA | **Merged** · [#39](https://github.com/jackroseman/pushup-counter/pull/39) · OTA `39919ae7`; Save buttons in [#50](https://github.com/jackroseman/pushup-counter/pull/50) (OTA `ad25f30f`) |
| 14 · Motion | `Animated`: press, ring fill 600 ms, count roll 180 ms, level lock, 3-2-1 sweep, badge fade, phone-moved fade; Reduce Motion → crossfades | 60 fps on device; Reduce Motion respected | `motion.test` (reduced-motion switch) | OTA | **Merged** · [#60](https://github.com/jackroseman/pushup-counter/pull/60) (`ebf512e`) |
| 15 · Cleanup + version | Delete dead files/code (§8); remove the `theme.ts` shim; lower the lint warning cap if possible; update README/docs | `rg` finds no references to deleted modules; fingerprint unchanged vs PR 4 | full suite | OTA to dev; then **release dev→main** → `eas-ship` starts **production build #1 (approved)** + TestFlight | **Cleanup done, release pending** · dead code, clipped numerals, lay-flat copy, Today logo and `TabHeader` in [#52](https://github.com/jackroseman/pushup-counter/pull/52) (OTA `394f753b`); `components/ui.tsx` in [#56](https://github.com/jackroseman/pushup-counter/pull/56). [#61](https://github.com/jackroseman/pushup-counter/pull/61): remove `theme.ts` and leftover `components/Ring.tsx`, drop unused exports, lint cap 16, README/docs. The `dev` → `main` 1.3.0 production release waits on an explicit go. |

## Execution strategy

Foundation work is sequential: tokens and shared components, then the tab shell and navigation, then the single native PR. Each of those is tested on Sunny's phone before the next starts.

After the foundation is in, two or three agents can work at the same time on mutually exclusive areas (Today, set flow, Compete, You/Settings). Each agent works on its own branch and uses the shared components without editing them. If a shared change is needed, it goes in its own small PR first and lands before the feature PR that depends on it.

Every PR must pass CI, a no-native-change fingerprint check (except PR 4, the only PR allowed to change the fingerprint), and include before/after screenshots compared with the mockups. Each merge to `dev` ships an OTA update to the dev app. PR 4 starts the one approved dev build; install that build before later device-heavy work.

| Stage | PRs | How |
|---|---|---|
| 1 · Foundation (sequential) | 1 Tokens + primitives, then 2 Copy + removals, then 3 Navigation shell, then 4 Native | One PR at a time. Each is tested on Sunny's phone before the next starts. The native dependency list is frozen before PR 4. After PR 4, anything native waits for a later release. |
| 2 · Parallel feature lanes | Today: 5, 6. Set flow: 7, 8. Compete: 9–12. You/Settings: 13 (the You home restyle — frames 14, E5, E6 — ships in this lane with PR 13 or a small sibling PR; the You tab shell is already in PR 3) | Two or three agents at a time, on separate branches, in areas that do not overlap. A lane does not start until the foundation it needs has landed. The You/Settings reminder work waits for the PR 4 dev build. |
| 3 · Finish (sequential) | 14 Motion, then 15 Cleanup + release | Motion lands after the screens it animates (shared motion helpers, if any, go in a small PR first). Cleanup is last, then the `dev` → `main` release and the one production build. |

## 7. Builds

- **Dev builds: 1** (auto-started by `eas-ship` when PR 4 merges). Install it within 14 days (internal build expiry).
- **Production builds: 1** (dev→main after PR 15, version 1.3.0). It also carries dev's existing native changes (tilt/Core Motion, SDK 58 alignment), which need a store build anyway.
- No intermediate production release. A hotfix for 1.2.1 users goes JS-only from `main`.

## 8. What gets deleted

Files: `components/HowToSheet.tsx`, `components/SignInCard.tsx` (replaced by the Today "Better with friends" card and the Compete sign-in), `components/ui.tsx` (`Button`, `Stat` → `src/ui`), `screens/HistoryScreen.tsx`, `screens/ProgressScreen.tsx`, `screens/AccountScreen.tsx`, `screens/LeagueScreen.tsx`, `screens/battles/BattlesScreen.tsx` (bodies moved into the Compete views), `components/calibration.tsx` `CalibrationPanel` UI (`ProgressRing` → `ui/Ring`), the `theme.ts` shim.
Code: `Settings.haptics` + the `expo-haptics` dependency; the Chart/Face toggle and Face/Calibrated indicators in `SessionScreen`; "TOP LOCKED · cm" overlay; per-rep table, `RepChart` (Time between reps, Depth per rep), fastest/slowest rep, most `insights()` text; the "What wins" chips and `Metric` state; the Challenges notification `Notice` and per-challenge banners; "Back up now"; Back text buttons; usual-line UI; tips/footnotes that explain scoring (moved behind (i)).
Done in cleanup [#52](https://github.com/jackroseman/pushup-counter/pull/52) (merged 26 Nov 2026, 8:02 AM ET): `components/SignInCard.tsx`, `components/progressChart.tsx`, `progress/form.ts`, `Stat`, `celebrationText`, `contributionFor`, `contributionLine`, `chartCeiling`, the set-flow DEV diagnostics and debug switches. `components/ui.tsx` (including `Button`) was removed in [#56](https://github.com/jackroseman/pushup-counter/pull/56). [#61](https://github.com/jackroseman/pushup-counter/pull/61) removes the `theme.ts` shim and leftover `components/Ring.tsx`, drops unused exports, lowers the lint cap to 16, and updates README/docs. The `dev` → `main` 1.3.0 production release waits on an explicit go.
Kept untouched: `src/core/**` (rep detection, calibration, tilt), `useSession` logic (only the haptics lines removed), `src/backend/**`, sync/upload queues, `battles/model.ts`/`api.ts` (only `metric` no longer passed), all of `supabase/`.

## 9. Risks

1. **Unstable native tabs API** (`@react-navigation/bottom-tabs/unstable`): may change on upgrade. Mitigation: one flag, JS fallback ready, pinned versions.
2. **One native shot.** A missed native need after PR 4 costs a build. Mitigation: dependency list frozen in this plan; fingerprint check on every PR.
3. **iOS 26 minimum** drops iPhone X / XS / XR (no iOS 26) from updates; they keep 1.2.x. A lower floor with blur fallback would keep them; Sunny chose 26.
4. **EAS image must have Xcode 26 / iOS 26 SDK** for Liquid Glass. Check the build image on the PR 4 build log.
5. **RootNavigator refactor**: it holds goal/nudge sync and the reminder scheduler. Mitigation: move routes only (no logic edits) in PR 3; keep `AppStateContext`.
6. **Session UI is device-only to verify** (TrueDepth, Core Motion). Web renders aren't representative. Every set-flow PR needs an on-device check.
7. **Extra RPCs on Today** (`my_league`, `my_challenges`). Mitigation: caches already exist, refresh on focus, no polling.
8. **Old clients** can still create Depth/Tempo/Form challenges. The new UI must keep rendering them (`scoreLabel`).
9. **Lint cap** (16 React Compiler warnings): new code must not add any. The cap only goes down.
10. **Dev build expiry** (14 days) if the work stalls after PR 4.

## Review follow-ups (2026-11-26)

Sunny's answers to the held review questions, done as separate PRs into `dev` (JS-only, fingerprint `c3f1457f…` unchanged). Screenshots: `rebrand/review-assets` › `followups/`.

| PR | Scope | What changed |
| --- | --- | --- |
| #54 | Compete | League (i) sheet "How the league works" (plain copy, no formulas). New challenge is a formSheet with Cancel / title row. Best-set lengths 1 day / 3 days / 1 week (config migration `20261126130000_best_set_lengths`, staging via dev deploy). Crown, E9 picker and the Team "Reach a goal together" tile were already in place. |
| #55 | Set flow | "Challenge a friend" back on the summary as a quiet row under Done. Delete set also deletes on the server (queued, works offline, RLS `sets_delete_solo`, no migration). Sets played in a challenge can't be deleted. League and challenge totals are live from `sets`, so they stay consistent. |
| #56 | You / Settings / username | "Count out loud" is a real switch (off = no spoken rep numbers; replaces "Speak rep quality"). Pass ping and Sunday recap switches under Notifications (signed in). Turn-on-notifications sheet shows once. Pick a username screen (frame 17). Legacy `components/ui.tsx` removed. |

Held / skipped: invites wait for the App Store page (no change). Activity feed, result sharing, personal invite link/QR and friend streak tile are skipped (no placeholders existed). No Clear history.

Sunny later confirmed: keep the 1-day default, no recap time picker, Count out loud on by default. The New challenge header stays the mockup's Cancel + centered title.

Follow-up PR #57 (into `dev`, after #54–#56 merged):
- League (i) copy is exactly "Every push-up you do this week counts. Most reps wins." and "The board starts fresh every week." (the Improvement/points line is removed).
- Server-side `deleted_sets` tombstones: `delete_set` writes a tombstone (and a delete trigger covers the existing RLS path), `submit_set` refuses that id, and clients drop tombstoned sets on sync. Challenge sets stay. League and lifetime totals still come from live `sets` rows (the deleted row is gone). Migration `20261126135306_deleted_sets`, tested with test:db; applied to staging only after this PR merges to dev.

Follow-up · SF Symbols `Icon.tsx` ([#58](https://github.com/jackroseman/pushup-counter/pull/58), into `dev`):
- iOS `Icon` uses `SymbolView` with the mockup-matched SF Symbol map (medium weight). Web and Android keep the SVG paths in `iconPaths.ts` as `fallback`.
- Native tab bar icons are unchanged (`flame` / `crown` / `person.crop.circle`).
- No package or native changes; fingerprint stays `c3f1457f…`.

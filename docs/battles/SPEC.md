# Push-up Battles: product & UX spec

> Status: **draft for review** (design only; nothing is built or deployed).
> Companion docs: [ARCHITECTURE.md](ARCHITECTURE.md) (backend, CI/CD, native changes, phases)
> and [schema.sql](schema.sql) (draft Supabase migration, validated against Postgres 17).

## 1. What a battle is

A **battle** is a push-up challenge between friends. One person creates it, picks the
rules, and invites others. Everybody does their set(s) with the normal counting screen (the
phone on the floor, TrueDepth depth tracking) and the app compares the results.

There are two **modes**, built together:

| mode | how it feels | players |
|---|---|---|
| **Async**: "beat my score" | Do your set whenever you like before the deadline. Opponents get a push notification and do theirs later. | 2–8 |
| **Live**: head-to-head | Both players are in the app at the same time. A shared countdown starts both sets, and you see each other's count tick up in real time. | exactly 2 |

And three **formats**:

| format | rule | async | live |
|---|---|---|---|
| **Max reps** | One set, as many reps as you can. The set ends when you stop (auto-end after about 15 s without a rep, hard cap 10 min). | yes | yes |
| **Timed** | As many reps as possible in **60 s** or **120 s** (any 30–600 s is allowed in the data model). Reps completed after the clock runs out don't count. | yes | yes |
| **Multi-day total** | Total valid reps over a window of 1–14 days (for example "most push-ups this week"). Every set you do inside the window counts. | yes | no |

The creator also picks the **winning metric**, computed from the same raw reps:

| metric | what wins | notes |
|---|---|---|
| **Rep count** (default) | Most valid reps. | "Valid" = plausible and at least the battle's minimum quality (default **Good**). |
| **Depth consistency** | Most even depth across reps: `100 − 4 × std-dev(depth %)`, floored at 0. | Same std-dev as the analysis screen ("very consistent" < 6 pts). |
| **Tempo** | Steadiest rhythm: `100 × (1 − coefficient of variation of rep time)`. | Rewards an even cadence, not speed. *Open question: see §11.* |
| **Form score** | `0.5 × avg depth % + 0.3 × consistency + 0.2 × tempo`. | Rewards deep, even, steady reps. Weights are an open question. |

For every metric except rep count, an entry needs at least **5 valid reps**
(`min_reps_for_ranking`) to be ranked, so nobody wins "consistency" with 1 perfect rep.
Ties break on more valid reps, then the earlier finish.

Every battle stores a `scoring_version`. If a formula changes later, old battles keep the
formula they were played under.

## 2. Solo sets keep working

Battles are an add-on. Nothing about the current solo flow changes:

* The app works **with no account and offline**, exactly as today (AsyncStorage history,
  200-set cap).
* Signing in is needed **only to battle** (or, optionally, to back up history). After
  sign-in, local sets upload in the background as solo sets (`sets.battle_id = null`). They
  feed stats and streaks but never count toward any battle. (Exception: multi-day battles
  count solo sets done inside the window; see §1.)
* A set that belongs to a battle is just a set with a `battle_id`. It also shows in your
  normal History, tagged with the battle.

## 3. Invite flow

```
Creator: Battles tab → New battle → mode → format → metric → opponents → Send
```

Three ways to invite:

1. **Friends list / username search**: pick an existing friend by `@username`. Only
   accepted friends can be invited directly (this stops strangers from spamming invites).
2. **Invite link** (share sheet → Messages, WhatsApp, …): `https://<domain>/b/<token>`.
   * A **universal link**: if the app is installed it opens straight to the invite. If not,
     the page shows the battle and an App Store / TestFlight button.
   * The token has an expiry and an optional max number of uses, and the creator can revoke
     it.
   * Redeeming a link also creates the friendship (with a confirmation step), so a rematch
     is one tap.
3. **Custom scheme fallback**: `pushupcounter://battle/<id>` for dev builds and old
   installs.

What the invitee sees:

* **Push notification** (Expo push): "Sunny challenged you: max reps, rep count. Beat 32
  by Fri 6 pm."
  * Tapping it opens the battle's invite screen.
  * Push is a nudge only. The invite also shows in the in-app inbox, so nothing is lost if
    push is off.
* The invite screen shows: who invited you, mode, format, metric, deadline, and (async,
  optional) the creator's score.
  * Buttons: **Accept** / **Decline**.
* **Expiry**: an invite expires at `invite_expires_at`:
  * async: default 24 h, never after the battle deadline
  * live: default 10 min, because a live invite means "now"
* The creator gets a push when someone accepts or declines.

When does a battle start? As soon as at least one invitee accepts (≥ 2 accepted
participants). In async mode the creator may do their attempt *before* anyone accepts
("beat my score"). Their set is held against the pending battle.

## 4. Async battle flow

1. The creator creates the battle and optionally does their set right away.
2. Invitees accept → the battle becomes **active**.
3. Each participant does their attempt(s) before `ends_at`:
   * default 1 attempt (`attempts_allowed`)
   * multi-day: unlimited sets inside the window
4. Reminder pushes go out at 50 % of the time left and again 2 h before the deadline (only
   to people who haven't submitted).
5. The battle **completes** when everyone accepted has used their attempts, or when the
   deadline passes. A server job (`finalize_battles`, every minute) flips the status.
   Results are computed, not stored.
6. Everyone gets a push: "You won / Bob won, 32 vs 28". The push opens the results screen.

Late uploads: a set recorded offline before the deadline still counts if the server
receives it within **5 minutes** after the deadline. The server's clock is used, not the
phone's.

## 5. Live head-to-head flow

```
Lobby (both join) → each calibrates → Ready → server sets start time → 3-2-1-Go
→ both count, opponent's count streams in → set ends → results
```

* **Lobby**: both players open the battle and join its private Supabase Realtime
  channel `battle:<id>`. Presence shows who is in the lobby and who is ready.
* **Calibrate before Ready.** The existing calibration (face distance lock) happens in the
  lobby. Ready can only be tapped once the phone is locked and calibrated, so neither player
  waits on the other's calibration after the countdown.
* **Countdown start.** When both are ready, the database sets `starts_at = now() + 5 s`
  (server clock).
  * Each client has measured its clock offset against `server_now()`, so both show the
    same 3-2-1-Go and start counting at the same instant (±~100 ms).
  * Each set records the measured offset (`clock_offset_ms`). The server checks the set
    started within 30 s of `starts_at`.
* **During the set**:
  * Counting is on-device, exactly as in solo mode.
  * After each rep, the app broadcasts a tiny message `{repIndex, quality, tMs}` on the
    channel. The opponent's count and a mini progress bar update live.
  * An opponent distance stream (5 Hz) for a "ghost" chart is an optional extra (cost in
    ARCHITECTURE §6).
* **Ending**:
  * timed: at the clock
  * max reps: when you stop (about 15 s with no rep), or tap Done
  * After that you see "Waiting for Bob…" until the opponent finishes, then the results.
* **Disconnects** (network drops, app backgrounded, phone call):
  * Counting never depends on the network, so a disconnect only affects the *display* of
    the opponent's count.
  * Broadcasts are deduplicated by `repIndex`. On reconnect, the client re-sends its latest
    count, and the opponent's view catches up.
  * The UI shows "Bob reconnecting…" after 3 s with no presence.
  * The in-progress set is checkpointed to local storage every rep. If the app is killed,
    the set is recovered and uploaded at the next launch (it still counts if it arrives
    within the upload grace period).
  * The real result **always** comes from the uploaded reps, never from the live
    broadcasts.
* **No-shows**:
  * If the opponent never readies, the lobby can be left with no penalty. An abandoned
    lobby expires after 15 min.
  * If someone readies but never uploads, they score 0 (no entry). The other player wins if
    they have a ranked entry.
  * A participant who leaves on purpose is marked **forfeited**.

## 6. Results screen

* **Header**: winner, the metric, and each player's value (for example "Form 88 vs 81").
  Tie-breakers are shown if used.
* **Comparison charts** (one colour per player, built from data the app already records):
  * **Cumulative reps over time**: the race view (x = seconds since start, y = reps). This
    works for live, timed and max reps. Multi-day shows reps per day instead.
  * **Depth per rep**: bars per rep index, coloured Full / Good / Shallow (the same as the
    existing analysis screen).
  * **Tempo**: time per rep vs rep index (shows who faded).
  * **Distance trace overlay** (optional, from the stored ~10 Hz trace).
* **Stat table**: valid reps, counted reps, avg depth %, consistency, reps/min, avg
  down/up time.
* Reps that didn't count are shown greyed out with the reason ("shallow", "too fast",
  "after time").
* Actions: **Rematch** (same rules, same people), **Share** (image card), **Report**.

## 7. Anti-cheat

Goal: make casual cheating pointless, and catch impossible data. A determined attacker with
a modified client can't be fully stopped. That's fine for friendly battles.

**Hard checks** (the set is rejected when uploaded; done in the `submit-set` Edge Function
and in DB triggers):

* The user is an accepted participant, the battle is open, and attempts are left.
* Upload time (server clock) is within the deadline plus 5 min. A live set must start
  within 30 s of the server start time.
* The shape of the data:
  * monotonic rep indices and timestamps
  * rep times inside the set
  * set ≤ 2 h, rep count ≤ 2000
  * trace ≤ 3001 points
  * a real detector config
* Battle sets must include the depth trace and use the current data version (no legacy
  imports).
* Uploads come only through the Edge Function with the user's JWT. Clients cannot insert
  battle sets or edit any set afterwards (no UPDATE grant at all).

**Soft plausibility checks** (computed at query time; a failing rep simply doesn't count,
and the reason is shown):

| check | rule |
|---|---|
| `faster_than_detector_allows` | Interval to the previous rep < the detector's own `minRepIntervalMs` (400 ms). |
| `rep_too_short` | start → completion < 300 ms (faster than humanly possible). |
| `after_set_end` | A rep completed after the set ended. |
| `bottom_above_top` | The bottom distance is not below the top distance. |
| `below_count_threshold` | Depth below the detector's count threshold. |
| `not_in_trace` | Battle reps only: the stored distance trace has no sample near `bottom_ms` that comes close to the claimed bottom depth (± 3 cm). Catches made-up rep lists. |
| `excluded_by_review` | A moderator flagged the set. |

**Later hardening** (phase 5):

* App Attest / DeviceCheck to prove the upload came from the real app.
* Statistical outlier flags (for example a personal best jumping 3×).
* Report → review queue.

Because results are computed at query time, any new check applies to all future standings
immediately, and past battles can be re-scored under a new `scoring_version` if we choose
to (open question).

## 8. Screens

New screens (✱ = needs the native build in phase 2, everything else ships OTA):

| screen | purpose |
|---|---|
| **Sign in** ✱ | Sign in with Apple. Only shown when you first open Battles (or choose Back up). |
| **Pick username** | Choose a unique `@username` (3–20 chars, a–z 0–9 _). |
| **Battles home** (tab) | Sections: Invites (accept/decline), Your turn, Waiting on others, Live now, Recent results. |
| **New battle** | Mode → format (+ duration / window) → metric → opponents (friends, search, or share link) → Send. |
| **Friends** | List, search by username, pending requests, add via link, block/remove. |
| **Invite** (deep-link target) | The battle summary + Accept / Decline. Also handles expired/revoked/full links. |
| **Battle detail** | Rules, participants and their status, deadline countdown, **Start my set** button, standings so far. |
| **Live lobby** | Presence, calibration status, Ready buttons, then the synced countdown. |
| **Battle session** | The existing session screen plus a battle header (opponent live count, the timer for timed battles, "Battle set" badge). |
| **Waiting** | After your set: "waiting for Bob" with the live status. |
| **Results** | §6. |
| **Profile / stats** | Totals, streak, best set, battle record (W/L). Includes **Delete account** ✱ (App Store requirement). |
| **Notification permission primer** | Explains why before the iOS prompt (asked at the first invite sent or received). |

Existing screens: **Start**, **Session**, **Summary**, **History** stay. History gains a
battle tag, and Start gains a Battles entry point. Today's navigation is plain `useState`
routes in `App.tsx`. Battles need a stack and deep links, so the native batch is the
natural time to adopt React Navigation (open question).

## 9. State machines

### Battle status (`battles.status`)

```
                 ≥2 accepted                      deadline passed /
             (participant accept)                 all attempts used /
  ┌─────────┐ ───────────────────▶ ┌────────┐ ─────────────────────▶ ┌───────────┐
  │ pending │                      │ active │   (≥2 entrants)        │ completed │
  └─────────┘                      └────────┘ ─────────────────────▶ └───────────┘
    │     │                            │       (<2 entrants)          ┌─────────┐
    │     │ invite expiry, nobody      └─────────────────────────────▶│ expired │
    │     └─────────────────────────────────────────────────────────▶ └─────────┘
    │ creator cancels / all invitees declined
    ▼
  ┌───────────┐
  │ cancelled │
  └───────────┘
```

| from → to | trigger | who |
|---|---|---|
| pending → active | a participant accept makes accepted ≥ 2 | DB trigger |
| pending → cancelled | the creator cancels (`cancel_battle`), or every invitee declined | user / DB trigger |
| pending → expired | `invite_expires_at` passed with fewer than 2 accepted | `finalize_battles` cron |
| active → completed | deadline / window / live time-out passed, or every accepted participant used their attempts, **and** ≥ 2 participants have an entry | `finalize_battles` |
| active → expired | same, but fewer than 2 entries (nobody to compare) | `finalize_battles` |
| live lobby abandoned | active for 15 min without both readying → expired | `finalize_battles` |

`completed`, `cancelled` and `expired` are terminal (`finished_at` is set exactly then).
Live battles have an extra **sub-phase** inside `active`: *lobby* (`starts_at` null) →
*counting down* (`now < starts_at`) → *in progress* → done. It is derived from
`starts_at`/`duration_s`, not stored.

### Participant invite status (`battle_participants.status`)

```
  ┌─────────┐  accept (before expiry)  ┌──────────┐  leave / no-show  ┌───────────┐
  │ invited │ ───────────────────────▶ │ accepted │ ────────────────▶ │ forfeited │
  └─────────┘                          └──────────┘                   └───────────┘
     │   │ decline                         (creator starts here)
     │   ▼
     │ ┌──────────┐
     │ │ declined │
     │ └──────────┘
     │ invite_expires_at passed
     ▼
  ┌─────────┐
  │ expired │
  └─────────┘
```

* Enforced by a trigger. Users can only change their own row, and only along these arrows.
  `ready_at` (live) can only be set while the lobby is open.
* "Submitted" is **not** a status. It is derived from whether the participant has a set
  for the battle.

## 10. Notifications

| event | to | text (example) |
|---|---|---|
| invited | invitee | "Sunny challenged you to a 60 s battle" |
| accepted / declined | creator | "Bob accepted, your move" |
| opponent submitted | the other participants | "Bob did 28. Beat it by Fri 6 pm" |
| reminder | people who haven't submitted | "4 h left to beat Sunny's 32" |
| live: opponent ready | the other player | "Bob is ready, join the lobby" |
| result | everyone | "You won! 32 vs 28" |
| friend request | addressee | "Bob wants to be friends" |

All of these go through one `notify` Edge Function, triggered by database webhooks. Each
push carries a `url` the app routes to. Pushes are batched per Expo's limits, and dead
tokens are disabled when Expo returns `DeviceNotRegistered`.

## 11. Open questions for Sunny

1. **Default minimum quality**: should battles count only **Good + Full** reps (current
   default), or every rep the counter counts (Shallow too)?
2. **"Tempo" metric**: steady rhythm (current proposal), or raw speed (reps/min, which
   overlaps with timed battles)?
3. **Form-score weights**: 50 % depth / 30 % consistency / 20 % tempo OK?
4. **Show the opponent's score before your async attempt?** ("Beat 32" is motivating, but
   it changes strategy.) Proposal: show it, with a creator toggle.
5. **Group size**: async up to 8, live exactly 2 for v1. OK?
6. **Friends' stats**: should friends see your totals/streaks, or only battle results?
7. **Re-scoring**: freeze results at completion forever, or allow re-scoring old battles if
   anti-cheat rules improve? (The schema supports both via `scoring_version`.)
8. **Account for solo**: keep solo fully anonymous/offline (proposal), or nudge sign-in to
   back up history?
9. **Navigation**: adopt React Navigation in the same native batch (recommended), or keep
   the hand-rolled router?
10. **Domain** for invite links / universal links (see ARCHITECTURE §5).

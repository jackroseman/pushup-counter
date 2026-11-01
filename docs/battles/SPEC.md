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
| **Rep count** (default; the only metric for timed) | Most good reps. | See "Which reps count" below. |
| **Depth consistency** | Most even depth across reps: `100 − 4 × std-dev(depth %)`, floored at 0. | Same std-dev as the analysis screen ("very consistent" < 6 pts). |
| **Tempo** | Most consistent rhythm: `100 × (1 − CV)`, floored at 0, where CV = std-dev ÷ mean of the time between consecutive good reps. | **Consistency, not speed.** CV is scale-free: a steady 1 s rhythm and a steady 3 s rhythm both score 100. |
| **Form score** | `0.5 × avg depth % + 0.3 × consistency + 0.2 × tempo`. | Rewards deep, even, steady reps. Weights are still an open question (§11). |

**Which reps count (decided).** Only **Good-or-better** reps ever count in a battle; no
Shallow reps. This maps onto the app's existing rep classification
(`src/core/detector.ts`, `DEFAULT_CONFIG`), where depth ratio is how far you went from your
calibrated top towards the floor:

| app quality | depth ratio | counts in solo | counts in a battle |
|---|---|---|---|
| **Full** | ≥ 0.70 (`fullRatio`), or the proximity sensor touched | yes | **yes** |
| **Good** | 0.45 – 0.70 (`goodRatio`) | yes | **yes** |
| **Shallow** | 0.30 – 0.45 (`minCountRatio`) | yes | **no** |
| not counted | < 0.30 | no | no |

Full is a stricter subset of Good depth, so "Good" in battle rules means *Good or Full*. A
rep must also pass every plausibility check (§7) to count. `battles.min_quality` defaults
to `good` and the database rejects anything lower (`check (min_quality >= 'good')`); `full`
remains possible as a stricter house rule. The analysis charts still show the Shallow reps,
greyed out ("shallow, didn't count").

**Tempo is about consistency, never speed.** It is measured only on the intervals between
consecutive good reps *within one set* (a Shallow rep in between makes that gap longer, which
hurts consistency). At least 3 good reps (2 intervals) are needed, else tempo is
"n/a". Reps/min is shown as a stat but never decides a battle.

**Ranking and ties.** Entries rank by the metric, then by more good reps, then by better
tempo consistency. If all three are equal, it's a **draw** (shared rank 1, no winner). Finish
time never breaks ties, because speed doesn't matter.

* **Timed battles** always use the rep-count metric (enforced in the database): **most good
  reps inside the time wins; tempo consistency breaks ties.** Going fast only helps by
  getting more good reps in.
* For every metric except rep count, an entry needs at least **5 good reps**
  (`min_reps_for_ranking`) to be ranked, so nobody wins "consistency" with 1 perfect rep.
* With several attempts, your best attempt counts (same ordering).

**Results are locked when the battle ends (decided).** When a battle completes, the server
writes a frozen copy of the final standings (`battle_results`) in the same step that marks
it completed. From then on the results screen, W/L record and stats read that frozen copy.
Later changes to anti-cheat rules, scoring formulas, or moderation flags do not change a
finished battle. Every battle also stores a `scoring_version`, so a battle that is still
running when a formula changes keeps the formula it started with.

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
3. **Custom scheme fallback**: `pushupcounter://invite/<token>` and
   `pushupcounter://battle/<id>`. Until a domain is chosen (and the associated-domains
   entitlement ships in a native build), shared invite links use the custom scheme.

What the invitee sees:

* **Push notification** (Expo push): "Sunny challenged you: max reps, rep count. Beat 32
  by Fri 6 pm."
  * Tapping it opens the battle's invite screen.
  * Push is a nudge only. The invite also shows in the in-app inbox, so nothing is lost if
    push is off.
* The invite screen shows: who invited you, mode, format, metric, deadline, and (async)
  the scores already posted, for example "Sunny did 32". Always shown, no toggle (decided):
  you see your opponent's score before your own attempt.
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
   * Everyone can see the scores already posted before doing their own attempt ("Beat 32").
     There is no hidden-score option.
3. Each participant does their attempt(s) before `ends_at`:
   * default 1 attempt (`attempts_allowed`)
   * multi-day: unlimited sets inside the window
4. Reminder pushes go out at 50 % of the time left and again 2 h before the deadline (only
   to people who haven't submitted).
5. The battle **completes** when everyone accepted has used their attempts, or when the
   deadline passes. A server job (`finalize_battles`, every minute) flips the status and,
   in the same transaction, **locks the results** (copies the final standings into
   `battle_results`). Until then the standings shown are provisional and computed live.
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
  Tie-breakers are shown if used ("Tied on 40 reps; Bob wins on tempo 92 vs 85"), or
  "Draw". A small lock icon shows that the result is final.
* **Comparison charts** (one colour per player, built from data the app already records):
  * **Cumulative reps over time**: the race view (x = seconds since start, y = reps). This
    works for live, timed and max reps. Multi-day shows reps per day instead.
  * **Depth per rep**: bars per rep index, coloured Full / Good / Shallow (the same as the
    existing analysis screen).
  * **Tempo**: time between good reps vs rep index (an even line = consistent rhythm).
  * **Distance trace overlay** (optional, from the stored ~10 Hz trace).
* **Stat table**: good reps, counted reps (incl. Shallow), avg depth %, consistency, tempo
  consistency, reps/min (info only, never scored), avg down/up time.
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

Because live standings are computed at query time, a new check applies immediately to every
battle that is still running. **Finished battles are never re-scored** (decided): their
results are locked in `battle_results`. If a reviewer later finds cheating in a finished
battle, that is a manual, explicit moderation action (out of scope for v1), not an
automatic recalculation.

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

All of these go through one `notify` Edge Function. Table triggers queue them in an outbox,
and `notify` drains it (kicked by the app right after an action, plus a once-a-minute cron). Each
push carries a `url` the app routes to. Pushes are batched per Expo's limits, and dead
tokens are disabled when Expo returns `DeviceNotRegistered`.

## 11. Open questions for Sunny

1. ~~**Default minimum quality**~~ **Resolved:** only Good-or-better reps count in
   battles (Good + Full; never Shallow). Enforced in the schema. See §1 "Which reps count".
2. ~~**"Tempo" metric**~~ **Resolved:** tempo means consistency (low variance of the time
   between reps), never speed. In timed battles, most good reps wins and tempo consistency
   breaks ties. See §1.
3. **Form-score weights**: 50 % depth / 30 % consistency / 20 % tempo OK?
4. ~~**Show the opponent's score before your async attempt?**~~ **Resolved:** yes, always
   shown (no toggle). See §3 and §4.
5. **Group size**: async up to 8, live exactly 2 for v1. OK?
6. ~~**Friends' stats**~~ **Resolved:** friends see only battle results (`friends_visibility
   = battle_results_only`).
7. ~~**Re-scoring**~~ **Resolved:** results are locked when the battle ends and are never
   re-scored. See §1 and §7, and ARCHITECTURE §2 "Locked results".
8. ~~**Account for solo**~~ **Resolved:** solo stays anonymous; sign-in is optional (backup)
   and required only for Battles.
9. ~~**Navigation**~~ **Resolved:** React Navigation (native stack), adopted in phase 2a.
10. **Domain** for invite links / universal links (see ARCHITECTURE §5). Until then invite
    links use `pushupcounter://invite/<token>`.

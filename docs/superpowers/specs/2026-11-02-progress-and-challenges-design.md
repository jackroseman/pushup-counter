# Progress, goals, league, and challenges

> Status: **design for review**. This PR is the spec only. It does not add screens, SQL, or migrations.
>
> Grounded in the migrations on `dev` through `20261102130946_claim_finished_set.sql` (PR #11), the app in `src/`, and `docs/battles/`. The live schema is the migrations. `docs/battles/schema.sql` is an older draft and is not the source of truth.
>
> Where this spec and `docs/battles/SPEC.md` disagree, this spec wins for progress, goals, the league, and the challenge model. Battle rules that this spec does not change (counted reps, tempo, locked results, seeing an opponent's score, Sign in with Apple) stay as they are.

## 1. Plain language

People come back to beat their own numbers and get stronger. Friends make that fun. The game is not one set.

Every counted rep lands in **today**. Today fills a ring, feeds a streak, and feeds records. Those numbers are what friends compare, in a weekly league and in challenges someone starts on purpose.

The phone keeps measuring. The server keeps raw sets and raw reps, plus a few rows about what the person chose (a goal, a friend, a challenge). Totals, streaks, records, "vs your usual Monday", both league boards, and live challenge standings are calculated when asked. They are not saved as their own tables.

A finished challenge is the one exception, and it already exists: when a challenge ends, the server freezes that result. Later formula changes do not move the winner.

You can use the whole personal game with no account. The league and challenges need Sign in with Apple and a username, because they need to know who your friends are.

## 2. Decisions to scan

| Topic | Decision |
|---|---|
| What counts | Full and Good reps that pass the plausibility checks. Shallow reps never count. The number is `good_or_better_reps`, not the `good_reps` column (that column is Good-but-not-Full only). |
| Tempo | Consistency of the gaps between counted reps. Speed is not a score and does not break ties. |
| Daily goal | Either a program or one custom number. The ring, the streak, and the league's goal points use the goal that was active on that calendar date. |
| Programs | Three starters, seeded below. Targets are immutable once shipped. A change is a new program id. |
| Streak | Consecutive days that hit the goal active that day. A program rest day (target 0) does not add and does not break. No goal yet means no streak. |
| League | Always on among accepted friends. Week is Monday 00:00 to the next Monday 00:00, per person, in their own zone. Two boards: Total and Improvement. Crowns are calculated, not stored. |
| Challenges | One table, four kinds: `best_set`, `total`, `streak`, `team`, plus a time window. Today's max-reps and timed battles become `best_set`. Multi-day becomes `total`. |
| Live 1v1 | `mode` stays `async` or `live`. Creating a live challenge keeps failing until a later phase. The columns live needs stay in the schema. |
| Timed | Not a format. A `best_set` with `duration_s` set is timed. Null `duration_s` is "go until you stop". |
| Which sets link to a challenge | Only a `best_set` attempt sets `sets.challenge_id`. Totals, streaks, team goals, the ring, and the league count every eligible set in the window. One workout fills today and every race that covers that moment. |
| Friends | Already a real table (`friendships`) with requests, blocks, and invite-link confirms. This spec does not add a second friend graph. The league reads that table. |
| Privacy | Friends see league totals and challenge results. They do not see each other's raw sets, except people in a `best_set` together, who can see that attempt (the attempt is the result). |
| Anonymous | Today, Progress, goals, and the daily reminder work on the phone. League, challenges, pass pings, and the Sunday push need an account. |
| Ship shape | JavaScript and SQL only. No native module, no new permission string, no version bump. OTA on the current binary. |
| Breaks | Beta may break. Slice 5 renames battles to challenges and drops `battle_format` in one step. Staging via `dev`, production via `main`. |

## 3. What the code does today

Personal use is on the phone. History is AsyncStorage, newest 200 sets (`MAX_HISTORY`), key `pushupcounter.history.v1`. A set with zero reps is not saved. Sign-in is optional and backs sets up through `submit_set`. There is no daily goal, no ring, and no league screen. The root screen is Start (how to count, Speak quality, Haptics, Start, Battles, History, Account).

Battles are async only. `create_battle` rejects `mode = live`. Formats in the database are `max_reps`, `timed`, and `multi_day`. The app can create all three. PR #11 lets the creator attach the set they just finished:

- The set must be theirs, not already in a battle, data version ≥ 2, with a detector config.
- `ended_at` must be within `claim_set_max_age_s` of the server clock (default 1800 seconds) and not more than 2 minutes in the future.
- A timed battle's `duration_s` must equal the set's `timer_duration_s`.
- Live battles cannot claim a finished set.
- Shallow reps still do not count. `battle_entries` filters on `min_quality`.

`docs/battles/SPEC.md` says a multi-day battle counts every solo set inside the window. The SQL does not. It only counts rows whose `battle_id` is that battle. PR #11 links one recent set. This spec makes "every set in the window" true for `total`, `streak`, `team`, the ring, and the league, and keeps an explicit link only for `best_set`.

`user_stats` is a view the app does not query. It sums `total_reps`, which includes Shallow reps, and its streak is "any day with any set". It buckets days with the profile's **current** `time_zone`, so a zone change would move old days. Slice 3 replaces that definition. The app never read the old numbers.

`friendships` is already stored: one row per pair (`user_low < user_high`), status `pending | accepted | blocked`, writes only through `send_friend_request`, `respond_friend_request`, `remove_friend`, `block_user`, and `unblock_user`. A direct battle invite requires an accepted friend. Redeeming an invite link joins the battle and, if the person agrees, accepts the friendship. Someone can join by link and skip the friend step. Those two people can share a challenge and still be off each other's league.

`profiles.time_zone` is set from `Intl` when the username is first saved. The app does not refresh it when the phone's zone changes later. This spec does.

Push already works: `push_tokens`, a private outbox, `notify`, and a minute cron. Quiet hours, a daily nudge, a pass ping, and a weekly recap are not there yet.

Navigation is a native stack (`@react-navigation/native-stack`). `@react-navigation/bottom-tabs` is not installed. `react-native-screens` is. Adding the tab package is JavaScript on a native module the binary already has.

## 4. One definition of a counted rep

Everywhere in this spec, a **counted rep** is a Full or Good rep with no plausibility failure.

- Full is depth ratio ≥ `full_ratio` (0.70) or a proximity touch that the detector treats as Full.
- Good is depth ratio ≥ `good_ratio` (0.45) and below Full.
- Shallow is below that. Shallow is shown on the set analysis and does not enter the ring, the streak, records, milestones, the league, or any challenge.
- On the server, a rep with `implausible_reason` set is not counted. The checks stay the ones in `rep_metrics` (too fast for the detector, shorter than 300 ms, after the set ended, bottom above the calibrated top, below the count threshold, not in the trace on a battle attempt, excluded by review).
- On the phone, before sync, the count is reps whose quality is not `shallow`, and for a timed set, reps completed before the timer. After a signed-in sync, Today refreshes from the server. If the server drops a rep, the ring can step down. The set analysis shows the reason.
- `set_metrics.good_reps` is the wrong column for this. It excludes Full reps. Use `good_or_better_reps`.

Tempo, when a screen shows it, stays the current formula: `100 × (1 − stddev / mean)` of the gaps between consecutive counted reps in one set, floored at 0, null when there are fewer than 3 counted reps (fewer than 2 gaps). A steady slow set and a steady fast set can both score 100.

Form score, when a screen shows it, stays the current weighted sum, using `app_settings.form_score_weights` (default depth 0.5, consistency 0.3, tempo 0.2). Consistency is `max(0, 100 − 4 × stddev of depth %)`. The tempo term is 0 when tempo is null. The after-set screen still shows the number, with the caption "Tempo needs 3 counted reps" when that happens. Personal form score uses the weights at read time. A `best_set` challenge keeps the copy of the weights it stored at creation, same as battles do now.

## 5. Time, offline sets, and travel

### 5.1 The day a set belongs to

Each new set stores `recorded_time_zone`, the IANA zone of the phone at **End set**. That is a fact about the workout, not a metric.

The set's calendar date is `(started_at AT TIME ZONE recorded_time_zone)::date`. A set that crosses midnight stays on the day it started.

"Today" for the ring and the streak is `(now() AT TIME ZONE profiles.time_zone)::date` for a signed-in person, and the phone zone for everyone else. The ring includes a set when the set's calendar date equals that today.

On each launch, if the signed-in profile's zone differs from the phone zone, the app saves the phone zone. Old sets keep the zone they were recorded with. They do not move.

Travel consequence, accepted: a morning set in New York stays on the New York date. If that person is in a zone where that date is already yesterday, the new today's ring starts empty. If the newest set's zone differs from the current zone, Today shows one line: "Yesterday's workout stays on yesterday at home." A skipped local date breaks a streak. A date you land back on is not counted twice, because each set has one date.

Sets saved on this phone before the upgrade have no zone. They are bucketed with the phone's zone at the moment they upload (or, while still anonymous, the phone's current zone). New sets stamp the zone at End set.

### 5.2 Which clock wins

`started_at` and `ended_at` are the phone's clock. `received_at` is the server's clock, set on insert.

`submit_set` rejects a set whose `started_at` is more than 2 minutes after `received_at`. It does not reject an old `started_at`.

**Personal records and lifetime** use every stored counted rep, however late it synced.

**Personal streaks** use a set only when `received_at − started_at` is at most `personal_backfill_days` (default 60) and the future check above passed. A three-week offline trip still repairs a streak. A set older than that still adds to lifetime and to best day / week / month / set, and the set analysis says "Synced late. It counts in your totals, not in your streak." Anonymous history never went through the server, so the phone trusts its own dates for the local streak. At sign-in, if any set on the phone is older than 60 days, Account shows: "Sets older than 60 days still count toward your records. They don't rebuild a streak."

**League and challenges** use a set only when the server received it by the end of that window plus `upload_grace_s` (default 900, fifteen minutes). The old battle grace was 5 minutes. Fifteen minutes covers a subway ride home. It does not cover uploading tomorrow into yesterday's race. A late set still saves to personal history. A challenge that locked early (section 7.4) also ignores a set received after that snapshot, even when the window's grace has not ended. Either way the app says: "Saved to your history. It was too late for that challenge."

The grace is part of the league and challenge queries, not a stored flag. A set keeps the calendar date from `recorded_time_zone`, and its upload deadline is the end of that date's week in the recorded zone, plus grace. Changing `profiles.time_zone` does not move the set onto another date and does not reopen that deadline. The board on screen is still the Monday–Sunday week that contains today in the current zone, so a trip onto a new local week shows that week. Deleting a set, or unfriending someone, still changes the numbers (section 6.5).

### 5.3 Offline

The phone saves the set first, as it does now, and queues the upload. Today adds unsynced sets on top of the last server numbers, matched by `client_set_id` so a retry does not double count. With no network, Today, Progress, and the goal use the phone. A banner says "You're offline. These numbers are from this phone."

## 6. Screens

This is the finished app. Section 12 says which slice builds each piece. Until the tab bar ships, Today is the root of the stack, and Progress, League, and Battles are screens pushed from it.

The tab bar is Today, Progress, League, Challenges. Account is a button on Today, not a tab. Session and the after-set screen stay on the stack.

Deep links, scheme `pushupcounter` as today:

| Link | Opens |
|---|---|
| `today` | Today |
| `progress` | Progress |
| `league` | League |
| `challenges` | Challenges |
| `challenge/<id>` | That challenge |
| `battle/<id>` | That same challenge, so a push sent before the rename still opens |
| `invite/<token>` | Invite, unchanged |
| `friends` | Friends, unchanged |

New pushes use `challenge/`. The app accepts both paths.

### 6.1 Today

**Purpose.** Show the day, and start the next set.

**Contents.**

- A ring: counted reps today over the daily target. `32 / 50`. Past the target the ring stays full and the caption reads `+12 past your goal`.
- The streak beside the ring: `4 day streak`. It increments when today first hits the target.
- One comparison line when there is enough history: `+12 vs your usual Monday`, `−3 vs your usual Monday`, or `Even with your usual Monday`. The rule is in section 7.1. With fewer than three samples the line is absent.
- The primary button: **Do a set**.
- A secondary text button if they have no goal: **Set a goal**.
- Sunday 00:00 through Monday 12:00 local, a week card, built in slice 7: this week's counted reps, goal days hit, and, when signed in with friends, the two ranks. Tapping it opens League if they have an account, Progress if they do not.

Speak quality and Haptics move to Account. The five setup steps that live on Start today move to a one-time sheet, **How counting works**, the first time Today appears. A text button on Today can open it again.

**States.**

| State | What they see |
|---|---|
| First launch, no sets, no goal | Ring `0` with no denominator. Caption "Set a goal". Streak line "Set a goal to start a streak". Do a set is available. The how-to sheet is up. |
| Sets, no goal yet | Ring shows today's reps and no fraction. Same goal caption. Reps are stored and will sit on that date after they pick a goal. |
| Rest day (program target 0) | Today's reps, large, labeled "Rest day". No fraction. The streak does not move. Reps still count for records, the league, and challenges. |
| Goal in progress | Ring, streak, usual line if it exists, Do a set. |
| Goal met today | Full ring and the past-goal caption. Streak includes today. |
| No TrueDepth | The current explanation. No Do a set button. |
| Offline | The numbers from the phone, plus the offline banner. |
| Anonymous | The full Today screen. No league rank on the Sunday card. |
| Signed in, server failed | Phone numbers, banner "Couldn't refresh." |

**Navigation.** Do a set → Session. Ring or "Set a goal" → Goal setup. Week card → League or Progress. Account button → Account. After a set, Session replaces itself with the after-set screen.

### 6.2 Session

**Purpose.** Count one set. Unchanged measurement, calibration, and detector.

**Contents.** The current session screen. In a `best_set` challenge, the header shows the challenge and, when it is timed, the timer. Idle end and hard cap stay the values in `async_battle_defaults` (`max_reps_idle_end_s` 15, `max_reps_cap_s` 600). Other challenge kinds do not put the person in a special session. They do an ordinary set, and the window picks it up.

**States.** Cancel returns to the previous screen and saves nothing. A finished set with at least one rep is saved locally, then uploaded if there is an account. Zero-rep sets are still discarded.

**Navigation.** End set → after-set screen.

### 6.3 After a set

**Purpose.** Say what this set did for today, celebrate a real record, and offer a challenge.

**Contents.** The current analysis stays: rep chart, depth chart, distance trace, Full / Good / Shallow, tempo trend, tips. Above that, three numbers:

- Counted reps (Full + Good), with Shallow called out as not counted.
- Form score, section 4.
- Today's ring after this set: `This set put you at 32 / 50`.

One celebration card, only when this set changed something. Highest match wins, and if the daily goal was also newly met, a second line says "Also: goal met."

1. Lifetime milestone just crossed (the highest of 1,000 / 10,000 / 100,000 only).
2. New longest streak.
3. New best single set.
4. New best day.
5. New best week.
6. New best month.
7. Daily goal newly met.
8. The current program segment's one-set marker (5, 10, 15, or 20 on First 20). The other programs have no marker. The ring still uses the daily target.

Then **Challenge a friend**, when this set is not opened from old History. The choices:

| Choice | When it shows | What it does with this set |
|---|---|---|
| Best single set | The set is not already a `best_set` attempt, it ended within `claim_set_max_age_s`, and if it was timed, that timer is one of `timed_durations_s` | Creates a `best_set` and claims this set, same claim rules as PR #11 |
| Most reps today / this week / this month | Always, for a just-finished set | Does not claim. The set counts because it started inside the window |
| Streak face-off | They have a goal. If they do not, the row sends them to Goal setup first | Does not claim. The bar freezes when the friend accepts (section 7.4) |
| Team goal | Always, for a just-finished set | Does not claim. They pick a shared target |

Claim age applies only to Best single set. A morning set can still start "most reps today" that night.

**States.**

| State | What they see |
|---|---|
| Opened from History | Analysis only. No challenge menu. Start a window challenge from the Challenges tab |
| Just finished, past the claim age | Best single set is hidden. Most reps, streak face-off, and team goal stay |
| Just finished, anonymous | The personal numbers and celebration. Challenge a friend opens Sign in with Apple, then returns to the menu. If sign-in took longer than the claim age, Best single set is gone and the other choices remain |
| Offline, signed in | Personal numbers from the phone. Challenge a friend is disabled with "Connect to challenge a friend." The set stays queued |
| This set is already a best-set attempt | Best single set is hidden. The window choices remain |

**Navigation.** Done → Today. Challenge a friend → New challenge, with this set's id when they picked Best single set. Goal setup when a streak challenge needs a goal.

### 6.4 Progress

**Purpose.** Show the longer game: days, weeks, months, lifetime, and the records shelf.

**Contents.**

- A switch: Day, Week, Month, Lifetime.
  - Day: the last 14 local dates, bars of counted reps, and a mark for the target on days that had one.
  - Week: the last 12 Monday–Sunday weeks.
  - Month: the last 12 calendar months.
  - Lifetime: one point per week, the running total of counted reps, with lines at 1,000, 10,000, and 100,000.
- Records shelf:
  - Best single set: most counted reps in one set, and its date.
  - Best day, best week, best month: the richest bucket, current period included.
  - Longest streak. When the current streak equals it, the shelf says "That's now."
- Milestone badges at 1,000, 10,000, and 100,000 counted reps, lifetime. Earned badges show the date of the set that crossed. Locked badges show how many are left (`258 to 1,000`).
- Programs: not started, in progress (`Week 2 · 15 a day · Sunday off`), or complete. Completion rules are in section 7.2.
- **All sets** opens the current History list.

A tie on a record shows the earliest date.

**States.**

| State | What they see |
|---|---|
| No sets | Empty chart and "Do a set to start." Shelf is dashes. Badges locked |
| Anonymous, or signed in with only the phone's history | Charts from the phone. If 200 sets are stored, "Showing the last 200 sets on this phone. Sign in to keep the full history." Sets already pushed out of the 200 are gone |
| Signed in, online | Charts and shelf from the server, so they include workouts from another phone. All sets stays the on-phone list. If the server has more sets than the phone, "Older sets are in your charts." |
| Offline | Last saved chart plus sets not yet uploaded. Offline banner |
| First run | Same as no sets |

**Navigation.** All sets → History → a past set's analysis (no challenge menu). A program row → Goal setup.

### 6.5 League

**Purpose.** A standing weekly comparison with friends. Nobody has to start it. It resets every Monday, local to each person.

**Contents.** Two tabs.

- **Total.** Counted reps in that person's current Monday–Sunday week. Ranked high to low.
- **Improvement.** Points from section 7.3. The row shows the points, the week's reps, goal days (`5/6`), and either the usual week or `Baseline 1/3 weeks`.

Each row: name, the number, the rank. Rank 1 on last week's completed board wears a crown on that tab. Two people can wear it. The caption is "Last week, among your current friends." You can crown Total and someone else can crown Improvement.

Under both tabs, one line: "Each person's week is Monday to Sunday where they are."

**States.**

| State | What they see |
|---|---|
| Anonymous | What the league is, and Sign in with Apple. No names, no numbers |
| Signed in, no username yet | The existing profile step, then the league |
| Signed in, no friends | Their own row, and "Add a friend to start this week's board." No crown |
| Friends, a new account | Boards with real reps. Improvement shows the baseline progress until 3 finished weeks exist. Goal points still count |
| Offline | Last fetched board, offline banner, no pull-to-refresh result |
| A friend unfriends | They leave both boards, including last week's crown, on the next successful load |

**Navigation.** Add a friend → Friends. A row → that friend's screen, which keeps today's head-to-head challenge record and adds this week's total and improvement points. It does not add lifetime reps or a set list.

### 6.6 Challenges list

**Purpose.** Replace the Battles list. Invites waiting, your turn, waiting on others, and results from the last 30 days. Same jobs as the current Battles screen.

**Contents.** Those groups, plus a **New challenge** button. Each row names the kind and the window ("Most reps this week", "Best set · 60 s", "Streak · 14 days", "Team · 500"), the deadline, and whose move it is.

**States.**

| State | What they see |
|---|---|
| Anonymous | What a challenge is, and Sign in with Apple |
| No username | Profile step |
| No challenges | "Challenge a friend after a set, or start one here." |
| Offline | Last fetched list, offline banner. New challenge is disabled |

**Navigation.** Row → Challenge detail. New → New challenge. Friends button → Friends.

### 6.7 New challenge

**Purpose.** Pick a kind, a window, and people.

**Contents.**

1. Kind: Best single set, Most reps, Streak face-off, Team goal.
2. The extra choice for that kind:
   - Best single set: untimed, or 60 s / 120 s (the `timed_durations_s` list). Untimed can pick the metric (rep count, depth consistency, tempo, form). Timed is rep count. Deadline chips stay 6 h / 24 h / 72 h, cap 168 h.
   - Most reps or Team: today, this week, this month, or custom. Custom asks for a start and an end, from 1 hour to `challenge_custom_max_days` (92).
   - Streak: 7, 14, or 30 days, or a custom length from 3 to 92.
   - Team also asks for the shared target. Chips 200, 500, 1000, or a custom number from 10 to 100,000. Default window is this week, default target 500.
3. Friends, username search, or an invite link. At least one friend or a link. Cap is `async_max_participants` (8), including the creator. Live is not offered.

If they arrived from a just-finished set and chose Best single set, the screen says "We'll use the set you just did" and the claim runs after create. A calendar window that is almost over shows "Today ends in 1 hour. Sets you already did today count." The create still goes through.

Streak face-off requires a goal on the creator before create, and on each friend before they can accept.

**States.** No friends and no link: the button stays disabled and explains why. Offline: the screen says to connect. A server rejection (full, blocked, no goal, claim too old) shows the server's sentence.

**Navigation.** Create → Challenge detail. Cancel → back.

### 6.8 Challenge detail

**Purpose.** The rules, the current standings, and the next action.

**Contents.** Kind, window in the viewer's zone, who is in and whether they accepted, and the standings from section 7.4. A lock icon when the result is frozen.

- `best_set`: **Start my set** when they have attempts left and the deadline has not passed. Scores already posted are visible before they start. After they submit, the charts for that attempt are on this screen (the current results charts).
- `total`, `streak`, `team`: no special session. Copy: "Every set you do before the end counts." The standings update when a set syncs.
- Team shows the shared total against the target, and each person's contribution.
- Streak shows each person as still in or out, the day they went out, and the frozen daily bar.

Actions that exist today stay: accept, decline, forfeit, cancel while pending, rematch (same kind, same people, a new window), share the invite link, report a `best_set` attempt.

**States.**

| State | What they see |
|---|---|
| Invited | Rules, scores so far, Accept / Decline. A streak invite with no goal opens Goal setup and then comes back |
| Pending, creator | Their score so far, waiting on accepts. They may already have sets in the window |
| Active | Standings and the action above |
| Completed | Frozen result. Draw is the word when rank 1 is shared |
| Expired | "Ended — not enough people played." No winner |
| Cancelled | "Cancelled." |
| Offline | Last fetched detail. Start my set still works for `best_set`; the upload waits |

**Navigation.** Start my set → Session with the challenge id. Back → Challenges.

### 6.9 Goal setup

**Purpose.** Pick a program or type a daily number. Switch later, from the same screen.

**Contents.** Two choices: **Follow a program** and **Set my own number**.

Programs show the name, one sentence, the current week's target, and the length. Expanding a program shows the week-by-week table from section 7.2. The custom control steps by 5 from 5 to 500, starting at 30. Those bounds are settings; the database allows 1 to 2000 so a later settings change does not need a new table.

Switching explains: "Starting today, this is your goal. Yesterday stays on the old one. Your streak uses the goal that was active that day."

If today is a Sunday and they pick First 20, the screen says "Sunday is a rest day in this program. Today is rest. Monday starts the work."

**States.**

| State | What they see |
|---|---|
| First run | The three programs and the custom number. Nothing pre-selected. Save is disabled until they pick |
| Already enrolled | The current choice marked, and the others available |
| Offline, anonymous | The programs bundled in the app. Save writes the phone |
| Offline, signed in | The bundled programs. Save writes the phone and queues `enroll_goal`. On the next successful sync that call applies, unless the server's open enrollment changed after this phone saved. Then the server row wins and Today refreshes from it |
| Online | The picker lists server programs with `active = true`. The bundle is the fallback |

**Navigation.** Save → back to Today. The ring uses the new target immediately.

### 6.10 Friends, invite, account

**Friends.** Unchanged list, search, requests, block, and remove. Copy adds: "Friends are on your weekly league together." Removing a friend takes them off the league on the next load. It does not delete a challenge you are both already in.

**Invite.** Same token screen as today. It shows the kind and the window instead of the old format name, the scores so far, and Accept / Decline. Link problems stay `not_found`, `revoked`, `closed`, `expired`, `used_up`, `full`. Accept still asks whether to become friends with the creator. Skipping that still joins the challenge and leaves the league unchanged. A streak accept with no goal goes to Goal setup first. The server rejects the accept until a goal exists.

**Account.** Sign in with Apple, username, the test push, delete account, Speak quality, Haptics, and notification controls: daily reminder on/off and time, pass ping on/off, Sunday recap on/off and time, quiet hours start and end. Signed-out people get the same controls for the on-phone reminder; pass ping and the Sunday push are explained as needing an account.

**How counting works.** The five steps from today's Start screen, once, then available from Today.

## 7. Scoring

Defaults live in `app_settings` so a tune is a row edit, not an app release. A challenge copies the numbers it must not lose into its own row at creation (`form_weights`, `scoring_version`, and for a streak the participant's floor).

### 7.1 Today versus your usual weekday

Look at the previous `usual_lookback_weeks` (8) dates with the same weekday, not including today. A date counts as a sample only if it is on or after the earlier of the first set's date and the first goal's start date. Days with zero counted reps stay in the median. If there are fewer than `usual_min_samples` (3) samples, the line is hidden.

`delta = today's counted reps − median(samples)`.

The line uses the weekday name of today in the viewer's zone.

### 7.2 Goals and the three programs

A person has at most one open goal. On a past date D the goal is the enrollment with `started_on ≤ D` and (`ended_on` null or `D < ended_on`).

Switching on a later day closes the open row with `ended_on = today` and inserts a new row starting today. Switching again the same day updates the row that already starts today, so a goal that never covered a finished day does not leave a history row. There is no "remove my goal". After the first save, they always have one. A vacation with no rest day breaks the streak. That is deliberate.

Program day number is `(date − started_on) + 1`. The segment that contains that day supplies the target. After the last day, if `maintains_after` is true, the last segment stays in force. Sunday rest uses the calendar Sunday of that date (ISO weekday 7), not "the 7th day of the program".

Completion is calculated, not stored:

- **First 20 in a row** completes when any set during that enrollment has at least 20 counted reps. "In a row" means one set. Shallow reps do not add and do not end the set.
- **50 a day** and **100 a day in 30 days** complete when the ramp's last day has ended, whether or not every day was hit. The badge means the calendar finished. The streak is what records the days they actually hit. The daily target then stays on the last segment.

| Program | Days | Daily target | Sunday | One-set marker (celebration only) | After the ramp |
|---|---|---|---|---|---|
| First 20 in a row | 1–7 | 10 | rest | 5 | |
| | 8–14 | 15 | rest | 10 | |
| | 15–21 | 20 | rest | 15 | |
| | 22–28 | 25 | rest | 20 | stays at 25, Sunday off |
| 50 a day | 1–7 | 20 | works | | |
| | 8–14 | 30 | works | | |
| | 15–21 | 40 | works | | |
| | 22–28 | 50 | works | | stays at 50, every day |
| 100 a day in 30 days | 1–7 | 40 | works | | |
| | 8–14 | 55 | works | | |
| | 15–21 | 70 | works | | |
| | 22–30 | 100 | works | | stays at 100, every day |

Hitting every target is 420 counted reps over the four weeks of First 20 (Sundays off), 980 over the four weeks up to 50, and 2,055 over the 30-day ramp. The one-set marker is a celebration on the after-set screen. The ring always uses the daily target, so several sets can fill the day.

Custom goal: the same number every day, no rest day. The save path rejects numbers outside the settings bounds (default 5–500). The table allows 1–2000 so the bounds can move.

**Personal streak.** Walk calendar dates from the first enrollment through today in the current zone. A date before today is met (counted reps ≥ target and target > 0), rest (target 0), or a miss. Today is met, rest, or still open. Walking backward from today: an open today does not break and does not add; a rest day does not break and does not add; a met day adds one; a miss stops. The current streak is that count. The longest streak is the longest such run in history. Both ignore sets that fail the streak filter in section 5.2. All three programs set `maintains_after`, so the last segment stays in force after the ramp. A program with that flag false is not part of this design.

### 7.3 League points

A person's Total number is counted reps on local dates in the Monday–Sunday week that contains today in their current zone. A set is in that week when its recorded local date falls in that Monday–Sunday, and the server received it by the end of that date's week in the **recorded** zone, plus `upload_grace_s`.

Improvement points, all integers:

```
usual     = median of up to baseline_weeks (8) completed weeks before this one
            Zeros stay in. Weeks before their first set do not.
            If fewer than baseline_min_weeks (3) such weeks exist, usual is unused.

beat      = 0 if usual is unused
            else floor(max(0, week_reps − usual) × per_rep_above_usual)

goal      = goal_days_hit × per_goal_day

perfect   = perfect_week, only when the week has fully ended,
            at least one day had a target above 0,
            and every such day was hit
            else 0

points    = beat + goal + perfect
```

A rest day is not a scheduled goal day, so it does not block a perfect week. Enrolling on Wednesday means Wednesday through Sunday are the scheduled days.

Defaults in `league_improvement_weights`:

| Key | Default | Role |
|---|---|---|
| `per_rep_above_usual` | 1 | Each counted rep above the usual week |
| `per_goal_day` | 20 | Each day the goal was hit |
| `perfect_week` | 30 | All scheduled days hit, after Sunday ends |
| `baseline_weeks` | 8 | How far back the median looks |
| `baseline_min_weeks` | 3 | Below this, the beat term is 0 |

No negative points. Doing worse than usual is 0 on that term, and goal points still count.

Worked example. Usual week 200, this week 230, goal hit 5 of 6 days, week not over: beat 30, goal 100, perfect 0, **130 points**. A friend whose usual is 400, who did 400, and hit 2 goal days: beat 0, goal 40, **40 points**. The first person leads Improvement. The friend leads Total, 400 to 230. That split is the reason for two tabs.

Rank on Total is by reps. Rank on Improvement is by points, then goal days hit, then reps. `RANK`, so a tie is 1, 2, 2, 4. A full tie shares the rank. Nothing about who got there first breaks a tie.

The crown is rank 1 on the **previous** completed week, same ordering, same receipt rule. At least two people (you and one current accepted friend) have to be on that board, or nobody wears it. Shared rank 1 means two crowns.

### 7.4 Challenge rules

Windows for "today / this week / this month" are frozen when the challenge is created, in the creator's zone at that moment:

| Preset | `starts_at` | `ends_at` |
|---|---|---|
| Day | Creator's local midnight at the start of today | The next local midnight |
| Week | Monday 00:00 of the creator's current week | The next Monday 00:00 |
| Month | 00:00 on the 1st of the creator's current month | 00:00 on the 1st of the next month |
| Streak of N days | Creator's local midnight today | N days later, also at that midnight |
| Custom | The times they pick | The times they pick |

`starts_at` and `ends_at` are the window after that. `anchor_time_zone` is stored so the screen can explain whose midnight it was. Nobody recomputes the window when a profile zone changes.

A set counts in a `total` or `team` window when `started_at` is in `[starts_at, ends_at)`, the receipt rule in section 5.2 passes, and the person was an accepted participant at `started_at` (accept time at or before the set, and not yet forfeited). Accepting later in the window pulls in sets they already did inside it. Forfeiting stops later sets. Earlier sets stay.

`best_set` does not use that pool. It counts sets with `challenge_id` set, capped by `attempts_allowed`, plus the PR #11 claim. Other sets that day still fill the ring and the league.

Results lock in `challenge_results` in the same transaction that marks the challenge completed. The live view serves everyone else. Locked rows are never updated, except the existing `ON DELETE SET NULL` on the set pointer when an account deletion removes a set.

| Kind | Who wins | Tie | When it locks | Expired instead |
|---|---|---|---|---|
| `best_set` | Unique rank 1 on the challenge metric. Order: metric, then counted reps, then tempo. Timed is always rep count, and reps after the clock do not count. Non-rep metrics need at least `min_reps_for_ranking` (5) counted reps or that attempt is unranked | Shared rank 1, no winner. Finish time is not a tie-break | Deadline plus `upload_grace_s`, or earlier when every accepted person has used their attempts and no invite is still open, and at least two people submitted a set | Fewer than two submitted sets |
| `total` | Unique highest counted reps in the window | Same reps, no winner. Tempo is not a tie-break | `ends_at` plus grace. Not before | Fewer than two people accepted |
| `streak` | The last person still hitting the frozen daily bar. Rank is days survived, then counted reps in the window | Longest survivors share rank 1, no single winner | `ends_at` plus grace, or earlier when every accepted person but one is eliminated and at least one judged day has fully ended, or earlier when everyone left is eliminated on the same day count | Fewer than two people accepted |
| `team` | The shared counted total reaches `target_reps`. Every accepted person who has not forfeited wins, including someone on 0 | There is no ranking prize. Contribution is shown | As soon as the total reaches the target, or at `ends_at` plus grace if it never does. Missing the target completes with no winners | Fewer than two people accepted |

Streak details:

- The creator needs a goal to create. Each invitee needs a goal to accept.
- On accept, `streak_floor_reps` is the target they would owe on a training day of the goal active that day. A Sunday rest does not freeze the floor at 0. A custom goal freezes at that number. The floor is at least 1.
- Judged dates use the zone stored on the participant at accept. A local date counts when it is on or after the accept date and inside the window's dates in that zone.
- A judged day eliminates them when that day's counted reps are below the floor. The day is judged only after its local midnight plus `upload_grace_s`, so a set uploaded on the way home still counts. There is no rest-day exception inside the face-off. Their personal ring can still say Rest day. The face-off cannot, or the program with Sundays off would be a free pass.
- Changing goal later does not lower the floor.
- Today, until it ends, does not eliminate anyone.

Forfeit:

- `best_set` keeps today's behavior. The score stays in the ranking.
- `total`: later sets do not count, the person cannot win, earlier reps stay in their displayed total.
- `streak`: they are eliminated at once.
- `team`: later sets do not count toward the shared total, they cannot win, earlier reps stay in the total.

Invites, reminders, cancelling while pending, the 15-minute abandoned-live-lobby rule, and "at least two accepted people to become active" stay as they are in `finalize_battles` today. Live create stays rejected. The schema still allows `mode = live` only when `kind = best_set` and there is no calendar window, so a later phase can turn it on without a new table.

Opponents see current scores before they accept and before they do their own set. `best_set` co-participants can open that attempt's reps and trace. The other kinds return totals only.

Group size stays 2–8 async. The live cap in settings stays 2 for the later phase.

`finalize_challenges` runs from the minute cron, same as `finalize_battles` today. A lock that says "as soon as" means that next pass. The pass waits out `upload_grace_s` after `ends_at` before it freezes a `best_set`, a `total`, a `streak`, or a `team` that missed its target, so a set received during the grace is inside the snapshot. An early lock does not wait: everyone has already submitted a `best_set`, a streak outcome is already decided, or a team has already hit its target.

## 8. Notifications

Pushes go through the outbox and `notify`, as today. The text is built at send time from facts, not stored. A row can carry `not_before`. The sender skips that row until `not_before`. Quiet hours hold a push; they do not delete it. Default quiet hours are 21:00–08:00 in the recipient's zone. Live "they're ready" is the only future kind that may ignore quiet hours, and it is not built here.

Defaults, overridable per account. Anonymous people store the same daily-reminder fields on the phone.

| Nudge | Who | When | Text shape |
|---|---|---|---|
| Daily reminder | Someone with a goal, whose counted reps today are still 0, and whose today is not a rest day | Default 18:00 local, once that day. No goal, no reminder | "No push-ups yet today. Your goal is 30." Opens Today |
| Friend passed you | An accepted friend, pass ping on | A set makes their Total strictly greater than yours, and it was not already. Once per friend per board per your local week. If that same set also passes you on Improvement, send only the Total ping | "Alex passed you this week — 240 to your 230." The Improvement-only ping says "on improvement" and the points. Opens League |
| Sunday recap | Recap on, signed in | Sunday 18:00 local, about the week ending that day | "230 push-ups · 5/6 goal days · 2nd on total, 1st on improvement." Add "You took the total crown." when they did. Opens League |
| Challenge events | Participants | The current battle events, renamed | See below |

The Sunday card on Today (section 6.1) is the in-app recap and also shows for anonymous people. The push is the extra for accounts.

Signed-in people with a registered push token get the server daily reminder only. The phone does not also schedule a local one. Anonymous people, and signed-in people who declined push, get a local notification at the same time, cancelled when a set that day gains a counted rep or when the goal is a rest day. Both use the permission the app already asks for. No new permission string.

Challenge copy, same events as now, with the new nouns:

| Kind | Example |
|---|---|
| `challenge_invite` | "Sunny challenged you: most reps this week." |
| `invite_accepted` / `invite_declined` | "Bob accepted. You're on." |
| `set_submitted` | "Bob is on 28. You have until Fri 6 PM." Used for `best_set`. Window kinds say "Bob is on 40 reps this week." |
| `challenge_reminder` / `challenge_reminder_half` | "4 hours left to beat Sunny's 32." Window kinds remind people who are in and have 0 counted reps, at half time and `reminder_hours_before` (2) before the end, only when the window is long enough that those moments differ |
| `challenge_result` | "You won. 32 to 28." or "Draw." or "Your team hit 500." |
| `challenge_expired` | "The challenge ended before enough people played." |
| `challenge_cancelled` | "Sunny cancelled the challenge." |
| `friend_request` / `friend_accepted` | Unchanged |

`set_submitted` for a window kind fires when a set moves the standings, including a normal solo upload, not only a claimed attempt. At most one such push per actor per challenge per recipient per local day, so a five-set evening is one ping.

## 9. Data model

Stored: raw measurements, and choices people made. Calculated when read: totals, records, streaks, milestones, the usual-day line, both league boards, crowns, and standings of challenges that are not finished.

The locked challenge snapshot stays. It is the same exception `battle_results` is today: one row per participant, written once when the challenge completes, rejected on later update.

### 9.1 Tables we add

Target shape. This is not a migration script.

```text
programs
  id              text primary key          -- 'first_20', 'fifty_a_day', 'hundred_in_30'
  name            text not null
  summary         text not null
  completion_rule text not null             -- 'single_set' | 'finish_schedule'
  completion_set_reps integer               -- 20 for first_20, null otherwise
  maintains_after boolean not null
  sort_order      smallint not null
  active          boolean not null default true
  created_at      timestamptz not null default now()

program_segments
  program_id      text not null references programs(id)
  segment_index   smallint not null         -- 1-based
  day_from        smallint not null         -- inclusive, 1-based
  day_to          smallint not null         -- inclusive
  daily_target    integer not null check (daily_target >= 0)
  rest_weekday    smallint                  -- ISO 7 = Sunday, or null
  set_marker      integer                   -- celebration threshold, or null
  primary key (program_id, segment_index)
  check (day_to >= day_from and day_from >= 1)
```

Segments for one program cover day 1 onward with no gaps and no overlaps. The seed is the three programs in section 7.2. Targets are never updated in place. A different ramp is a new `programs.id`, and the old id is set `active = false`. Renaming the display `name` is allowed. The implementation's database test checks the seed against the table in section 7.2.

```text
goal_enrollments
  id                   uuid primary key default gen_random_uuid()
  user_id              uuid not null references profiles(id) on delete cascade
  program_id           text references programs(id)
  custom_daily_reps    integer check (custom_daily_reps between 1 and 2000)
  started_on           date not null
  ended_on             date                       -- null while open; exclusive
  recorded_time_zone   text not null
  created_at           timestamptz not null default now()
  check ((program_id is not null) <> (custom_daily_reps is not null))
  check (ended_on is null or ended_on > started_on)
```

One open enrollment per user: a unique index on `user_id` where `ended_on` is null. Index `(user_id, started_on desc)`.

```text
notification_prefs
  user_id            uuid primary key references profiles(id) on delete cascade
  daily_nudge        boolean not null default true
  pass_ping          boolean not null default true
  weekly_recap       boolean not null default true
  quiet_start        time not null default '21:00'
  quiet_end          time not null default '08:00'
  nudge_local_time   time not null default '18:00'
  recap_weekday      smallint not null default 7     -- ISO Sunday
                     check (recap_weekday between 1 and 7)
  recap_local_time   time not null default '18:00'
  updated_at         timestamptz not null default now()
```

No row means "use the defaults". The queue reads the row if it exists, otherwise `notification_defaults`.

Anonymous goals and nudge prefs stay on the phone, keys `pushupcounter.goal.v1` and `pushupcounter.nudges.v1`, same fields. On sign-in, local sets upload as they do now. The local goal uploads only when the server has no enrollment. If the server already has one, the server row wins. A person who is already signed in and edits the goal offline queues `enroll_goal`. That call applies on the next sync unless the server's open enrollment changed after the phone saved, in which case the server row wins.

### 9.2 Columns we add on tables that exist

```text
sets.recorded_time_zone   text     -- filled by the app, or by a BEFORE INSERT
                                   -- trigger from profiles.time_zone when absent
sets.challenge_id         uuid     -- rename of battle_id; null except best_set attempts

challenges.kind                 challenge_kind not null
challenges.window_unit          challenge_window          -- null on best_set
challenges.anchor_time_zone     text
challenges.target_reps          integer                   -- team only, > 0

challenge_participants.streak_floor_reps   integer        -- streak only, >= 1
challenge_participants.joined_time_zone    text           -- zone at accept
```

`sets.timer_duration_s` already exists (PR #11). It stays.

`challenges.duration_s` stays and means "this best-set was timed". It is null for an untimed best set and null for every other kind.

`challenges.mode` stays `async | live`.

`attempts_allowed` is null when the kind is not `best_set` (unlimited sets in the window). For `best_set` it stays 1–5, default 1.

`metric` is required for `best_set` and null otherwise. `duration_s` not null forces `metric = rep_count`.

`scoring_version` stays. New rows copy `app_settings.scoring_version` (default 1). The best-set formula below is version 1 and is the formula already in `battle_metric_value`. Window kinds use version 1 of the rules in section 7.4.

Checks:

- `kind = best_set` implies `window_unit` is null and `target_reps` is null.
- `kind` in (`total`, `team`) implies `window_unit` is not null and `ends_at > starts_at`.
- `kind = team` implies `target_reps > 0`.
- `kind = streak` implies `ends_at − starts_at` is between 3 and 92 days.
- `mode = live` implies `kind = best_set` and `window_unit` is null.
- A set's `challenge_id`, when set, points at a `best_set` challenge. The trigger rejects anything else.
- Custom windows shorter than 1 hour or longer than `challenge_custom_max_days` are rejected in `create_challenge`.

### 9.3 What we rename, and what we drop

Rename, in one migration, one transaction. The cron row is the exception and lives in the companion file described after the drop list.

| From | To |
|---|---|
| table `battles` | `challenges` |
| table `battle_participants` | `challenge_participants` |
| table `battle_invite_links` | `challenge_invite_links` |
| table `battle_results` | `challenge_results` |
| `sets.battle_id` and the other `battle_id` columns | `challenge_id` |
| type `battle_mode` | `challenge_mode` |
| type `battle_metric` | `challenge_metric` |
| type `battle_status` | `challenge_status` |
| views `battle_entries`, `battle_standings_live`, `battle_standings` | `challenge_entries`, `challenge_standings_live`, `challenge_standings` |
| `finalize_battles()` | `finalize_challenges()` |
| `create_battle(jsonb)` | `create_challenge(jsonb)` |
| `my_battles(uuid)` | `my_challenges(uuid)` |
| `cancel_battle(uuid)` | `cancel_challenge(uuid)` |
| `friend_battle_record(uuid)` | `friend_challenge_record(uuid)` |
| `private.is_battle_member(uuid)` | `private.is_challenge_member(uuid)` |
| `private.can_join_battle_channel(text)` | `private.can_join_challenge_channel(text)` |
| cron job `finalize-battles` | `finalize-challenges` |

`invite_status`, `friendship_status`, `rep_quality`, and `rep_source` keep their names. Friend RPCs keep their names. `submit_set` keeps its name and reads `challengeId`. It stops reading `battleId`.

Backfill inside that same transaction, before the old columns drop:

| Old row | New row |
|---|---|
| `format = max_reps` | `kind = best_set`, `window_unit` null, `duration_s` null |
| `format = timed` | `kind = best_set`, `window_unit` null, `duration_s` kept |
| `format = multi_day` | `kind = total`, `window_unit = custom`, timestamps kept, `attempts_allowed` null, `anchor_time_zone` copied from the creator's profile |

Multi-day windows today are "N days from now", not a calendar week. They stay custom absolute windows. They are not rewritten as Monday-to-Monday.

Completed rows are the renamed `battle_results` rows. They are not rescored. An **active** multi-day challenge starts using the new total rule, so solo sets already inside its window join the score. That can raise a live total. Accepted, and called out in the release note.

Drop after the backfill, in the same transaction:

- the three battle standings views, before the column rename, because a view that uses `battle_id` blocks that rename
- column `format`
- type `battle_format`
- the old function names, once the new functions exist

`user_stats` is not part of this rename. Slice 3 drops that view when `my_progress` lands. The app never called it. The cron rename is not in this transaction either. A companion `*_cron.sql` unschedules `finalize-battles` and schedules `finalize-challenges`. Local database tests skip that file.

Outbox kinds rename in that same migration: `battle_invite`, `battle_result`, `battle_expired`, `battle_cancelled`, `battle_reminder`, and `battle_reminder_half` become the `challenge_*` names in section 8. The `kind` check is rewritten to those names first, then unsent rows are updated. `friend_request` and `friend_accepted` stay. `invite_accepted`, `invite_declined`, and `set_submitted` already have no `battle_` prefix and stay.

`challenge_results` gains nullable columns so one snapshot fits every kind: `kind`, `days_survived`, `eliminated_on`, `team_total`, `team_target`. Existing best-set columns stay (`best_set_id`, `valid_reps`, `avg_depth_pct`, `tempo_score`, `metric`, `metric_value`, `rank`, `is_winner`, `scoring_version`, `attempts_used`, `locked_at`). For a total, `metric_value` equals counted reps. For a streak, `metric_value` equals `days_survived`. For a team, `valid_reps` is that person's contribution and `team_total` / `team_target` are the shared numbers.

The realtime topic becomes `challenge:<uuid>`. Nothing in production runs a live lobby today. The new app accepts the old `battle:` topic as well, so a client mid-upgrade does not join the wrong room later.

### 9.4 Settings keys we add

Existing keys stay, including `claim_set_max_age_s`, form weights, participant caps, and the current reminder pair.

| Key | Default | Meaning |
|---|---|---|
| `scoring_version` | `1` | Copied onto each new challenge |
| `upload_grace_s` | `900` | Receipt grace for league and challenges |
| `personal_backfill_days` | `60` | Streaks ignore sets older than this at upload |
| `usual_weekday` | `{"lookback_weeks": 8, "min_samples": 3}` | The Today line |
| `league_improvement_weights` | section 7.3 | Improvement points |
| `notification_defaults` | section 8 | Quiet hours, 18:00 nudge, Sunday 18:00 recap, all three nudges on |
| `custom_goal_reps` | `{"min": 5, "max": 500, "step": 5, "suggested": 30}` | The custom control. RPC enforces min and max |
| `streak_lengths` | `{"options_days": [7, 14, 30], "min_days": 3, "max_days": 92}` | Streak face-off lengths |
| `team_targets` | `{"options": [200, 500, 1000], "min": 10, "max": 100000, "default": 500, "default_window": "week"}` | Team goal chips |
| `challenge_custom_max_days` | `92` | Longest custom window |
| `friends_visibility` | `"league_and_challenge_results"` | Documents the RPC contract. Set RLS does not get wider |

The old app only accepts `friends_visibility = battle_results_only` and otherwise keeps its built-in default, which is the same restriction. Changing the stored value does not widen what old builds can read.

The phone ships a copy of the three programs and these defaults so Today works with no network. When a fetch of `app_settings` and `programs` succeeds, the server copy wins.

### 9.5 Views and functions

Personal views are `security_invoker`. They only see sets the caller can already read.

| Signature | Returns |
|---|---|
| `view daily_totals` | `user_id, local_date, counted_reps, set_count` |
| `view weekly_totals` | `user_id, week_start date, counted_reps` (Monday of the set's recorded local date) |
| `view monthly_totals` | `user_id, month_start date, counted_reps` |
| `view goal_for_date` | `user_id, local_date, target_reps, rest, program_id, enrollment_id` |
| `my_progress()` | `jsonb` for the caller: today (reps, target, rest, goal met, usual, delta), current and longest streak, lifetime reps, the three badges with `earned_on`, the records shelf, and the chart series (14 days, 12 weeks, 12 months, weekly cumulative) |
| `enroll_goal(p jsonb)` | closes or updates today's enrollment per section 7.2 and returns the open row |
| `my_league()` | `jsonb`: `weekStart`, `weekEnd`, `timeZone`, `total[]` and `improvement[]` with `userId, username, displayName, reps or points, rank, crownedLastWeek`, plus baseline fields on improvement |
| `create_challenge(p jsonb)` | `{challengeId, inviteToken}`. Payload: `kind`, optional `metric`, `durationS`, `deadlineHours`, `window` (`day\|week\|month\|custom`), `customStartsAt`, `customEndsAt`, `streakDays`, `targetReps`, `friendIds`, `inviteLink`, `linkMaxUses`. Rejects `mode = live`, a streak with no goal, a bad window, and an empty audience |
| `my_challenges(p_challenge uuid)` | the current `my_battles` document, plus `kind`, `windowUnit`, `targetReps`, `startsAt`, and streak/team fields |
| `finalize_challenges()` | today's finalize, for all four kinds, plus the early locks in section 7.4, plus `queue_personal_nudges()` |
| `queue_personal_nudges()` | inserts due daily nudges, pass pings, and recaps, with `not_before` set |
| `friend_challenge_record(p_user uuid)` | the current W/L/D document. A team or streak or total win counts as a win. A draw counts as a draw. Expired and cancelled do not count. Still friends-only, still no solo history |

`challenge_standings` keeps the current shape: locked rows for completed challenges, live rows otherwise, `is_winner` false until lock.

`my_league()` is `security definer`, `search_path` pinned, `execute` granted to `authenticated` only. It checks `auth.uid()` and accepted friendships and returns aggregates only. It does not return set ids. Definer bypasses row level security, so this function is the privacy boundary and gets the same review a policy would.

`my_progress()` is `security invoker`. It only aggregates the caller's sets.

`daily_totals` and its siblings are granted `select` to `authenticated`. They are not granted to `anon`.

Pass-ping dedupe needs a column the outbox does not have. Slice 5 renames `private.notification_outbox.battle_id` to `challenge_id` with the other `battle_id` columns. Slice 7 runs after that rename. It adds `notification_outbox.dedupe_key text not null default ''` and extends the unique key to `(kind, user_id, challenge_id, actor_id, dedupe_key)`, still `nulls not distinct`, matching today's constraint. Existing rows get `''`, so pairs that were unique before stay unique.

Daily nudge key: the local date. Pass key: `total:2026-10-26` or `improvement:2026-10-26`, the recipient's week start. Recap key: that week start. Window-kind `set_submitted` key: the recipient's local date.

### 9.6 Indexes and why there is no materialized view

Already present and enough at beta size: `sets (user_id, started_at desc)`, the open-battle partial index, friend indexes, participant indexes.

Add with the new tables: `goal_enrollments (user_id, started_on desc)` and the partial unique index in section 9.1.

Do not add a materialized view. A person has hundreds of sets, and a league row touches that person plus their friends for one week. If `my_league` or `my_progress` is slower than 300 ms at the 95th percentile on staging, the first change is an index on the set lookup the plan actually uses, not a stored total. A materialized view would only be a disposable copy of these views, refreshed by the minute cron, and it would never be the input to a locked result. That is out of this design.

### 9.7 Row level security

| Object | Who can read | Who can write |
|---|---|---|
| `programs`, `program_segments` | `anon` and `authenticated` | service role only. No client insert policy |
| `goal_enrollments` | the owner | `enroll_goal` only. No insert/update/delete policy |
| `notification_prefs` | the owner | the owner, their own row |
| `challenges`, participants, invite links, `challenge_results` | the policies battles use today, renamed | the RPCs and triggers that already exist, renamed. `challenge_results` stays read-only with the immutability trigger |
| `sets`, `reps`, `set_traces` | unchanged: owner, plus co-participants when `challenge_id` is set | unchanged. Clients still cannot update sets. The claim path stays service-role `submit_set` |
| `daily_totals` and the other personal views | invoker, so the set policy applies | not writable |
| `my_league()` | the caller, aggregates of self and accepted friends | not writable |
| `private.notification_outbox` | nobody through the API | triggers and the service role, as today |

A `total`, `streak`, or `team` challenge does not set `challenge_id`, so joining one does not unlock another person's sets. `my_challenges` for those kinds returns the aggregate standings from a definer path that checks membership, not from a set select.

Blocks stay as they are: the blocked person is not told, and they cannot be invited. League membership requires `friendships.status = accepted`. Pending and blocked pairs are off the board.

Deleting your own solo set is still allowed when `challenge_id` is null. It drops out of personal stats, out of unlocked windows, and out of the league. A locked snapshot keeps its numbers. You still cannot delete a set that is a `best_set` attempt.

`delete_my_account` keeps cascading through profiles. Challenge rows they created stay for the other people, with `created_by` null, same as battles.

## 10. What the app changes, by area

No change in `modules/pushup-sensors`, `app.config.ts` native keys, associated domains, or the app version. Runtime version stays on the app version policy, so this reaches the installed binary by OTA.

| Area | Change |
|---|---|
| Navigation | Today replaces Start as the root in slice 1. `@react-navigation/bottom-tabs` arrives in slice 5. `battle/` and `challenge/` both route to the detail screen |
| New screens | Today, Progress, Goal setup, League. Battles screens become the challenge screens in slice 5 |
| `SessionRecord` | Optional `timeZone`, stamped at End set. Old records omit it |
| Local math | One TypeScript module for the ring, streak, usual day, records, milestones, and league points, used offline and in tests. The database functions are the signed-in source of truth. Fixtures run through both, the way battle scores already compare |
| Summary | Counted reps, form score, today's contribution, one celebration, the new challenge menu |
| `challengeFromSet` | Replaces the max-reps / timed / multi-day list with section 6.3 |
| Account | Slice 1 moves Speak quality and Haptics here. Slice 3 refreshes the zone on launch. Slice 7 adds the nudge controls |
| RPCs the client calls | `my_progress`, `enroll_goal`, `my_league` from slice 3–4. Slice 5 switches `create_battle` / `my_battles` / `battleId` over to the challenge names and `challengeId` |
| Bundled seed | The three programs and the setting defaults |
| `supabase/staging/test_bot.sql` | Slice 5 calls `create_challenge` |
| Edge `notify` | New kinds and the renamed challenge kinds, in the slice that adds them |

History's 200-set cap stays. Server charts are how a signed-in person sees the rest.

## 11. Migration and rollout

This design PR ships nothing to phones or databases.

Implementation migrations are expand-only until slice 5. Slice 5 is the break, on purpose. Do not keep `battle_format` alive beside `kind`.

| Slice | Database | App | Breaks old builds? |
|---|---|---|---|
| 1–2 | None | Phone only | No |
| 3 | Add `sets.recorded_time_zone` (trigger fills it when the insert omits it, then it can be `not null`). Add programs, segments, enrollments. Seed programs. Add the progress settings. Add `my_progress` and drop `user_stats`. Leave the battle views in place | Sends the zone. Calls `my_progress` and `enroll_goal` | No. Old `submit_set` still inserts. The trigger fills the zone |
| 4 | `my_league`, improvement settings, `friends_visibility` value | League screen | No. Old builds never selected the new functions |
| 5 | The rename, backfill, and drops in section 9.3, in one transaction. Cron file reschedules `finalize-challenges` (a `*_cron.sql` file, which the local database tests already skip) | Challenge names, tab bar, new kinds `best_set` and `total` | Yes, for battle screens, until OTA applies |
| 6 | None. Slice 5's checks already allow `streak` and `team`, and `create_challenge` rejects those two kinds until this slice | Those two kinds | No |
| 7 | `notification_prefs`, `dedupe_key`, nudge kinds, `queue_personal_nudges` inside `finalize_challenges` | Account controls and local reminder | No |

Order inside the slice 5 transaction:

1. Add the `challenge_kind` and `challenge_window` enums and the new columns from section 9.2. `recorded_time_zone` is already on `sets` from slice 3.
2. Backfill `kind` and `window_unit` from `format`, using the table in section 9.3. Clear `attempts_allowed` and `metric` on rows that become `total`.
3. Drop `battle_entries`, `battle_standings_live`, and `battle_standings`. A later `rename column` fails while those views still depend on `battle_id`.
4. Rename the tables, the `battle_id` columns, and the mode, metric, and status enum types.
5. Create the views and functions under the new names, reading `kind` and `challenge_id`. Drop the old function names in the same step. This is the rename in section 9.3: the bodies change, so it is create-and-drop rather than `alter function ... rename`.
6. Add the nullable snapshot columns on `challenge_results`. That table is the renamed `battle_results`, so completed rows are already there. Do not recompute them.
7. Rewrite the outbox `kind` check, then update unsent rows to the `challenge_*` names.
8. Drop `format` and `battle_format`.

One transaction, so a failure leaves the old schema. The cron reschedule stays in a separate `*_cron.sql` file, which the local database tests already skip.

`create_challenge` in slice 5 accepts `best_set` and `total` only. Slice 6 removes that rejection for `streak` and `team`. The checks in section 9.2 are in place from slice 5, so a hand-written insert cannot invent a third shape.

Rollout of each implementation merge:

1. PR into `dev`. Push to `dev` runs the staging database (`pushup-battles-staging`) and the development OTA channel (Pushup Dev).
2. Check the slice on the dev client against staging. Slice 5 includes an active multi-day challenge, if one exists, and a completed battle, which must keep its winner.
3. Release PR `dev` → `main`. Push to `main` runs production (`pushup-battles-prod`) and the production OTA / TestFlight path.
4. Slice 5's migration and the app that speaks `challengeId` land in the **same** merge to `dev`, and later the same release to `main`. Do not ship the rename without the app, or the app without the rename.
5. Do not bump the app version. Do not add a native dependency. The fingerprint stays, so EAS Update delivers it. Installed apps pick the JavaScript up on the launch after the download. Those one or two launches can show an error on the battle screens. That is accepted for this beta. There is no dual-read period.

Personal progress in slices 1–4 does not depend on the rename. The after-set challenge button keeps the PR #11 menu until slice 5.

## 12. Build order

Each slice is usable on its own.

1. **Today, on the phone.** Ring, streak, usual line, goal setup with the bundled programs, after-set contribution and celebration. Speak quality and Haptics move to Account with the Start screen. Anonymous works. The old Battles button stays, including claim-this-set. The Sunday card waits for slice 7.
2. **Progress, on the phone.** Charts, shelf, badges, from local history, including the 200-set note.
3. **Backup.** Zone column, enrollments, `my_progress`. A second phone sees the same ring after sign-in. Launch updates `profiles.time_zone`.
4. **League.** Both tabs, crowns, the friend screen's week numbers. Uses the friend table that already exists.
5. **Challenges.** The rename, `best_set` parity with today's battles (claim rules included), `total` for a day, a week, and a month, the new after-set menu, the tab bar.
6. **Streak face-off and team goal.**
7. **Nudges.** Local daily reminder, pass ping, Sunday push, quiet hours, the Sunday card.

## 13. Open questions

The spec above already picks an answer for each of these, so implementation does not wait. They are the choices most worth a look before slice 1.

1. **Sunday rest is only on First 20.** 50 a day and 100 a day have no rest, because the names say "a day". Change the seed if those should take Sundays off too.
2. **Receipt grace is 15 minutes**, up from the battle rule of 5. Personal history still keeps a later upload. Lower `upload_grace_s` if a next-morning upload should miss more often. It already misses anything past the grace.
3. **A pass ping is once per friend per board per week**, and a set that passes you on both boards sends only the Total ping.
4. **A best-set opponent can see that attempt's chart.** Window challenges and the league show numbers only. This matches today's battle screens.
5. **Streak and team can finish early** when the outcome is already decided. Total and best-set do not, except best-set's existing "everyone has submitted" rule.
6. **Crowns follow the current friend list.** Unfriending someone takes them out of last week's crown. We do not store crown rows.
7. **The custom goal starts at 5**, not 1, so a streak cannot be a single rep. The setting can move the minimum.
8. **There is no vacation switch.** Missing a targeted day breaks the streak. Rest exists only on days the program marks as rest.
9. **"20 in a row" is 20 counted reps in one set.** A shallow rep in that set does not add and does not split the set.

## 14. Self-review

Checked against the migrations on `dev` and against this document.

- No placeholder markers, and no requirement left as "decide later". Section 13 lists judgment calls whose answers are already written into sections 5–9.
- Counted reps are defined once (section 4) and used for the ring, streak, records, milestones, league, and every challenge kind. The `good_reps` column is called out as the wrong field.
- Shallow reps stay visible on the set analysis and stay out of the game. Tempo stays consistency. Ties ignore finish time.
- The daily total is the unit. A set with a `best_set` link still sits in today, the week, and any total or team window that covers it. Window kinds do not take an exclusive link, so two windows can see the same set.
- Goals: one open enrollment, history kept, same-day switches update in place, rest days affect the personal streak and do not loosen a streak face-off. Programs are immutable at the target numbers. Completion is calculated.
- League is a query over `friendships` and sets. Crowns are that query on the previous week. The only stored "result" is `challenge_results`, the existing lock, renamed.
- Time zones: the set's zone is frozen; "today" uses the current zone; challenge windows are absolute timestamps frozen at creation. Late personal sync and late competitive sync use different cutoffs, and the screens say which one happened.
- Anonymous people get the personal game and the local reminder. League, challenges, pass pings, and the Sunday push need an account. Sign-in uploads the local goal only when the server has none.
- Friends were already a table. The spec does not add another. Link invites can still join a challenge without becoming friends, and those people stay off the league.
- Privacy: set policies do not grow. Friend-facing numbers come from definer functions that return aggregates. Best-set co-participants still see that attempt.
- Slice 5 is the only breaking migration. The schema change runs in one transaction. The cron reschedule is a companion `*_cron.sql` file, because local database tests skip those. It goes to staging on `dev` first, and ships with the app that calls the new names. Slices 1–4 and 6–7 do not strand an old binary. No native change, no version bump, OTA.
- Active multi-day battles can gain solo reps when they become `total`. Completed battles keep their snapshot. That is the one intentional rescore, and only for challenges that have not locked.
- `user_stats` goes away in slice 3, when `my_progress` lands. The app never called it. The replacement uses counted reps and the goal. Battle views stay until slice 5.
- Out of scope, left as they are: the live lobby, the invite-link domain, App Attest, and editing another person's locked result.

# Notifications

How push and on-phone notifications should work in Rep Royale, what they do today, and the fixes to make the two match. This is the product/UX contract. Copy stays plain and generic.

This document does not change app or backend behavior on its own.

## The 27 Nov 2026 report

Sunny has a friend named Lizzy. She finished a set of 4 reps, he got a push, and tapping it opened the **wrong challenge**.

### What the notification said

The exact title and body were **not stored**. `private.notification_outbox` keeps `kind`, `challenge_id`, `actor_id`, and timestamps, not the rendered text. Edge function logs for `notify` only show `POST | 200` with no payload. The text below is a **reconstruction** from the same code path `notify` v5 used at send time (`buildNotification` in `supabase/functions/_shared/notificationContent.ts`, plus `private.notification_facts` as it still evaluates for this row).

| | |
|---|---|
| Title | Challenge update |
| Body | lizzy is on 0 reps today. |
| Data | `{ type: "set_submitted", challengeId: "3139f6fb-2faf-4ff7-ab74-2f0084df005e", url: "pushupcounter://challenge/3139f6fb-2faf-4ff7-ab74-2f0084df005e" }` |

How this was found (all times America/New_York):

1. Lizzy (`username` / `display_name` both `lizzy`) uploaded set `b0fa7b5c-2512-48c6-a0b0-5a1491fc1f41`: 4 counted reps, `challenge_id` null (a solo set, not attached to any challenge). It ran 2:58:24–2:58:37 PM and arrived at 2:58:38 PM.
2. At that same timestamp the outbox gained row `15083`: kind `set_submitted`, actor Lizzy, recipient Jack Roseman (`jack`), challenge `3139f6fb-2faf-4ff7-ab74-2f0084df005e`. It was sent at 2:59:01 PM, which matches a `notify` drain in the function logs.
3. That challenge is **most reps today**, participants **Jack and Aaron** only. Lizzy is not a participant. Jack and Lizzy have no challenge together (they became friends earlier that afternoon, at 1:21:58 PM).
4. `notification_facts` has no `actorScore` for Lizzy on that challenge (`challenge_standings_live` only includes participants), so `buildNotification` falls back to `validReps ?? 0` and the window copy: `lizzy is on 0 reps today.`

A second outbox row (`15084`) queued the same event for Aaron; it was never sent (no push token).

### Why the tap opened the wrong challenge

The client opened the challenge id that was already in the push. The id in the push was the wrong challenge.

**How the id is written.** Window challenges (most reps, streak, team) are not tied to `sets.challenge_id`. `notify_window_set` (AFTER INSERT on `public.reps`, function `private.tg_notify_window_set`) looks at every `pending` or `active` window challenge whose time range covers the set and inserts a `set_submitted` outbox row for each of that challenge's invited/accepted participants except the person who did the set. It does **not** require the actor to be a participant. Lizzy's solo set fell inside Jack and Aaron's most-reps-today window, so the outbox (and then the push) got `challenge_id = 3139f6fb-…`.

`buildNotification` then copies that same id into both `data.challengeId` and `data.url` (`pushupcounter://challenge/<id>`). There is no separate per-recipient challenge row, and no swap between sender and recipient ids — one challenge row, one id, written faithfully, but chosen incorrectly.

**How the app resolves a tap.** `RootNavigator` reads `data.url` (not `data.challengeId`) through `notificationLink` / `parseAppLink`, and React Navigation maps `challenge/:challengeId` to the `Battle` screen. `BattleRoute` passes `route.params.challengeId` into `ChallengeScreen`. The in-memory cache (`rememberedBattle`) is keyed by that same id and is only used when the ids match. So a successful tap of this push opens challenge `3139f6fb-…` — Jack vs Aaron, most reps today — which has nothing to do with Lizzy.

That is the wrong challenge: the payload pointed at it, and routing followed the payload.

Two related problems made the push even less trustworthy:

- The body said "0 reps" because standings do not include a non-participant, even though the set had 4 counted reps.
- The title "Challenge update" and Lizzy's name made it reasonable to believe they shared a challenge they do not.

A solo set by a friend should not notify anyone about a challenge she is not in. If a later "a friend just finished a set" ping is wanted, that is a new, opt-in kind, and its tap target should be that friend or Today — not an unrelated challenge.

## Intended UX

Recipients are signed-in users with an active push token, except the daily reminder, which can also be scheduled on the phone when there is no token. Quiet hours (default 9:00 PM–8:00 AM local) should delay **reminders and personal nudges** until they end. Social and challenge events (requests, invites, accepts, results, a genuine set in a shared challenge) should go out when they happen, even during quiet hours — those are time-sensitive. There is no in-app opt-out for friend or challenge events today; iOS permission is the master switch. Pass ping, Sunday recap, and the daily reminder have their own Settings toggles.

Tap destinations use the app scheme `pushupcounter://…`. The same path must work from a cold start, from the background, and from a foreground banner.

| Kind | Trigger | Recipient | Copy (plain, generic) | Tap opens | Grouping / throttling |
|---|---|---|---|---|---|
| `friend_request` | Someone sends a friend request | The other person | Title: Friend request. Body: `{name} wants to be friends`. | Friends | One per request. |
| `friend_accepted` | Someone accepts your request | The person who asked | Title: New friend. Body: `{name} accepted your friend request. Challenge them!` | Friends | One per accept. |
| `friend_joined` | Someone uses your personal invite link | The link owner | Title: New friend. Body: `{name} used your invite link. You're now friends.` | Friends | One per redemption. |
| `challenge_invite` | You are invited to a challenge | The invitee | Title: New challenge. Body: `{name} challenged you: {challenge phrase}.` | That challenge | One per invite. |
| `invite_accepted` | Someone accepts, or joins from a link | The creator | Title: Challenge accepted. Body: `{name} accepted. You're on.` | That challenge | One per accept. |
| `invite_declined` | Someone declines | The creator | Title: Challenge declined. Body: `{name} declined.` | That challenge | One per decline. |
| `set_submitted` (window: most reps / streak / team) | A **participant** records counted reps in the window | Other invited or accepted participants | Title: Challenge update. Body: `{name} is on {n} reps {today / this week / this month}.` Use the actor's current standing at send time, never `0` when they just scored. | That challenge | At most once per recipient, challenge, and actor per local day. Do not fire for a set whose actor is not in the challenge. |
| `set_submitted` (best set) | A **participant** submits an attempt | Other invited or accepted participants | Title: Challenge update. Body: `{name} is on {score}.` Add `You have until {deadline}.` only if the recipient has not yet submitted. | That challenge | Once per attempt that changes their standing, not only the first attempt ever. A short debounce is enough to avoid a burst; do not drop later, better sets. |
| `challenge_reminder` / `challenge_reminder_half` | Half time, and N hours before the deadline (app setting, currently 2 hours) | Participants who still need to act: no best-set attempt yet, or (for a window challenge) may still want to add reps | Title: Challenge reminder. Body: `{N hours left / Under an hour left}` and, for best set, `to beat {leader}'s {score}` when there is one. | That challenge | One of each kind per recipient per challenge. For window challenges, still remind people who already have some reps. |
| `challenge_result` | The challenge completes | Accepted and forfeited participants | Title: Challenge results. Body: `You won. {yours} to {theirs}.` / `You came {nth} of {n}.` / `Draw.` / for a team win, `Your team hit {target}.` | That challenge | One per person when it finishes. |
| `challenge_expired` | Not enough people played before the deadline | Accepted participants | Title: Challenge ended. Body: The challenge ended before enough people played. | That challenge | One per person. |
| `challenge_cancelled` | The creator cancels | Invited and accepted participants | Title: Challenge cancelled. Body: `{creator} cancelled the challenge.` Prefer the display name, not `@username`. | That challenge | One per person. |
| `daily_nudge` | Local reminder time, a goal day, no counted reps yet | That user | Title: Today. Body: `No push-ups yet today. Your goal is {n}.` | Today | One per local day. Server sends it when a push token is registered; otherwise the phone schedules it. Never both. Honor quiet hours. |
| `pass_ping` | A friend passes you on Total or Improvement this week, after your prefs existed | You, if Pass ping is on | Title: League. Body: `{name} passed you this week — {theirs} to your {mine}.` (or `on improvement`). If the same set passes you on both boards, only the Total ping. | League | At most one Total and one Improvement ping per week. |
| `weekly_recap` | Recap weekday and time (default Sunday 6:00 PM) | You, if Sunday recap is on | Title: Your week. Body: `{n} push-ups · {hit}/{scheduled} goal days · {nth} on total, {nth} on improvement.` Add `You took the total crown.` when that is true. | League | One per week. |
| Test push | Settings / enable flow, `{ test: true }` to `notify` | Your devices only | Title: Rep Royale. Body: Notifications are working. You will hear from us when a friend challenges you. | Today | Only when requested. |
| Permission sheet | First time you create, accept, or join a challenge while notifications are off | That phone | Title: Turn on notifications. Line: Stay in the loop with your friends and challenges. | — | Once per phone. After that, only Settings › Notifications. |

`{challenge phrase}` is already in code: `most reps today` / `this week` / `this month`, `best set · {n} s`, `a streak face-off`, `a team goal`. `{name}` is the display name, or the username if there is no display name.

## Current behavior vs intended

### Sending and copy

| Topic | Current | Intended |
|---|---|---|
| Window `set_submitted` | `tg_notify_window_set` notifies participants of every overlapping window challenge, even when the actor is not in it. Lizzy's solo set notified Jack (and queued Aaron) about most reps today. | Only when the actor is an invited or accepted participant of that challenge. |
| Window copy | Missing `actorScore` becomes "is on 0 reps …". | Do not send a window update without a real standing, and never report 0 when the set had counted reps. |
| Best-set `set_submitted` | `private.enqueue` leaves `dedupe_key` empty, so the unique key allows only one notification per actor per challenge, ever. A later, better set is silent. | Notify again when their standing changes. |
| Best-set vs window delivery | Best-set uploads go through `submit-set`, which drains `notify` immediately. Window/solo sets wait for the `notify-drain` cron (up to a minute). This is why Jack's push arrived at 2:59:01 PM, 23 seconds after the set. | Either path should drain promptly once a real notification is queued. |
| Challenge reminders | `notification_facts.mySetDone` is true for a window challenge as soon as the recipient has any counted reps, and `buildNotification` then drops the reminder. | Still remind window participants who may want to add reps. |
| Cancelled copy | Uses `@{creator username}`. | Display name, same as other kinds. |
| Test push | `data` is only `{ type: "test" }` — no `url`. A tap goes nowhere. | `url: pushupcounter://today`. |
| Quiet hours | `lease_notifications` skips **every** kind, including friend requests, invites, and results, until quiet hours end. | Delay only nudges and reminders. |
| Stale unsent rows | Rows for people with no token (Lizzy's `friend_joined`, Aaron's invite and this set update) are retried every minute until `expire_notifications` fails them after a day. If they turn notifications on later, they can get an hours-old event. | Fail sooner when the recipient has no token, or drop social events older than a short window. |
| Stored text | Outbox and logs do not keep title or body, which is why this report had to be reconstructed. | Persist the sent title, body, and data (or a facts snapshot) on the outbox row. |

Daily reminder duplication is already avoided: `nextLocalReminder` returns null when the user is signed in and a push token is registered, and the server comment matches that split. Keep it that way.

### Taps and routing

The linking path is wired and, for this push, it is what opened the Aaron challenge:

1. Cold start: `getInitialURL` uses `Linking.getInitialURL()`, and only if that is empty falls back to `Notifications.getLastNotificationResponse()` → `data.url`.
2. Background or foreground tap: `addNotificationResponseReceivedListener` passes `data.url` to the same linking subscriber.
3. `linkingConfig` maps `challenge/:challengeId` (and the older `battle/:challengeId`) to `Battle`. `BattleRoute` loads that id.

Gaps against the intended "always open the right screen":

| Topic | Current | Intended |
|---|---|---|
| Challenge id in the payload | Can be a challenge the actor is not in, as in this report. | Always the challenge the copy is about; never a coincidental overlapping window. |
| Which field routing uses | Only `data.url`. `data.challengeId` is used later, and only to refresh a challenge already on screen. The two are set together today. | Keep them in sync. If `url` is missing but `challengeId` is a valid id, still open that challenge. |
| Cold start vs a launch URL | `normalizeUrl` returns a recognized `pushupcounter://` (Today) even when a notification response is also present. Expo's own example has the same order. If iOS hands the app a bare scheme URL, the challenge id in the push is ignored and the tap lands on Today. | If a last notification response has a valid app URL, prefer it over a bare or home-only launch URL. |
| Last response not cleared | The app never calls `Notifications.clearLastNotificationResponse()`. Expo recommends clearing after a tap so a later cold start does not replay it. | Clear after the tap has been turned into navigation. |
| Already on a challenge | The `Battle` stack screen has no `getId`. If `Battle` is already in the stack with a different `challengeId`, React Navigation can surface that existing screen and leave its params unchanged — a second way to see the wrong challenge. The in-memory cache is not this bug (it is keyed by id). | `getId: ({ params }) => params.challengeId` (and the same idea for Friend / Invite), so a tap for a different challenge replaces the open one. |
| Stringified `data` | `notificationLink` requires `data` to be an object. If iOS ever delivers it as a JSON string, the tap is dropped. | Parse a JSON string before reading `url` / `challengeId`. |
| Foreground | `setNotificationHandler` shows a banner and plays a sound, with `shouldSetBadge: false`. Badges are unused. Tapping the banner should route the same as a background tap. | Keep showing the banner (even if that challenge is already open, a refresh is enough). No badge unless we add an unread model later. |
| Permission prompt | The sheet appears once after the first create / accept / join. Settings › Notifications can also request, and scheduling a local daily reminder may request once per launch if daily reminder is on. | One obvious path: the sheet, then Settings. Do not surprise-prompt from the reminder scheduler. |

There is no opt-out for challenge or friend notifications other than turning Notifications off in iOS. That can stay until someone asks for finer controls. iOS grouping / thread ids are not set, so several challenges in a short window appear as separate banners; optional later.

## Prioritized fix list

Do not ship these in this PR. This list is the work that should follow, in order, with the files and functions involved.

### P0 — Wrong challenge on a window-set push

1. **Require the actor to be a participant** before queueing a window `set_submitted`. In `private.tg_notify_window_set` (today's trigger is `notify_window_set` on `public.reps`; original migration `supabase/migrations` personal-nudges / later challenge migrations). The insert should join the actor as an invited or accepted participant of `b`, the same way it already joins the recipients. Add a database test that a friend's solo set (or a set in a different challenge) does not notify participants of an overlapping most-reps window.
2. **Do not render "is on 0 reps"** when `actorScore` is missing. In `buildNotification` (`supabase/functions/_shared/notificationContent.ts`), return null for window `set_submitted` unless there is a real standing. Cover it in `__tests__/notificationContent.test.ts`.

After these two, Lizzy's solo set would not have notified Jack at all.

### P1 — Tap always opens the challenge in the payload

3. **Identify `Battle` screens by challenge id** so a tap for challenge B does not reuse an already-open challenge A. `src/navigation/RootNavigator.tsx` (`Stack.Screen` name `Battle`), plus tests in `__tests__/linking.test.ts`.
4. **Harden `getInitialURL` and the tap subscriber** in `src/navigation/RootNavigator.tsx`: prefer a valid notification `data.url` (or `data.challengeId` turned into `pushupcounter://challenge/<id>`) over a bare scheme launch URL; call `Notifications.clearLastNotificationResponse()` after handling. In `src/backend/linking.ts` (`notificationLink`), accept stringified `data` and fall back from `url` to `challengeId` / `battleId`.
5. **Give the test push a Today URL.** `TEST_CONTENT` in `supabase/functions/_shared/expoPush.ts`.

### P2 — Copy, throttling, and quiet hours

6. **Best-set updates should not be once-ever.** Give `private.enqueue` / `private.tg_notify_set` a dedupe key that still allows a later attempt through (for example the set id, or a new standing). Unique index `notification_outbox_dedupe_key`.
7. **Window reminders should still go to people with some reps.** `private.notification_facts` (`mySetDone` for non-`best_set`) and the `challenge_reminder` branch of `buildNotification`.
8. **Quiet hours should not hold friend or challenge events.** `public.lease_notifications` and `private.has_unsent_notifications` (and the older `claim_notifications` if anything still calls it). Apply `private.in_quiet` only to `daily_nudge`, `weekly_recap`, `pass_ping`, `challenge_reminder`, and `challenge_reminder_half`.
9. **Cancelled-challenge copy** should use a display name. `buildNotification` case `challenge_cancelled`; facts already have `creator` as a username only — extend `notification_facts` if needed.
10. **Persist sent title, body, and data** on `private.notification_outbox` when `notify` settles a row (`drainOutbox` / `public.settle_notifications`), so the next report does not have to reconstruct copy.

### P3 — Delivery hygiene and prompts

11. **Drain `notify` after a window set is stored**, not only after `submit-set` and in-app `api.kickNotify`. Solo/window uploads currently wait for `cron` job `notify-drain` (`* * * * *`, `private.wake_notify`). The client upload path (`src/battles` / set sync) or the insert trigger's existing wake path should kick the drain once a row is actually queued.
12. **Do not request notification permission from the local-reminder effect** in `src/navigation/RootNavigator.tsx`. Leave requests to the challenge sheet (`src/components/NotificationPrompt.tsx`, `src/notifications/prompt.ts`) and Settings (`src/navigation/routes/SettingsRoute.tsx`).
13. **Expire or skip unsent rows** for users with no active token instead of retrying every minute for a day (`private.expire_notifications`, `public.lease_notifications`).
14. Optional later: iOS thread ids in `messagesFor` (`supabase/functions/_shared/pushSender.ts`); a Settings toggle for challenge updates if testers want one; a new opt-in "friend finished a set" kind that opens the friend, not a challenge.

## Permission, badges, and settings (reference)

- iOS permission is requested with alerts, badges, and sound allowed. Badges are never set (`shouldSetBadge: false`) and there is no unread count.
- Settings › Notifications reflects the OS permission (On / Off) and opens the system Settings page once the decision has been made.
- Settings › Daily reminder and Quiet hours require a daily goal. Pass ping and Sunday recap are signed-in toggles written to `public.notification_prefs`.
- Defaults live in `public.app_settings` key `notification_defaults` (daily nudge and recap at 6:00 PM, recap on Sunday, quiet hours 9:00 PM–8:00 AM, all three personal toggles on) and `notifications` (`reminder_at_half_time: true`, `reminder_hours_before: 2`).
- `notify` is deployed with JWT verification off and authorizes itself: anyone may `{ drain: true }` (only sends what the outbox already queued); a signed-in user may send a test to their own devices; a server key may send a custom title/body to given user ids. Tokens Expo reports as `DeviceNotRegistered` are disabled. Receipts are not polled.

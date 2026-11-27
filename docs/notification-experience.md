# Notification specification

This is the living contract for every Rep Royale push: trigger, recipient and eligibility, copy, tap destination, and frequency or throttling. Keep it in sync with the Notification specification Page.

The behavior below is what the app should follow after the notification fixes land (PR 70). Production 1.3.0 does not have them yet. The [current gaps and fixes](#current-gaps-and-fixes) section records what was wrong and what PR 70 changes, as of 27 November 2026, America/New_York.

## Shared rules

Pushes are queued in the outbox and sent through Expo. Title and body are built at send time from live facts, then stored on the outbox row. A tap follows `data.url`, or `challengeId` / `battleId` if the URL is missing. The challenge screen is keyed by challenge id so an already-open different challenge is not reused. A notification URL wins over a bare or Today launch URL, and the last notification response is cleared after it is used.

| Rule | Behavior |
| --- | --- |
| Quiet hours | Default 21:00–08:00 in the recipient’s time zone. Only daily nudge, weekly recap, pass ping, and challenge reminders wait. Social and challenge events go out when they happen. |
| Expiry | If the recipient has no active push token, an unsent row fails after 2 hours so a late permission grant does not deliver a stale event. Other unsent rows fail after 1 day. Rows older than 30 days are deleted. |
| Local reminder | The on-device daily reminder is skipped when the person is signed in and a push token is already registered, so the server daily nudge is the one they get. It uses the same Today copy and destination, and it does not show the system permission prompt itself. |

## Friend request

- **Trigger:** Someone sends a friend request.
- **Recipient:** The person who was asked. Not sent if they already have a pending or accepted request, or if either person has blocked the other.
- **Copy:** Friend request. `{name} wants to be friends.`
- **Tap:** Friends.
- **Frequency:** Once per request. Goes out even during quiet hours.

## Friend accepted

- **Trigger:** The other person accepts a friend request.
- **Recipient:** The person who sent the request.
- **Copy:** New friend. `{name} accepted your friend request. Challenge them!`
- **Tap:** Friends.
- **Frequency:** Once per accepted request. Goes out even during quiet hours.

## Friend joined

- **Trigger:** Someone uses your personal invite link and you become friends immediately.
- **Recipient:** The person who owns the link. Not sent if you redeem your own link, or if you were already friends.
- **Copy:** New friend. `{name} used your invite link. You're now friends.`
- **Tap:** Friends.
- **Frequency:** Once per new friend from a link. Goes out even during quiet hours.

## Challenge invite

- **Trigger:** Someone invites you to a challenge.
- **Recipient:** Each invited participant, other than the creator.
- **Copy:** New challenge. `{name} challenged you: {challenge phrase}.`
- **Tap:** That challenge.
- **Frequency:** Once per invite. Goes out even during quiet hours.

## Invite accepted

- **Trigger:** An invitee accepts.
- **Recipient:** The other invited or accepted participants, not the person who accepted.
- **Copy:** Challenge accepted. `{name} accepted. You're on.`
- **Tap:** That challenge.
- **Frequency:** Once per acceptance, to each other participant. Goes out even during quiet hours.

## Invite declined

- **Trigger:** An invitee declines.
- **Recipient:** The other invited or accepted participants, not the person who declined.
- **Copy:** Challenge declined. `{name} declined.`
- **Tap:** That challenge.
- **Frequency:** Once per decline, to each other participant. Goes out even during quiet hours.

## Challenge update

This is the per-set push. It must not fire on every set, and it must only name a challenge the actor is actually in.

- **Trigger:** A set with counted reps is saved or linked, and the actor is an invited or accepted participant in that challenge. The set must take sole lead, tie for first from behind, pass that recipient, be a first attempt in a best-set challenge, or cross a milestone: 25, 50, 100, 250, 500, or 1,000 (team goals also 25, 50, 75, or 100% of the target).
- **Recipient:** Every other invited or accepted participant who has not left. Not sent for a set by someone outside the challenge, a set with no counted reps, or an uncontested opening score below a milestone (a first 4-rep or 12-rep window set stays silent). The send is dropped if the actor has no standing on that challenge, so the copy cannot say 0 reps for a non-participant.
- **Copy:** Challenge update. For a most-reps, streak, or team window: `{name} is on {n} reps today / this week / this month.` For a best-set challenge: `{name} is on {n}.` If the recipient has not played yet, the body also includes `You have until {deadline}.` Copy stays generic; it does not say took the lead.
- **Tap:** The challenge named in the payload, not some other open or recent challenge.
- **Frequency:** At most one milestone push per recipient, challenge, and actor in 30 minutes. Taking the lead, tying for first from behind, passing someone, and a first best-set attempt are not throttled. Each qualifying set can notify (deduped by set id). Goes out even during quiet hours.

## Challenge reminder

- **Trigger:** The challenge is still open and the deadline is about two hours away.
- **Recipient:** Invited or accepted participants who still have something to do. For a best-set challenge, people who already submitted their attempt are skipped. For a window challenge, people who already have reps that window still get the reminder.
- **Copy:** Challenge reminder. `{n} hours left`, or `Under an hour left`. For a best-set challenge, if someone else has a score: `to beat {name}'s {n}`.
- **Tap:** That challenge.
- **Frequency:** Once per challenge per person. Waits for quiet hours.

## Halfway reminder

- **Trigger:** The challenge is still open and about half the time has passed. For a window challenge, halfway is measured from the start of the window to the deadline.
- **Recipient:** Same eligibility as the two-hour reminder.
- **Copy:** Same shape as the two-hour reminder.
- **Tap:** That challenge.
- **Frequency:** Once per challenge per person, separate from the two-hour reminder. Waits for quiet hours.

## Challenge results

- **Trigger:** The challenge completes and results are written.
- **Recipient:** Every accepted or forfeited participant who was in the challenge when it finished (each person with a result). Invited people who never joined do not get a results push.
- **Copy:** Challenge results. A win is `You won. {yours} to {theirs}.` A loss is `You came {place} of {n}.` A tie at first is `Draw.` A team hit is `Your team hit {target}.`
- **Tap:** That challenge.
- **Frequency:** Once when the challenge completes. Goes out even during quiet hours.

## Challenge ended

- **Trigger:** The challenge ends before enough people played.
- **Recipient:** The invited or accepted participants, including invitees whose invite expired in the same pass that ended the challenge.
- **Copy:** Challenge ended. `The challenge ended before enough people played.`
- **Tap:** That challenge.
- **Frequency:** Once when it expires. Goes out even during quiet hours.

## Challenge cancelled

- **Trigger:** The creator cancels the challenge.
- **Recipient:** The other invited or accepted participants, not the creator.
- **Copy:** Challenge cancelled. `{creator display name, or @username, or The creator} cancelled the challenge.`
- **Tap:** That challenge.
- **Frequency:** Once when it is cancelled. Goes out even during quiet hours.

## Daily nudge

- **Trigger:** It is the person’s reminder time, they have a goal greater than 0, and they have no counted reps today. Not sent on a rest day.
- **Recipient:** A signed-in person with the daily nudge on, a goal, and (for the server push) a registered token. The on-device copy is not scheduled when a token is already registered.
- **Copy:** Today. `No push-ups yet today. Your goal is {n}.`
- **Tap:** Today.
- **Frequency:** At most once per local day. Waits for quiet hours.

## League pass

- **Trigger:** A friend passes you this week on total or on improvement. If they pass on both in the same event, only the total ping is sent; improvement is its own ping when it happens alone.
- **Recipient:** The person who was passed, if pass pings are on. Not sent for a historical lead from before prefs existed.
- **Copy:** League. `{name} passed you this week — {theirs} to your {yours}.` On the improvement board: `{name} passed you this week on improvement — {theirs} to your {yours}.`
- **Tap:** League.
- **Frequency:** Once per pass on a given board. Waits for quiet hours.

## Weekly recap

- **Trigger:** Sunday at the person’s recap time, if weekly recap is on and they had reps that week.
- **Recipient:** That person.
- **Copy:** Your week. `{n} push-ups`, plus goal days and ranks when they have friends and a scheduled goal. If they took the total crown, that is appended.
- **Tap:** League.
- **Frequency:** Once per ISO week. Waits for quiet hours.

## Test push

- **Trigger:** The signed-in person sends a test notification from settings.
- **Recipient:** That person’s registered devices only.
- **Copy:** Rep Royale. `Notifications are working. You will hear from us when a friend challenges you.`
- **Tap:** Today.
- **Frequency:** Each time they send one. Goes out even during quiet hours.

## Permission sheet

- **Trigger:** Shown once on this phone, right after the first time the person creates, accepts, or joins a challenge, if notification permission is not already granted. It is not shown on an ordinary visit. Settings still has a Notifications row.
- **Recipient:** The person using this phone. It is a local sheet, not a push.
- **Copy:** Title: `Turn on notifications`. Body: `Stay in the loop with your friends and challenges.` Actions: `Turn on notifications` and `Not now`. The system prompt is shown only from this sheet or from Settings, not from the local reminder.
- **Tap:** Allow or not now, on the sheet.
- **Frequency:** Once per phone.

## Current gaps and fixes

Status as of 27 November 2026, America/New_York. Implemented in [PR 70](https://github.com/jackroseman/pushup-counter/pull/70); not merged, not applied to production, and not in a production build.

Production 1.3.0 still has the old behavior, including the Lizzy wrong-challenge push.

What happened: Lizzy logged a 4-rep solo set. The old window trigger attached that set to every overlapping window challenge, without requiring her to be a participant. Jack received a Challenge update for his most-reps-today challenge with Aaron, with the body `lizzy is on 0 reps today`, because she had no standing there. The payload already contained that challenge id, so the tap opened the wrong challenge. The client cache was not the root cause.

- [x] A set only notifies for challenges the actor is actually in. Stops the wrong-challenge payload.
- [x] Per-set updates are limited to a lead change, a pass, a first best-set attempt, or a milestone. A first 4-rep or 12-rep uncontested window set stays silent.
- [x] Tap opens the challenge in the payload, even if another challenge is already on screen. `getId` on Battle, Invite, and Friend; notification URL wins over a bare launch; last response is cleared; URL can be a JSON string or fall back to challenge id.
- [x] Quiet hours delay only nudges and reminders. Friend requests and other social events no longer wait until morning.
- [x] Sent title, body, and data are stored on the outbox. The two-argument settle call still works.
- [x] Unsent rows with no token expire after 2 hours. Other unsent rows still expire after 1 day.
- [x] Test push opens Today; cancelled copy prefers the creator’s display name.
- [x] Window reminders still send if the person already has reps that window, and they are queued for those people (not only rendered if a row exists). Best-set reminders still skip people who already played. Halfway through a window is measured from the window start.
- [x] Accept and decline notify every other invited or accepted participant, not only the creator.
- [x] An expired challenge tells invited and accepted people, including invitees whose invite expired in the same finalize pass. Finalize now sets `responded_at` so unanswered invites can leave invited without violating the participant check.
- [x] A successful solo upload kicks the notify drain; the local reminder does not request permission.
- [ ] Applied to production and shipped in a build. The migrations are in the repo only. Do not merge, deploy, or start an EAS build until this is reviewed.

Where the earlier draft of this spec and the code disagreed, they were aligned as follows:

- Challenge results go to accepted or forfeited participants (people with a result), not to invitees who never joined.
- The permission sheet is shown once, after the first create, accept, or join, and uses the in-app copy above.

Still open for a decision: the milestone values and the 30-minute throttle; which kinds wait for quiet hours; the 2-hour no-token expiry; and whether later copy should say someone took the lead (it stays generic for now).

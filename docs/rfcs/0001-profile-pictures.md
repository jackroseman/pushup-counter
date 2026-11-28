---
rfc: 1
title: "Profile pictures"
status: Draft
author: "Grok Bot"
created: 2026-11-27
updated: 2026-11-27
issues: [79]
owner: "Sunny (Jack Roseman)"
---

# RFC 0001: Profile pictures

## Summary

Let people add a profile photo, so friends, challenges, and standings show a face instead of only a name. The existing initials avatar stays as the fallback when there is no photo, the photo fails to load, or the viewer is not allowed to see it.

The back end owns the photo URL and who may see it. The client only picks, crops, uploads, and displays what the views and RPCs return. This needs a new native build: the app does not currently include `expo-image-picker` or `expo-image-manipulator`, and adding them changes the native fingerprint. Do not start that build until Sunny has agreed to one.

## Problem and evidence

Profiles already have a name, a handle, and an unused `profiles.avatar_url` column. Every place a person appears today uses the `Avatar` component, which draws a single initial on a graphite circle (or a white circle for "you"). There is no way to add a photo, no Supabase Storage bucket, and no image-picker dependency.

[Issue #79](https://github.com/jackroseman/pushup-counter/issues/79) logs feedback from Aaron, a beta tester, who asked Sunny whether he could add a profile picture. As the issue puts it: profiles have no photo today, so friends, challenges, and standings show only names and handles. A face makes it quicker to see who you are up against.

## Goals and non-goals

**Goals**

- A person can add, change, and remove a profile photo from You and from Settings → Profile.
- Every current avatar in the app can show that photo, and falls back to the existing initials monogram otherwise.
- Photo URLs and visibility come from the database (and, where needed, an Edge Function). The client does not invent URLs or decide who can see a photo.
- Storage, size and format limits, cache-busting, and deleted-account cleanup are defined up front.
- Existing installs without a new native binary keep working: they keep showing initials, and cannot offer the picker.

**Non-goals**

- Requiring a photo, or adding a photo step to the first "Pick a username" screen.
- Custom or animated avatars, emoji/color-only avatars as the main solution, or GIFs.
- Showing a person's photo on a lock-screen or system push notification (that would need iOS Communication Notifications, another native change).
- A full moderation dashboard. The beta needs a report-and-act path; an admin UI can wait.
- Copying production photos into staging as part of the existing Postgres sync.
- Android-specific work beyond what Expo already provides; the shipping client is iPhone.

## User experience

New UI follows the style guide in [docs/rebrand/](../rebrand/). This RFC describes the experience in words and does not include mockups.

### Fallback (no photo)

Keep the current `Avatar` treatment:

- A circle with the first letter of the display name, or of the username if there is no display name, or `?` if both are missing. The leading `@` is ignored, matching `initialOf` today.
- Other people: graphite fill, label-colored initial.
- You: white fill, black initial.
- The same sizes already used on each screen (about 28–30 pt in stacks and rows, 36 pt in lists, 52–56 pt on You and podiums, 72–76 pt on friend and challenge headers).

A missing URL, a forbidden URL, or a failed image load uses this fallback. The name next to the avatar does not change.

### Where a photo appears

Once a photo is set, and the viewer is allowed to see it, the same `Avatar` circle shows the cropped photo instead of the initial, in every place the monogram appears today:

- You, on your own header.
- Friends lists (Compete and the list on You).
- A friend's page.
- League standings (podium, rows, and the "you" row) and the overlapping stack on the Today league card.
- Open challenge rows (Today and Compete), the new-challenge friend picker, and challenge detail and result headers.
- Friend invite sheets in the app, including "Add this person?", "already friends", your own invite link, and the signed-out / pick-username invite states.
- The small "invited you" chip on username setup, when someone arrived from a link.

Settings → Profile stays a text row (`@username`). The photo is edited on the Profile screen itself, and also by tapping your avatar on You. Signed-out prompts that use a `?` avatar stay as they are.

Push notifications keep using names only. There is no in-app notification inbox today.

Whether the public web invite page (`/i/<code>` on Vercel) shows the photo, or keeps the initials it already draws, is an open question below. That page already shows the inviter's display name and handle to anyone with the link, including Messages link previews.

### Adding a photo

The photo is optional. The first "Pick a username" screen stays as it is, so onboarding does not gain a permission prompt.

From You, tapping your avatar opens the photo actions. From Settings → Profile, a "Photo" control sits above the username and display name: the current circle (photo or initials), and the same actions.

The actions, in a standard iOS action sheet:

- **Choose from library** — always available once the person has a username.
- **Take photo** — only if we decide to allow the camera (open question). The current camera permission string says the TrueDepth camera is used to score push-up depth and that no images are stored or uploaded. That sentence would be wrong if we also take profile photos, so "Take photo" is not in the first version unless we update the string.
- **Remove photo** — only when a photo is already set.
- **Cancel**.

Choosing from the library uses the system picker, limited to still images, with the system square crop. After the crop, the app shows the circle as it will appear and a **Save** / **Cancel** pair. Save uploads and then shows the new photo. Cancel leaves the previous photo (or initials) in place.

If Photos permission is denied, the app says the photo library can be turned on in iOS Settings, and does not crash or show a blank picker. If the upload fails, the previous avatar stays and a short error appears: "Couldn't update your photo. Try again."

Copy is plain and generic: "Photo", "Choose from library", "Remove photo", "Save", "Cancel". A one-line caption under the control: "Friends and people you compete with can see your photo." Adjust this line if the invite-page question below changes who can see it.

### Changing and removing

Choosing a new photo replaces the old one as soon as Save succeeds. There is no history of earlier photos.

Remove asks "Remove photo?" with **Remove** and **Cancel**. Confirming clears the photo everywhere, immediately, and the initials return. There is no undo beyond adding a photo again.

### Privacy, as the user feels it

You always see your own photo. Accepted friends see it. People in a challenge with you (including a pending invite you can already see in the app) see it. Someone who only finds you by username search, and is not a friend and not in a challenge with you, still sees initials. Someone you have blocked, or who has blocked you, never sees it.

Removing the photo, or deleting the account, takes the photo down for everyone.

## Proposal

Ship this as one product change, in two technical layers that can land in order: the database, storage, and RPCs first (safe to deploy to staging without a new app binary), then the client once a new native build is approved.

1. Keep the unused `profiles.avatar_url` column, but treat it as an **internal object path** (not an arbitrary URL the client may write). A helper builds the display URL for a given viewer, or returns null. Person-shaped payloads from RPCs gain an `avatarUrl` field that is either a usable URL or omitted/null.
2. Add a Supabase Storage bucket `avatars`. The client never constructs bucket URLs by user id. After a successful upload, only a privileged function writes the path onto the profile and deletes the previous object.
3. Extend `Avatar` (and `AvatarStack`, `LeaderRow`, and `Podium`) to take an optional `imageUrl`. When it is present, draw the image in the circle; otherwise keep today's monogram, including the inverted "you" treatment. On error, fall back to the monogram.
4. Wire that URL through from the RPC payloads listed below, including the web invite page if we decide it should show photos.
5. Add pick / crop / save / remove on You and on the Profile screen, using `expo-image-picker` and `expo-image-manipulator`.

## Data model and RPC/view changes

The back end has the opinions; the front end implements the back end.

### What already exists

`profiles` already has `avatar_url text`, created in `20261031191027_battles_initial.sql`. Nothing in the app or in any RPC reads or writes it. The client loads and saves only `id, username, display_name, time_zone`.

Row-level security today:

- `profiles_read`: any signed-in user can select **every** profile row (`using (true)`).
- `profiles_insert` / `profiles_update`: only your own row.

If we stored a fetchable URL in `avatar_url` and left `profiles_read` as it is, any signed-in user could read every photo URL by querying the table, even when the RPCs hid it. That has to change.

`delete_my_account()` deletes the auth user. Profile rows cascade, but Storage objects do not.

There is no Storage bucket in the repo today.

### Column and write path

- Keep `profiles.avatar_url`, but store a path of the form `avatars/{user_id}/{object_id}.jpg`, where `object_id` is a new UUID on every change. A check constraint (or a trigger that rejects other values) enforces this pattern or null.
- Revoke direct client updates of `avatar_url`. A trigger rejects changes to that column unless they come from the set/clear function (for example, by checking `pg_trigger_depth()` or a `private` setting reserved for those functions). `saveProfile` in the client continues to write only username, display name, and time zone.
- `private.avatar_url(p_owner uuid, p_viewer uuid)` returns the display URL if `p_viewer` may see `p_owner`'s photo, otherwise null. Allowed viewers: the owner, an accepted friend, or a participant in a shared challenge the viewer can already see (the same membership already used by challenge RPCs). Blocked pairs are denied. Anon viewers are denied unless we explicitly allow them for invite previews (open question).
- Person objects returned to the client include `avatarUrl` from that helper. The client only displays it.

### Storage bucket

Create bucket `avatars`:

- File listing is off.
- Objects are not publicly listable. Preferred: public object reads by exact path, so the URL the RPC returns can be used directly by `Image` and by a web page, and can be cached. The path contains a UUID, so knowing a user id is not enough to guess it. The database still decides which URLs are handed out.
- Storage RLS: a signed-in user may upload and delete only under their own `{user_id}/` prefix, and only through the upload function's path. They may not overwrite another user's prefix.
- Accepted formats after processing: JPEG, 512×512, typical size well under 200 KB. Inputs may be JPEG, PNG, or HEIC (converted on the device). Reject anything else, including animated GIFs. Cap the raw pick at 10 MB before processing. The server re-checks type (magic bytes, not just the extension) and size and re-encodes; it does not trust the client to have resized correctly.
- Server-side resize and re-encode live in an Edge Function (for example `set-avatar`) that receives the cropped image, validates it, writes the new object, updates `profiles.avatar_url`, and deletes the previous object. A matching RPC `clear_avatar()` clears the column and deletes the object.
- `prepare_avatar_upload` is not required if the Edge Function takes the file directly. If we instead use a direct Storage upload, a privileged RPC should issue the exact path (and only then accept `set_avatar(p_path)` after the object exists). The Edge Function is preferred so limits and re-encoding are in one place.

### RPCs and views that must return `avatarUrl`

Add `avatarUrl` (nullable) beside `displayName` wherever a person is returned to the app or the invite page. The latest definitions to extend:

- `my_friends` — currently `security invoker`. Because `profiles` reads will no longer be world-readable, this function (or a definer helper it calls) must use the helper above so friends' URLs are visible to the caller.
- `search_users` — return `avatarUrl` only for accepted friends (and perhaps pending requests the caller can already see). Strangers stay as initials.
- `my_league`, `my_open_challenges`, `my_challenges` / challenge detail, `friend_challenge_record`, `friend_battle_record`, and the person / score / standing objects inside them.
- `friend_invite_preview` (granted to `anon` for the Vercel landing page) and the in-app invite payloads. Include `avatarUrl` only if we decide the public page may show the photo; otherwise the app can still show it when the viewer is signed in and allowed, and the anon preview omits it.
- Notification outbox payloads may include `avatarUrl` for a future in-app surface, but system pushes will not display it in this work.

`profiles_read` becomes "own row only." Functions that today join `profiles` as `security invoker` and need another person's photo must go through the definer helper. Functions that only need the caller's profile can stay as they are.

Do not return `avatarUrl` from a raw `select * from profiles` to the client for anyone else.

### Cache-busting

Each new photo gets a new object id in the path, so the URL changes and clients and CDNs do not keep the old image. After a change or removal, RPCs return the new URL or null. The previous object is deleted in the same operation.

### Account deletion and staging

Extend `delete_my_account()` (or a trigger on `profiles` delete) to delete every object under `avatars/{user_id}/`. A leftover file after a deleted account is a bug.

The prod→staging Postgres sync copies `profiles` and does not copy Storage. Because the stored value is a path, not a production absolute URL, staging will not point at production files. Missing objects must fall back to initials. Do not add a production bucket copy to the sync in this work, and never copy `push_tokens`.

### Moderation, for a small friends-only beta

Photos are user-generated content (App Store Guideline 1.2 already applies to usernames and challenges). Block already exists (`block_user`). There is no general "report this person" flow; `set_flags` is only for battle sets.

This work should add a narrow report path: **Report photo** on a friend's page (and anywhere we already offer block, if that is a single menu). It writes a row (a `profile_flags` table, or a generalization of `set_flags`) and notifies Sunny. Sunny can clear the photo with the service role. A dedicated admin UI is out of scope.

If the public invite page shows photos, report-and-act is no longer optional.

The privacy policy and App Privacy nutrition label will need a pass for photos, with Sunny's explicit OK before any legal text changes.

## Testing

Follow the Testing philosophy in [docs/developer-guide.md](../developer-guide.md#testing-philosophy): test the decisions, not the plumbing. New public functions and views need a behavioral test or they fail the coverage check.

Database and RPC tests should assert:

- Only the owner can set or clear their photo; a peer's `clear_avatar` / set call is denied.
- The client (or a table update as the user) cannot set `avatar_url` to an arbitrary URL.
- `avatarUrl` is returned to the owner and to an accepted friend.
- `search_users` omits `avatarUrl` for a stranger, and includes it for a friend.
- A shared-challenge participant can see it; a signed-in user with no relation cannot, including via a direct `select` on `profiles`.
- A blocked user does not see it, including through `friend_invite_preview`.
- After `clear_avatar`, RPCs return null and the app-facing payload has no usable URL.
- After `delete_my_account`, the profile is gone and the cleanup path has been asked to remove the prefix (see the Storage note below).
- `friend_invite_preview` matches the decision on public invite pages (URL present or absent for anon).

PGlite covers SQL, RLS, and RPCs. It does not run Supabase Storage. Storage policies, MIME checks, and re-encoding should be tested against staging (a small script or a manual checklist on the Edge Function), and that gap should be named in the implementation PR rather than faked in PGlite.

Client tests and `tools/preview` fixtures should cover: monogram fallback (no URL, broken URL), a photo on You / friends / a challenge row / a league row, and the Profile photo actions in the preview tool. Add a short preview flow for the photo sheet so we are not designing it only from memory.

## Rollout and migration

- Migrations and the Edge Function land on staging when the implementation merges to `dev`, and on production when the release merges to `main`. Existing rows have `avatar_url` null, so everyone keeps initials until they add a photo. Old app versions ignore the new `avatarUrl` field and keep drawing monograms. That is backwards compatible.
- **A new native build is required.** `expo-image-picker` and `expo-image-manipulator` are not in the project. They are native modules, and they need a Photo Library usage string (`NSPhotoLibraryUsageDescription`: "Rep Royale uses your photo library so you can choose a profile picture."). That changes the native fingerprint. The dev client uses `runtimeVersion` policy `fingerprint`, so an existing Pushup Dev install will not receive this as an OTA. Production uses `appVersion` (currently 1.3.0), so a store or TestFlight binary also needs a version bump. Do not start any EAS build until Sunny has agreed to one. Conserve the monthly build budget.
- The camera usage string stays accurate unless we deliberately add "Take photo" and rewrite it.
- Backend-only work can go to staging first and be tested with a script or a temporary client; the picker UI should not ship in an OTA to binaries that lack the native modules.
- After a photo-capable binary is on TestFlight / dev, try it against staging before production.

## Alternatives

- **Do nothing.** Initials stay. Aaron's request is unanswered. This is the baseline if we reject the RFC.
- **Sign in with Apple's photo.** Not available. Sign in with Apple does not give a third-party app the person's Apple ID photo. We already request only the full name, and only on the first sign-in, to prefill the display name.
- **Gravatar or another public email avatar.** Sign in with Apple may not give us a stable email, Gravatar is public rather than friends-scoped, and it is not a photo the person chose in the app.
- **Emoji, color, or generated avatars only.** Cheaper and needs no Storage or native picker, but it is not a profile picture. The initials monogram already covers a no-photo mark. These could be a later extra, not a substitute.
- **Let the client write any URL into `avatar_url`.** Rejected. It would allow tracking pixels, oversized images, and content we do not control, and it puts the opinion on the client.
- **Private bucket and short-lived signed URLs for every list.** Stricter, but every friends list and league row would break when a signature expired, unless the client refreshed constantly. A public-by-exact-path object with an unguessable name, plus tight RLS and RPC visibility, is the better fit for this beta.

## Open questions

1. **Library only, or also Take photo?** The proposal is library only, so the existing TrueDepth camera permission string stays true. Adding "Take photo" means rewriting `NSCameraUsageDescription`, which today says no images are stored or uploaded.
2. **Does the public invite landing page show the photo?** Anyone with the link already sees the person's name. Showing the photo matches that, but it also puts the image on an unauthenticated page and in Messages link previews. The alternative is initials on the web page, and the photo only inside the signed-in app.
3. **Report photo in v1?** For a small friends-only beta, block plus Sunny clearing a photo might be enough if photos stay inside the app. If question 2 is "yes," or if we want Guideline 1.2 covered cleanly, v1 should include Report photo and a way for Sunny to act.
4. **When implementation starts, may we use an EAS build?** The feature cannot ship to existing dev or production binaries by OTA. This RFC does not start a build; it needs an explicit yes later.

## Decision log

| Date | Decision | By |
| --- | --- | --- |
| 2026-11-27 | Write the RFC from issue #79 (Aaron's request). Status: Draft. | Sunny asked for the RFC |

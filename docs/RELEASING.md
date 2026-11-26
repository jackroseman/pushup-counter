# Releasing Rep Royale

How a merged change reaches a phone, what uses EAS builds (15 a month on the free plan),
and the exact steps for a release. CONTRIBUTING.md covers branches, PRs and CI.

## What happens after a merge

| merge into | GitHub Action          | ships to                                          |
|------------|------------------------|---------------------------------------------------|
| `dev`      | `eas-ship.yml`         | Pushup Dev (profile/channel/EAS env `development`) |
| `main`     | `eas-ship.yml`         | Rep Royale on TestFlight (profile/channel/EAS env `production`) |
| `dev`/`main`, only if `supabase/` changed | `supabase-deploy.yml` | staging / prod Supabase |

On `dev`, `eas-ship.yml` is started by the `ship` job in `ci.yml` after a merge, and
only after the `checks` job has passed for that exact merge commit (it is no longer
triggered by push alone, so a red CI run cannot reach a phone). Until the next
`dev` → `main` release, `main` still uses the previous ship-on-push workflow. After
that release, merges to `main` wait for `checks` the same way.

When it does run, it calls `scripts/eas-ship.sh` on a GitHub runner (no EAS queue):

1. Fingerprint the project with `eas fingerprint:generate` (same hash EAS builds record).
2. **A build of that profile has this fingerprint** (finished, queued or building, any
   age): **JS-only change**. Publish an OTA update (`eas update --channel <profile>`), with
   the merge commit subject as the message. Takes a few minutes, no build.
3. **No build has this fingerprint: native change.**
   * `development`: the dev runtime version *is* the fingerprint, so it starts
     `.eas/workflows/build-dev.yml` (1 build). Install the new Pushup Dev build when it is done.
   * `production`: the runtime version is `expo.version`. If that version already has a store
     build, the job **fails** and publishes nothing: an OTA would reach that build without
     its native code. Bump the version (below) and merge again. If the version is new, it
     starts `.eas/workflows/build-production.yml` (1 build + upload to TestFlight).
   * A build workflow that is already running is not started twice.
   * Then, in the same run, it publishes an OTA update of this commit for the new runtime
     (no rollout percentage). No installed app has that runtime yet, so nobody receives it
     early; the new build shows it in its Updates tab from the start, which keeps
     `eas update:republish` and rollbacks working for that build. The build embeds the same
     JS and is newer than this update, so installs do not download it again. If this publish
     fails the job is red; re-run **EAS ship**: it finds the queued build and publishes.

Markdown, `docs/`, `supabase/`, `__tests__/`, `.github/` and `tools/` changes do not
start `eas-ship.yml` at all. A newer merge that will ship cancels a running ship (it ships
the newer passing commit instead), so duplicate runs never need cancelling by hand. A
docs-only merge, or a merge whose `checks` job failed, does not start a ship and does
not cancel one that is already running. A ship also skips if its commit is no longer
the branch tip, so a superseded run cannot publish stale code.

The EAS workflows in `.eas/workflows/` have **no push trigger**. They only run when
`eas-ship.sh` starts them or when you run them by hand.

## Runtime versions (which builds an OTA reaches)

| variant      | `runtimeVersion` | why |
|--------------|------------------|-----|
| production   | `appVersion` (`expo.version` in `app.json`) | Readable versions for the store. A native change needs a version bump; `eas-ship.sh` enforces it with the fingerprint. |
| development  | `fingerprint` (set in `app.config.ts`) | Dev builds are rebuilt for native changes without a version bump; an old dev build never gets an update it cannot run. |

## Release recipe (`dev` -> `main`)

1. On `dev`, check the change on Pushup Dev.
2. If anything native changed since the last release (`modules/`, native packages, Expo SDK,
   plugins or native config in `app.json`/`app.config.ts`), bump `version` in `app.json`
   **and** `package.json` (e.g. 1.2.1 -> 1.2.2) in a PR into `dev`.
   Not sure? `scripts/eas-ship.sh production --dry-run` on the `dev` head tells you what
   merging would do (needs `eas login` or `EXPO_TOKEN`).
3. `scripts/release.sh`: opens (or reuses) the PR `dev` -> `main`, lists the commits, and
   brings the PR up to date with `main` if it is BEHIND. It never merges.
4. Wait for `checks`, then merge it (**merge commit**, not squash).
5. Watch **Actions -> CI** (the merge commit's `checks`, then `ship` if the change is
   shippable) and **Actions -> EAS ship** on GitHub. If `checks` is red, nothing is
   published and no build is started.
   * OTA: TestFlight installs get it on the next launch and run it on the launch after.
   * Build: follow the link to the EAS workflow. Testers get it in TestFlight once Apple has
     processed it (about 10-30 min; the first build of a version for external testers needs
     Beta App Review). Groups and "What to Test" are set in App Store Connect -> TestFlight.
   * Upload failed: `eas submit -p ios --id <build id>` retries without a new build.
6. Optional: `git tag vX.Y.Z origin/main && git push origin vX.Y.Z`.

## By hand

```bash
scripts/eas-ship.sh development --dry-run           # what a merge to dev would do
node --test scripts/tests/eas-ship.test.mjs         # eas-ship.sh decisions against a fake eas (CI runs it)
scripts/eas-ship.sh production --rollout 10         # publish to 10% of production (from main)
eas workflow:run .eas/workflows/build-dev.yml --ref dev           # new dev client (1 build)
eas workflow:run .eas/workflows/build-production.yml --ref main   # new store build + upload (1 build)
```

GitHub: **Actions -> EAS ship -> Run workflow** on `dev` or `main` re-ships that branch
(inputs: rollout percentage, dry run). Use it to retry a failed ship.

Internal (dev) builds expire after 14 days. An expired build still counts as "has this
fingerprint", so OTAs keep publishing; when you need to install it again, run
`build-dev.yml` by hand.

## Build budget

Builds happen only for a native change or a manual run: at most one dev build and one
store build per native change. Check usage at expo.dev -> account -> Usage.

## Rolling back

See CONTRIBUTING.md section 9 (`eas update:republish`, revert PRs).

## Secrets this needs

* `EXPO_TOKEN` (GitHub repo secret): Expo access token for `jackroseman33s-team`, used by
  `eas-ship.yml`. Without it the job warns and ships nothing.
* EAS credentials (App Store Connect API key) for the upload, stored on EAS. Never commit a `.p8`.

#!/usr/bin/env bash
# Open (or refresh) the release PR dev -> main. Never merges: review it, wait for `checks`,
# then merge it yourself. See docs/RELEASING.md.
#
#   scripts/release.sh
#
# Each release merge adds a merge commit to main that dev does not have, so the next
# dev -> main PR starts BEHIND main. While main's branch protection requires branches to be
# up to date (strict), that PR cannot merge until it is updated; this script does that update
# (`gh pr update-branch`, which merges main into dev through the PR) so nobody has to do it
# by hand. Needs gh, logged in with write access.
set -euo pipefail

REPO="${REPO:-jackroseman/pushup-counter}"
VERSION="$(git show origin/dev:app.json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).expo.version))' || true)"
git fetch -q origin dev main

AHEAD="$(git rev-list --count origin/main..origin/dev)"
if [ "$AHEAD" = 0 ]; then echo "dev has nothing that main lacks; no release PR needed."; exit 0; fi

PR="$(gh pr list -R "$REPO" --base main --head dev --state open --json number --jq '.[0].number // empty')"
if [ -z "$PR" ]; then
  TITLE="Release ${VERSION:-dev}: dev -> main"
  BODY="$(printf 'Release dev into main (%s commits).\n\nMerging ships production: an OTA update for JS-only changes, or one store build + TestFlight upload for a native change (the patch version is bumped automatically on this PR if needed). See docs/RELEASING.md.\n\nCommits:\n%s\n' "$AHEAD" "$(git log --oneline --no-merges origin/main..origin/dev | head -50)")"
  PR="$(gh pr create -R "$REPO" --base main --head dev --title "$TITLE" --body "$BODY" | sed -E 's#.*/pull/([0-9]+).*#\1#')"
  echo "opened release PR #$PR"
fi

STATE="$(gh pr view "$PR" -R "$REPO" --json mergeStateStatus --jq .mergeStateStatus)"
if [ "$STATE" = BEHIND ]; then
  echo "PR #$PR is behind main; updating dev from main"
  gh pr update-branch "$PR" -R "$REPO"
fi
gh pr view "$PR" -R "$REPO" --json url,mergeStateStatus --jq '"\(.url) (\(.mergeStateStatus))"'

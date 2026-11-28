#!/usr/bin/env bash
# On a dev → main release PR: if shipping this head to production would be a
# native change under a version that already has a store build, open (or reuse)
# a PR into dev that bumps the patch, wait for the required `checks` job,
# squash-merge it, and dispatch CI on the new dev tip so the release PR's
# required check runs.
#
# Commits pushed with GITHUB_TOKEN do not trigger workflows (except
# workflow_dispatch and repository_dispatch). This script therefore starts
# ci.yml with `gh workflow run` after each push or merge. It never starts an
# EAS build and never publishes an OTA (workflow_dispatch of CI does not ship).
#
# Development builds are not considered: decision logic is production-only.
#
#   .github/scripts/release-version-bump.sh --apply <release-pr>
#
# Needs git, gh, node, eas, and EXPO_TOKEN. The workflow checks out the release
# PR head and fetches origin first. Never merges the release PR itself.
set -euo pipefail

REPO="${REPO:-jackroseman/pushup-counter}"
if [ "${1:-}" != "--apply" ] || [ -z "${2:-}" ]; then
  echo "usage: .github/scripts/release-version-bump.sh --apply <release-pr>" >&2
  exit 2
fi
RELEASE_PR="$2"

note() { if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::notice::$*"; else echo "$*"; fi; }
fail() { if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::error::$*"; else echo "error: $*" >&2; fi; exit 1; }

DECISION="$(node scripts/release-version-bump.mjs decide --json)"
echo "$DECISION"
ACTION="$(printf '%s' "$DECISION" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).action))')"
REASON="$(printf '%s' "$DECISION" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).reason))')"
VERSION="$(printf '%s' "$DECISION" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).version))')"

if [ "$ACTION" != "bump" ]; then
  note "No production version bump needed (${REASON}, version ${VERSION})."
  exit 0
fi

NEXT="$(printf '%s' "$DECISION" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).nextVersion))')"
BRANCH="chore/auto-bump-${NEXT}"
note "Native change under ${VERSION}, which already has a store build. Bumping to ${NEXT}."

wait_for_checks() {
  local sha="$1"
  local i conclusion
  for i in $(seq 1 60); do
    conclusion="$(gh api "repos/${REPO}/commits/${sha}/check-runs?per_page=100" --jq '
      [.check_runs[] | select(.name == "checks")] |
      if any(.conclusion == "success") then "success"
      elif any(
        .status == "in_progress" or .status == "queued" or
        .status == "waiting" or .status == "pending" or
        ((.conclusion == null or .conclusion == "") and .status != "completed")
      ) then "pending"
      elif length == 0 then "missing"
      else "failed"
      end
    ')"
    case "$conclusion" in
      success) return 0 ;;
      failed) echo "required checks job failed on ${sha:0:7}" >&2; return 1 ;;
      missing|pending) sleep 15 ;;
      *) sleep 15 ;;
    esac
  done
  echo "timed out waiting for the required checks job on ${sha:0:7}" >&2
  return 1
}

dispatch_ci() {
  local ref="$1"
  gh workflow run ci.yml -R "$REPO" --ref "$ref"
  note "Dispatched CI on ${ref} (GITHUB_TOKEN pushes do not start workflows on their own)."
}

existing_pr() {
  gh pr list -R "$REPO" --base dev --head "$BRANCH" --state open --json number --jq '.[0].number // empty'
}

BUMP_PR="$(existing_pr)"
if [ -z "$BUMP_PR" ]; then
  if git ls-remote --exit-code origin "refs/heads/${BRANCH}" >/dev/null 2>&1; then
    note "Branch ${BRANCH} already exists; opening a PR into dev."
  else
    git checkout -B "$BRANCH"
    node scripts/release-version-bump.mjs apply "$NEXT"
    git add app.json package.json package-lock.json
    git config user.name "github-actions[bot]"
    git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
    git commit -m "chore: bump version to ${NEXT}"
    git push -u origin "$BRANCH"
  fi
  BODY="$(printf '%s\n' \
    "Automatic patch bump for the [dev → main release PR #${RELEASE_PR}](https://github.com/${REPO}/pull/${RELEASE_PR})." \
    "" \
    "This head is a native change relative to the last production store build, and version ${VERSION} already has a store build. \`eas-ship.sh\` would refuse to start a production build (an OTA of this native change would reach those TestFlight installs and could crash them)." \
    "" \
    "Bumps \`expo.version\` in \`app.json\` and the root \`version\` in \`package.json\` and \`package-lock.json\` from ${VERSION} to ${NEXT}." \
    "" \
    "Opened and merged by \`.github/workflows/release-pr-version.yml\`. Does not start an EAS build. Development shipping is unchanged." \
  )"
  BUMP_PR="$(gh pr create -R "$REPO" --base dev --head "$BRANCH" \
    --title "chore: bump version to ${NEXT}" \
    --body "$BODY" | sed -E 's#.*/pull/([0-9]+).*#\1#')"
  note "Opened bump PR #${BUMP_PR}."
else
  note "Reusing open bump PR #${BUMP_PR} (idempotent)."
fi

SHA="$(gh pr view "$BUMP_PR" -R "$REPO" --json headRefOid --jq .headRefOid)"
dispatch_ci "$BRANCH"
wait_for_checks "$SHA" || fail "The bump PR #${BUMP_PR} did not get a green required checks job. It was left open; re-run this workflow or edit the release PR to retry."

gh pr merge "$BUMP_PR" -R "$REPO" --squash --subject "chore: bump version to ${NEXT}" \
  --body "Automatic patch bump for release PR #${RELEASE_PR}."
note "Merged bump PR #${BUMP_PR} into dev."

# The squash merge was performed with GITHUB_TOKEN, so the push to dev does not
# start CI. Dispatch it onto the new tip so the release PR's required check runs.
git fetch origin dev
DEV_SHA="$(git rev-parse origin/dev)"
dispatch_ci dev
if wait_for_checks "$DEV_SHA"; then
  note "Required checks passed on dev ${DEV_SHA:0:7}. Release PR #${RELEASE_PR} can include ${NEXT}."
else
  note "Dispatched CI on dev ${DEV_SHA:0:7}, but it had not passed yet. Watch the checks on release PR #${RELEASE_PR}."
fi

gh pr comment "$RELEASE_PR" -R "$REPO" --body "$(printf '%s\n' \
  "Native change detected versus the production store builds of ${VERSION}. Bumped the app to **${NEXT}** in #${BUMP_PR} (now merged into \`dev\`)." \
  "" \
  "This release PR will include ${NEXT} automatically. Wait for a green \`checks\` job on the new tip, then merge." \
)"

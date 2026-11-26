#!/usr/bin/env bash
# Ship one commit to an EAS channel: publish an OTA update if a compatible iOS build
# exists, otherwise start the build workflow (native change). Used by
# .github/workflows/eas-ship.yml after a merge to dev or main; runs the same way locally.
#
#   scripts/eas-ship.sh <development|production> [--dry-run] [--rollout <1-100>] [--message <text>]
#
# Needs EXPO_TOKEN (or `eas login`). The profile name is also the EAS environment and the
# update channel. See docs/RELEASING.md for the whole recipe.
#
# Decision (iOS only; Android is not shipped):
#   1. Fingerprint the project the way EAS builds do (`eas fingerprint:generate`).
#   2. A build of this profile with that fingerprint exists (any age: an expired internal
#      build still proves the installed app matches, so it is never rebuilt for that),
#      or is queued/building -> publish an OTA update. No EAS queue, no build.
#   3. No build has that fingerprint (native change):
#        development: runtimeVersion is the fingerprint, so start build-dev.yml.
#        production:  runtimeVersion is the app version. If builds already exist for this
#                     version, stop with an error: bump expo.version in app.json (a native
#                     change needs a new version). Otherwise start build-production.yml
#                     (build + submit to TestFlight).
#      A build workflow already running for this profile is not started twice.
set -euo pipefail

PROFILE="${1:-}"; shift || true
DRY_RUN=0; ROLLOUT=""; MESSAGE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --rollout) ROLLOUT="$2"; shift ;;
    --message) MESSAGE="$2"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

case "$PROFILE" in
  development) BUILD_WORKFLOW=build-dev.yml ;;
  production) BUILD_WORKFLOW=build-production.yml ;;
  *) echo "usage: $0 <development|production> [--dry-run] [--rollout N] [--message TEXT]" >&2; exit 2 ;;
esac

EAS=(eas)  # eas-cli on PATH; CI installs the version pinned in eas-ship.yml
note() { if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::notice::$*"; else echo "$*"; fi; }
fail() { if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::error::$*"; else echo "error: $*" >&2; fi; exit 1; }
json() { sed -n '/^[[{]/,$p'; }  # eas prints notices before the JSON on stdout

SHA="$(git rev-parse HEAD)"
# Shown in messages only. The build runs from GitHub at $SHA (it must be pushed): CI checks out a
# detached commit, so there is no local branch for `eas workflow:run --ref <branch>` to resolve.
REF="${GITHUB_REF_NAME:-$(git rev-parse --abbrev-ref HEAD)}"
[ -n "$MESSAGE" ] || MESSAGE="$(git log -1 --format=%s)"

FINGERPRINT="$("${EAS[@]}" fingerprint:generate -p ios --environment "$PROFILE" --json --non-interactive 2>/dev/null \
  | json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).hash))')"
[ -n "$FINGERPRINT" ] || fail "could not compute the fingerprint"
echo "profile=$PROFILE fingerprint=$FINGERPRINT commit=${SHA:0:7}"

# Builds of this profile with this fingerprint that are usable now or soon.
MATCH="$("${EAS[@]}" build:list -p ios --build-profile "$PROFILE" --fingerprint-hash "$FINGERPRINT" --limit 20 --json --non-interactive 2>/dev/null \
  | json | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const ok=new Set(["FINISHED","IN_QUEUE","IN_PROGRESS","NEW"]);
      const b=JSON.parse(s||"[]").find(x=>ok.has(x.status));
      console.log(b?`${b.id} ${b.status} ${b.runtime?.version ?? ""}`:"");
    })')"

if [ -n "$MATCH" ]; then
  read -r BUILD_ID BUILD_STATUS RUNTIME <<<"$MATCH"
  note "Compatible $PROFILE build ${BUILD_ID:0:8} ($BUILD_STATUS, runtime $RUNTIME): publishing an OTA update."
  ARGS=(update --channel "$PROFILE" --environment "$PROFILE" --platform ios --message "$MESSAGE" --non-interactive)
  [ -n "$ROLLOUT" ] && ARGS+=(--rollout-percentage "$ROLLOUT")
  if [ "$DRY_RUN" = 1 ]; then echo "dry run: eas ${ARGS[*]}"; exit 0; fi
  exec "${EAS[@]}" "${ARGS[@]}"
fi

if [ "$PROFILE" = production ]; then
  VERSION="$(node -p 'require("./app.json").expo.version')"
  EXISTING="$("${EAS[@]}" build:list -p ios --build-profile production --runtime-version "$VERSION" --limit 5 --json --non-interactive 2>/dev/null \
    | json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s||"[]").filter(x=>x.status!=="CANCELED"&&x.status!=="ERRORED").length))')"
  if [ "$EXISTING" != 0 ]; then
    fail "Native change under version $VERSION, which already has a store build. An OTA would reach that build and could crash it. Bump expo.version in app.json (and package.json) and merge again; that starts one new store build."
  fi
fi

# "Workflow not found" until the workflow has run once: treat as nothing running.
RUNS="$("${EAS[@]}" workflow:runs --workflow "$BUILD_WORKFLOW" --limit 10 --json 2>/tmp/eas-runs.err | json)" || {
  grep -q "Workflow not found" /tmp/eas-runs.err || { cat /tmp/eas-runs.err >&2; fail "could not list $BUILD_WORKFLOW runs"; }
  RUNS="[]"
}
RUNNING="$(printf '%s' "$RUNS" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s||"[]").filter(r=>["NEW","IN_PROGRESS","WAITING","ACTION_REQUIRED"].includes(r.status)).map(r=>r.id).join(" ")))')"
if [ -n "$RUNNING" ]; then
  note "Native change, but $BUILD_WORKFLOW is already running ($RUNNING); not starting another build."
  exit 0
fi

note "Native change (no $PROFILE build has fingerprint ${FINGERPRINT:0:10}): starting $BUILD_WORKFLOW on $REF (${SHA:0:7}). Uses 1 of the monthly builds."
if [ "$DRY_RUN" = 1 ]; then echo "dry run: eas workflow:run .eas/workflows/$BUILD_WORKFLOW --ref $SHA"; exit 0; fi
"${EAS[@]}" workflow:run ".eas/workflows/$BUILD_WORKFLOW" --ref "$SHA" --non-interactive

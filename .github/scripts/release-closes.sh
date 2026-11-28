#!/usr/bin/env bash
# Collect "Closes #N" lines for a dev -> main release PR, and optionally write
# them onto that PR's body.
#
# GitHub only auto-closes issues from PRs merged into the default branch (main).
# Feature PRs target dev, so their Closes #N lines do not close the issue, and a
# merge commit does not reliably chain those keywords through. The release PR
# has to list the same issues itself. Open issues mean the work is not in
# production yet.
#
#   .github/scripts/release-closes.sh              # print the section to stdout
#   .github/scripts/release-closes.sh --apply 12   # insert or refresh the section on PR #12
#
# Needs git, gh, and python3. Fetch origin/main and origin/dev first (release.sh
# and the workflow already do). Never merges the PR.
set -euo pipefail

REPO="${REPO:-jackroseman/pushup-counter}"
BASE="${BASE:-origin/main}"
HEAD="${HEAD:-origin/dev}"
APPLY_PR=""

if [ "${1:-}" = "--apply" ]; then
  APPLY_PR="${2:-}"
  if [ -z "$APPLY_PR" ]; then
    echo "usage: .github/scripts/release-closes.sh --apply <pr-number>" >&2
    exit 2
  fi
elif [ -n "${1:-}" ]; then
  echo "usage: .github/scripts/release-closes.sh [--apply <pr-number>]" >&2
  exit 2
fi

collect_pr_numbers() {
  git log --format=%s "$BASE".."$HEAD" \
    | grep -Eo 'Merge pull request #[0-9]+|\(#[0-9]+\)' \
    | grep -Eo '[0-9]+' \
    | sort -n -u
}

extract_closes() {
  python3 - "$@" <<'PY'
import re, sys

kw = re.compile(r"(?i)\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b")
ref = re.compile(r"(?:https://github.com/[\w.-]+/[\w.-]+/issues/|#)\s*(\d+)")
nums = set()
text = sys.stdin.read()
for m in kw.finditer(text):
    chunk = text[m.end():].split("\n", 1)[0]
    if not re.match(r"^\s*(?:https://github.com/[\w.-]+/[\w.-]+/issues/|#)", chunk):
        continue
    nums.update(int(n) for n in ref.findall(chunk))
for n in sorted(nums):
    print(n)
PY
}

START="<!-- release-closes:start -->"
END="<!-- release-closes:end -->"

section_from_issues() {
  python3 -c '
import sys
nums = [n.strip() for n in sys.stdin.read().split() if n.strip()]
if not nums:
    raise SystemExit
print("## Issues this release closes")
print()
print("<!-- release-closes:start -->")
for n in nums:
    print(f"Closes #{n}")
print("<!-- release-closes:end -->")
'
}

apply_section() {
  # stdin: current body; argv: section text (or empty to strip)
  python3 -c '
import re, sys
body = sys.stdin.read()
section = sys.argv[1]
start = "<!-- release-closes:start -->"
end = "<!-- release-closes:end -->"
pat = re.compile(
    r"(?:\n)*## Issues this release closes\n+" + re.escape(start) + r".*?" + re.escape(end) + r"\n*",
    re.S,
)
# Also remove a bare marker block, in case the heading was edited away.
pat_bare = re.compile(r"(?:\n)*" + re.escape(start) + r".*?" + re.escape(end) + r"\n*", re.S)
stripped = pat.sub("\n", body)
if start in stripped:
    stripped = pat_bare.sub("\n", stripped)
stripped = stripped.rstrip() + "\n"
if section.strip():
    out = stripped + "\n" + section.strip() + "\n"
else:
    out = stripped
sys.stdout.write(out)
' "$1"
}

PR_NUMBERS="$(collect_pr_numbers || true)"
ISSUE_NUMBERS=""
if [ -n "$PR_NUMBERS" ]; then
  BODIES=""
  for n in $PR_NUMBERS; do
    BODY="$(gh pr view "$n" -R "$REPO" --json body --jq '.body // empty')"
    BODIES="${BODIES}${BODY}"$'\n'
  done
  ISSUE_NUMBERS="$(printf '%s' "$BODIES" | extract_closes || true)"
fi

SECTION=""
if [ -n "$ISSUE_NUMBERS" ]; then
  SECTION="$(printf '%s\n' $ISSUE_NUMBERS | section_from_issues)"
fi

if [ -z "$APPLY_PR" ]; then
  if [ -n "$SECTION" ]; then
    printf '%s\n' "$SECTION"
  fi
  exit 0
fi

CURRENT="$(gh pr view "$APPLY_PR" -R "$REPO" --json body --jq '.body // empty')"
UPDATED="$(printf '%s' "$CURRENT" | apply_section "$SECTION")"
if [ "$UPDATED" = "$CURRENT" ] || [ "$UPDATED" = "$CURRENT"$'\n' ]; then
  echo "PR #$APPLY_PR already has the right Closes lines"
  exit 0
fi
# gh pr edit --body-file avoids shell-quoting the markdown
TMP="$(mktemp)"
printf '%s' "$UPDATED" >"$TMP"
gh pr edit "$APPLY_PR" -R "$REPO" --body-file "$TMP"
rm -f "$TMP"
echo "updated Closes lines on PR #$APPLY_PR"

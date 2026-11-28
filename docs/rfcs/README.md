# RFCs

Rep Royale uses a short design doc, reviewed as a pull request, before work that
changes product behavior. The doc is the place to agree on the problem, the
experience, and what the database will decide. Implementation PRs come after the
RFC is accepted.

User feedback is logged first, as a GitHub issue. An RFC is written only when an
issue is worth a design pass.

## Lifecycle

```
Feedback, feature request, or bug issue
        ↓
  labeled rfc-needed
        ↓
  RFC PR adds docs/rfcs/NNNN-slug.md and links the issue(s)
        ↓
  Draft → In review → Accepted or Rejected
        ↓
  Implementation PRs link the RFC (Closes #N, RFC becomes Implemented)
        ↓
  dev → main release PR also lists Closes #N
        ↓
  Issues close when that PR merges to main (prod)
```

1. **Issue.** Log what you heard or found. Use the Feedback, Feature request, or
   Bug report form, or open the same kind of issue with `gh` (commands below).
   Keep the user's words when you have them.
2. **`rfc-needed`.** Add this label when the issue is worth a design doc. Small
   typo fixes, obvious bug fixes, and chores do not need an RFC.
3. **RFC PR.** Branch from `dev` in a new worktree. Copy
   [0000-template.md](0000-template.md) to `docs/rfcs/NNNN-slug.md`, fill it in,
   and open a PR **into `dev`**. The RFC must link the issue or issues that
   prompted it. Do not start implementation in the RFC PR.
4. **Review.** Status moves from Draft to In review when the write-up is ready
   for Sunny. Keep the same status in the RFC front-matter and in the PR labels.
   The PR description is the reading copy (see below). Sunny can answer the
   numbered questions in one PR comment (for example, "1 library only, 2 no")
   or comment inline on the file.
5. **Decision.** Sunny accepts or rejects the RFC. Update the front-matter and
   labels, then merge the RFC PR (including rejected RFCs, so the number and the
   decision stay in the repo). If the RFC is rejected, close its source issues
   as **not planned**, with a comment that names the RFC and the reason.
6. **Implementation.** Later PRs into `dev` do the work. Each one links the RFC
   (`Implements RFC NNNN`). The PR that completes the feature uses `Closes #N`
   for the source issues, and that same PR sets the RFC front-matter to
   Implemented and the label to `rfc:implemented`. Do not close the issues by
   hand when that PR merges into `dev`. Issues stay open until the work reaches
   `main` (production), so an open issue means it is not in prod yet.
7. **Release.** The `dev` → `main` release PR must also list `Closes #N` for
   every issue it ships. GitHub only auto-closes issues from PRs merged into
   the default branch, and it does not reliably chain those keywords through a
   merge commit. The release-PR workflow copies the lines from the included
   feature PRs. See [docs/RELEASING.md](../RELEASING.md).

A Saturday review looks at issues labeled `rfc-needed`, open RFC PRs, and
accepted RFCs that have not shipped. Open issues, including those whose
completing PR has already merged to `dev`, are not in production yet.

## Statuses and labels

| Status in front-matter | PR label | Meaning |
| --- | --- | --- |
| Draft | `rfc:draft` | Write-up in progress |
| In review | `rfc:in-review` | Ready for Sunny to decide |
| Accepted | `rfc:accepted` | Agreed; not fully implemented yet |
| Rejected | `rfc:rejected` | Will not be built, with the reason in the RFC |
| Implemented | `rfc:implemented` | The accepted work has shipped |

Every RFC PR also gets the `rfc` label.

Issue labels:

| Label | Meaning |
| --- | --- |
| `feedback` | Something a user said, logged as close to verbatim as possible |
| `feature-request` | A proposed change or new capability |
| `bug` | Something wrong or broken |
| `rfc-needed` | This issue should get an RFC before implementation |

Apply one status label at a time and change it when the status changes. The
front-matter is the source of truth once the RFC is merged; keep the labels in
step with it.

## Numbering and naming

- Files live at `docs/rfcs/NNNN-kebab-case-slug.md`.
- `0000-template.md` is the template, never a real RFC. The first RFC is `0001`.
- Take the next number when you open the RFC PR: one more than the highest
  `NNNN` already on `origin/dev` or in an open RFC PR. Check both so two drafts
  do not collide.
- Do not reuse or renumber, including after a rejection.

To inspect names on `dev` and in open RFC PRs:

```bash
gh api repos/jackroseman/pushup-counter/contents/docs/rfcs?ref=dev \
  --jq '.[].name'
gh pr list --repo jackroseman/pushup-counter --label rfc --state open \
  --json title,headRefName \
  --jq '.[] | [.title, .headRefName]'
```

Take the max `NNNN` from those filenames, titles, and branch names, then add one.
A filename-only check once you have `origin/dev` fetched:

```bash
git ls-tree -r --name-only origin/dev docs/rfcs/ \
  | grep -E 'docs/rfcs/[0-9]{4}-' \
  | sed -n 's/.*\/\([0-9]\{4\}\)-.*/\1/p' \
  | sort -n \
  | tail -1
```

Also scan open RFC PR branches (`rfc/NNNN-…`) before picking a number. If
nothing is printed, the next RFC is `0001`.

## Who decides

Sunny (Jack Roseman) accepts or rejects RFCs. Anyone can log feedback, open a
feature or bug issue, label an issue `rfc-needed`, and draft an RFC PR. Do not
merge an RFC PR unless Sunny has asked you to.

There are no time estimates in an RFC. Do not add a schedule, effort, or "when
this will ship" section.

## Opening a feedback issue

Prefer the Feedback form on GitHub when you are filling it in by hand. From an
agent or the CLI, create the same shape of issue (do not use this as a test;
only file real feedback):

```bash
gh issue create --repo jackroseman/pushup-counter \
  --title "Feedback: <short summary>" \
  --label feedback \
  --body "$(cat <<'MD'
## Who gave it
<name or handle>

## Where / channel
<TestFlight, text, in person, App Store, email, …>

## Verbatim quote
> <their words>

## App version
<version, or unknown>

## Screenshots
<none, or pasted images / links>
MD
)"
```

Add `--label rfc-needed` only when you already know it deserves an RFC. Feature
requests use `--label feature-request` and the Feature request headings
(Problem, Who it is for, Proposed idea, Alternatives). Bugs use `--label bug`
and the Bug report headings (Steps to reproduce, Expected, Actual, Device, iOS,
and app version).

## Listing open RFCs

Use this in the Saturday review. It reports open RFC PRs (still in flight) with
their status label and last-updated time, accepted RFCs that have not shipped,
and issues still waiting for a write-up.

```bash
echo "=== Open RFC PRs ==="
gh pr list --repo jackroseman/pushup-counter --base dev --label rfc --state open \
  --json number,title,updatedAt,labels,url \
  --jq '.[] | {
    number,
    title,
    updatedAt,
    url,
    status: ([.labels[].name | select(startswith("rfc:"))] | join(", "))
  }'

echo "=== Accepted, not yet implemented ==="
gh pr list --repo jackroseman/pushup-counter --label rfc:accepted --state merged \
  --json number,title,updatedAt,url \
  --jq '.[] | {number, title, updatedAt, url, status: "accepted"}'

echo "=== Issues waiting for an RFC ==="
gh issue list --repo jackroseman/pushup-counter --label rfc-needed --state open \
  --json number,title,updatedAt,labels,url \
  --jq '.[] | {number, title, updatedAt, url, labels: [.labels[].name]}'
```

`updatedAt` from GitHub is UTC. Convert it to America/New_York before reporting
it.

Once accepted RFCs live on `dev`, the front-matter is the source of truth (in
case a later commit changed `status` or `updated`). From a checkout of `dev`:

```bash
python3 - <<'PARSE_RFCS'
import pathlib
for path in sorted(pathlib.Path("docs/rfcs").glob("[0-9][0-9][0-9][0-9]-*.md")):
    if path.name == "0000-template.md":
        continue
    text = path.read_text()
    fm = text.split("---", 2)[1]
    fields = {}
    for line in fm.splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            fields[k.strip()] = v.strip().strip('"')
    if fields.get("status") in {"Implemented", "Rejected"}:
        continue
    print(
        f"{path}  rfc={fields.get('rfc')}  status={fields.get('status')}  "
        f"updated={fields.get('updated')}  title={fields.get('title')}"
    )
PARSE_RFCS
```

## Opening an RFC PR

Work in a **new worktree** off `origin/dev`. Do not switch or commit in the
shared `/workspace/PushupCounter` checkout.

### PR description (the reading copy)

The markdown file is the source of truth. The PR description is the reading
copy, so the reviewer never has to read raw markdown in the diff.

Write the description in this order, and pass it with `--body-file` when you
open or update the PR:

1. `Refs #N` lines for each source issue (not `Closes`, because merging the
   RFC does not ship the feature).
2. A one-line note that the markdown file is the source of truth and that this
   description mirrors it, plus how to review: answer the numbered questions in
   one PR comment (for example, "1 library only, 2 no"), or comment inline on
   the file.
3. The full RFC body, pasted from the file without the YAML front-matter, so
   it renders in the conversation.
4. A **Questions for you** section that repeats the numbered open questions,
   each with the options and a recommended answer.

Whenever the RFC file changes, re-sync the description from it so they never
disagree. After a question is answered, move the answer into the decision log,
update the file, and re-sync the description.

```bash
git fetch origin dev
NEXT=0001  # or the next number from the commands above
SLUG=short-kebab-slug
git worktree add -b rfc/${NEXT}-${SLUG} /workspace/pc-rfc-${NEXT} origin/dev
cd /workspace/pc-rfc-${NEXT}
cp docs/rfcs/0000-template.md docs/rfcs/${NEXT}-${SLUG}.md
# Fill in the front-matter and sections. Link the issue(s). Do not add a time estimate.
git add docs/rfcs/${NEXT}-${SLUG}.md
git commit -m "docs(rfc): ${NEXT} <title>"
git push -u origin rfc/${NEXT}-${SLUG}
# Build the PR description from the RFC file, then open the PR.
# Fill in the Questions for you section in /tmp/rfc-pr-body.md before creating
# the PR. After later file edits, rebuild the body and run:
#   gh pr edit <n> --repo jackroseman/pushup-counter --body-file /tmp/rfc-pr-body.md
export NEXT SLUG
export RFC_ISSUE=<n>  # source issue number, or a comma-separated list in the header
python3 - <<'PY' > /tmp/rfc-pr-body.md
from pathlib import Path
import os
next_num = os.environ["NEXT"]
slug = os.environ["SLUG"]
issue = os.environ.get("RFC_ISSUE", "<n>")
path = Path(f"docs/rfcs/{next_num}-{slug}.md")
body = path.read_text().split("---", 2)[2].lstrip("\n")
print(f"""Refs #{issue}

`{path}` is the source of truth; this description mirrors it. To review, answer the numbered questions in one PR comment, e.g. "1 library only, 2 no", or comment inline on the file.

{body}
## Questions for you

Repeat each numbered open question here, with its options and a recommended answer.
""")
PY
gh pr create --repo jackroseman/pushup-counter --base dev \
  --title "RFC ${NEXT}: <Title>" \
  --label rfc --label rfc:draft \
  --body-file /tmp/rfc-pr-body.md
```

Do not close the originating issues when the RFC PR merges, and do not close
them by hand when the completing PR merges into `dev`. The completing PR
includes `Closes #N` for each source issue, updates the RFC file to
`status: Implemented`, and switches the label from `rfc:accepted` to
`rfc:implemented`. The issues stay open until the `dev` → `main` release
PR also lists those `Closes #N` lines and is merged.
`.github/workflows/release-pr-closes.yml` copies the lines onto the
release PR when it is opened or edited. If you open that PR by hand, add
the lines yourself, or edit the body to trigger the workflow, or run
`.github/scripts/release-closes.sh --apply <pr>`.

If the RFC is rejected, close the source issues as not planned, with the
reason:

```bash
gh issue close N --repo jackroseman/pushup-counter --reason "not planned" \
  --comment "Closed as not planned. See RFC NNNN (<RFC PR or file url>): <reason>."
```

When the write-up is ready, switch the label from `rfc:draft` to `rfc:in-review`
and mark the PR ready for review. After Sunny decides, set the front-matter and
the status label to Accepted or Rejected, then merge only if he has asked you
to.

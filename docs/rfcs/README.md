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
  Implementation PRs link the RFC
        ↓
  Implemented
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
5. **Decision.** Sunny accepts or rejects the RFC. Update the front-matter and
   labels, then merge the RFC PR (including rejected RFCs, so the number and the
   decision stay in the repo).
6. **Implementation.** Later PRs into `dev` do the work. Each one links the RFC
   (`Implements RFC NNNN`) and closes the originating issues (`Closes #n`) when
   the issue is actually done. When the work has shipped, set the RFC status to
   Implemented.

A Saturday review looks at issues labeled `rfc-needed`, open RFC PRs, and
accepted RFCs that are not yet implemented.

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
gh pr create --repo jackroseman/pushup-counter --base dev \
  --title "RFC ${NEXT}: <Title>" \
  --label rfc --label rfc:draft \
  --body "$(cat <<END
Adds \`docs/rfcs/${NEXT}-${SLUG}.md\`.

Related issues: #<n>

Status: Draft. Move to In review (label \`rfc:in-review\`, mark the PR ready)
when the write-up is complete.
END
)"
```

Do not close the originating issue when the RFC PR merges. Close it from the
implementation PR with `Closes #n` once the work has actually shipped.

When the write-up is ready, switch the label from `rfc:draft` to `rfc:in-review`
and mark the PR ready for review. After Sunny decides, set the front-matter and
the status label to Accepted or Rejected, then merge only if he has asked you
to.

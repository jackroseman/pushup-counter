---
rfc: 0
title: "Short descriptive title"
status: Draft
author: ""
created: YYYY-MM-DD
updated: YYYY-MM-DD
issues: []
owner: ""
---

<!--
  Copy this file to docs/rfcs/NNNN-slug.md. Replace NNNN, the slug, and every
  section below. Status is one of: Draft, In review, Accepted, Rejected,
  Implemented. Keep the matching rfc:* label on the PR in sync.
  Do not add a time estimate, schedule, or effort section.
  Dates are YYYY-MM-DD in America/New_York.
-->

# RFC 0000: Short descriptive title

## Summary

A few sentences: what this proposes, and why now.

## Problem and evidence

What is wrong or missing today, and who feels it. Link the feedback, feature,
or bug issues that prompted this RFC (the same ids as `issues` in the
front-matter). Quote users verbatim when you have their words.

## Goals and non-goals

**Goals**

- What this RFC is trying to make true.

**Non-goals**

- What this RFC will not do, so the work stays bounded.

## User experience

Design the screens and empty states before the implementation plan. New UI
follows the style guide in [docs/rebrand/](../rebrand/). Mockups are labeled
MOCKUP, start from a real screenshot when the screen already exists, and draw
only what changes. Describe the experience in plain, generic copy.

## Proposal

How the product should work if this is accepted. Be concrete about states,
copy, and what the user can do.

## Data model and RPC/view changes

The back end has the opinions; the front end implements the back end. Describe
the tables, views, and RPCs that will own the new rules (outcomes, turn, sort,
eligibility, windows, records). The client only fetches, formats, and lays
out. If a screen would look different depending on a rule, that rule belongs
in a migration, not in TypeScript.

If this RFC does not change the database, say so and why.

## Testing

Smart behavioral tests, not tests written only to touch a function. For
database changes, name the decisions a test must assert (a turn, an outcome, a
window, an RLS denial). Follow the Testing philosophy in
[docs/developer-guide.md](../developer-guide.md#testing-philosophy).

## Rollout and migration

- Migrations land on staging when this work merges to `dev`, and on production
  when the release merges to `main`.
- Is an EAS / native build required, or is the change OTA-safe? Say whether
  the native fingerprint changes, and do not start a build unless Sunny has
  agreed to one.
- Note anything backwards compatible (or not) with the app version already
  installed.

## Alternatives

Other ways to solve the problem, including doing nothing, and why the proposal
above is preferred.

## Open questions

Unresolved choices that should be settled before acceptance. Remove or move
them to the decision log as they are answered.

## Decision log

| Date | Decision | By |
| --- | --- | --- |
| YYYY-MM-DD |  |  |

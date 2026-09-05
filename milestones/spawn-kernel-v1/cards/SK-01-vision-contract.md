---
id: SK-01
title: "Rewrite the vision around the spawn kernel"
status: ready
depends_on: []
risk: low
---

# SK-01: Rewrite the vision around the spawn kernel

## Outcome

Make `VISION.md` the authoritative policy for a policy-neutral, foreground-only configured Pi child launcher.

## Source context

Current `VISION.md` claims ownership of workflows, supervision, evidence, observability, background work, and external agents. The accepted audit in `.lavish/spawn-only-audit.html` explicitly supersedes those claims.

## In scope

- Rewrite `VISION.md` around the exact contract and invariants in the milestone README.
- State why the named-child boundary adds value over vanilla Pi.
- State foreground-only v1, fresh context default, hard cutovers, and Pi-owned provider auth/registration.
- Identify external runners as possible future separate packages without adapter design.

## Out of scope

Runtime, tests, README, changelog, package metadata, or detailed migration guidance.

## Implementation notes

Write a concise acceptance policy, not a roadmap. Remove—not qualify—conflicting platform commitments. Do not preserve compatibility promises.

## Acceptance criteria

- Vision positively defines list and exact one-child foreground launch.
- Every milestone invariant is compatible with it.
- It rejects all milestone non-goals and policy inference.
- No wording promises async or a universal vendor adapter.

## Verification commands

```bash
git diff --check -- VISION.md
rg -n "workflow|mission|schedule|async|external|supervis|acceptance" VISION.md
```
Review every match for explicit exclusion rather than retained ownership.
## Handoff/report requirements

Report changed files, exact commands and results, and unresolved risks. Stay within this card; do not self-select extra cards, do not mark the card done, and do not edit the milestone status table. Keep one writer in the shared cwd.

---
id: SK-09
title: "Prove the kernel contract and absence of legacy behavior"
status: ready
depends_on: [SK-08]
risk: medium
---

# SK-09: Prove the kernel contract and absence of legacy behavior

## Outcome

Close the milestone with end-to-end positive, negative, lifecycle, package, and absence evidence.

## Source context

Prior cards establish and prune the product. This card may fix only proof gaps or small defects in the retained contract; feature discoveries return to the owning card.

## In scope

- Test all discovery sources/precedence, empty list, exact lookup, one-child foreground behavior, fresh/default and explicit fork, explicit overrides, recursion isolation, timeout/abort/disposal, bounds, normalized errors, and usage.
- Test invalid/removed fields receive ordinary validation failure and generate no side effects.
- Verify exports/package contents and absence of removed imports, files, config, prompts, and runtime registrations.
- Repeat a concise real-child smoke test when credentials are available.

## Out of scope

New functionality, compatibility accommodations, async, external adapters, or subjective acceptance of child work.

## Implementation notes

Prefer behavioral tests over snapshots of implementation text. Include leak/race checks and filesystem before/after assertions. Treat auth-unavailable real-child smoke as separately reported environment evidence, never as a mocked pass.

## Acceptance criteria

- Every milestone invariant has named automated evidence.
- Removed feature probes cannot register, persist, or execute anything.
- Typecheck, full unit suite, full integration suite, and package dry-run pass.
- Final source/docs/package greps have no unexplained match.
- Parent can trace each definition-of-done item to evidence.

## Verification commands

```bash
npm run typecheck
npm run test:unit
npm run test:integration
npm pack --dry-run
rg -n "workflowScript|mission|schedule|async|worktree|Fleet|intercom|Herdr|Orca|externalCli|externalJob|compatibility" src test README.md docs package.json || true
```
## Handoff/report requirements

Report changed files, exact commands and results, and unresolved risks. Stay within this card; do not self-select extra cards, do not mark the card done, and do not edit the milestone status table. Keep one writer in the shared cwd.

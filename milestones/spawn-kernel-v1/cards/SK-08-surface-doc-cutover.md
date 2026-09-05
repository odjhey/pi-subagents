---
id: SK-08
title: "Cut package, configuration, and documentation surfaces"
status: ready
depends_on: [SK-07]
risk: medium
---

# SK-08: Cut package, configuration, and documentation surfaces

## Outcome

Align every shipped surface with the spawn-only hard cutover and remove compatibility residue.

## Source context

`package.json` currently exports 13 paths and describes workflows. `README.md`, `CHANGELOG.md`, `docs/`, root `index.ts`, API barrels, config schemas, examples, and tests advertise removed capabilities. Audit evidence also identifies builtin overrides, `.agents/`, chain serializers, prompt-template bridges, MCP aliases, and public-execution compatibility branches.

## In scope

- Reduce exports to root plus only genuinely needed runtime registration/types surface.
- Remove stale API files, config keys, aliases, forwarding files, deprecated schemas, and compatibility branches.
- Rewrite README/supported docs for exact list/launch contract; delete obsolete docs.
- Add a clear breaking-change CHANGELOG entry.
- Ensure package contents and metadata describe no removed system.

## Out of scope

New adapters, migration shims, a universal plugin API, or runtime behavior beyond fixing surface leaks found here.

## Implementation notes

This is the only card intended to edit package metadata, README, CHANGELOG, and existing docs. Documentation should say provider auth/registration belongs to Pi and external runners may be separate future packages, without API speculation. Removed inputs should simply be absent.

## Acceptance criteria

- Package exports resolve and expose no removed products.
- README has runnable list and foreground examples and an empty-list example.
- Docs/config contain only supported definition and launch fields.
- No compatibility alias, `.agents/` scanner, builtin override, chain scanner, or legacy bridge remains.
- Packaged file inspection contains no stale entry point.

## Verification commands

```bash
npm run typecheck
npm pack --dry-run
rg -n "workflow|mission|schedule|async|worktree|Fleet|intercom|external[- ]?(cli|job)|compat|deprecated|\.agents" README.md CHANGELOG.md docs src package.json || true
```
## Handoff/report requirements

Report changed files, exact commands and results, and unresolved risks. Stay within this card; do not self-select extra cards, do not mark the card done, and do not edit the milestone status table. Keep one writer in the shared cwd.

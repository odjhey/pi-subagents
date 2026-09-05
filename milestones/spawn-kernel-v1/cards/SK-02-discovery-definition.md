---
id: SK-02
title: "Reduce deterministic agent discovery and definitions"
status: ready
depends_on: [SK-01]
risk: medium
---

# SK-02: Reduce deterministic agent discovery and definitions

## Outcome

Produce a small tested discovery module for package, user, project, configured scan-directory, and runtime definitions with exact deterministic resolution.

## Source context

`src/agents/agents.ts` currently mixes discovery with builtins, chain parsing, acceptance, permissions, memory, model profiles, external runners, and compatibility overrides. Runtime registration is in `src/agents/runtime-agent-registry.ts`; identity/selection/frontmatter helpers are nearby.

## In scope

- Define the minimal agent definition fields from the milestone contract.
- Preserve the five accepted sources and document/test precedence, stable ordering, duplicate diagnostics, empty discovery, and exact-name lookup.
- Remove builtin and chain discovery plus aliases/override semantics from this path.
- Validate configured cwd/model/tools/context values syntactically without authenticating providers.

## Out of scope

Launching sessions, public schema switch, broad deletion of now-unreachable modules, CRUD, provider registration, or compatibility errors.

## Implementation notes

Split or replace `agents.ts` rather than continuing its aggregate type. Ensure filesystem enumeration is sorted before merging. Runtime registration must participate through the same normalized definition shape. Fail blocking conflicts deterministically.

## Acceptance criteria

- Repeated discovery produces byte-for-byte stable list ordering and diagnostics.
- Empty install returns an empty list.
- Each accepted source and precedence collision has focused tests.
- Exact lookup never guesses, aliases, or selects by role.
- Minimal definitions contain no acceptance, memory, fallback, runner, worktree, or async fields.

## Verification commands

```bash
npm run typecheck
node --experimental-strip-types --import ./test/support/isolated-temp-root.mjs --test test/unit/agents*.test.ts test/unit/*discovery*.test.ts
```
## Handoff/report requirements

Report changed files, exact commands and results, and unresolved risks. Stay within this card; do not self-select extra cards, do not mark the card done, and do not edit the milestone status table. Keep one writer in the shared cwd.

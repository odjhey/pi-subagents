---
id: SK-04
title: "Cut the public extension over to list and foreground launch"
status: ready
depends_on: [SK-03]
risk: high
---

# SK-04: Cut the public extension over to list and foreground launch

## Outcome

Make the production extension expose only minimal list and foreground launch operations backed by SK-02/SK-03.

## Source context

`src/extension/index.ts` registers watchers, schedules, wait tools, TUI, RPC, slash bridges, watchdog, and the overloaded executor. `src/extension/schemas.ts` defines the 80-field contract; `tool-description.ts` is prescriptive. The root `index.ts` is the extension entry.

## In scope

- Replace the schema with the exact list/launch request fields.
- Replace executor wiring with the new discovery/kernel path.
- Factual, policy-neutral tool description and compact normalized result rendering.
- Foreground-only behavior and extension-disposal abort wiring.
- Focused integration tests proving one child and side-effect-free list.

## Out of scope

Broad file deletion, package exports/docs cleanup, slash commands, compatibility shims, async status/stop, or improving removed systems.

## Implementation notes

Perform a hard switch: do not feature-flag or route old shapes. Unknown fields/actions should fail normal schema validation. Keep temporarily unreachable legacy modules only until deletion cards. Ensure registration supplied to children excludes `subagent`.

## Acceptance criteria

- Model-facing schema has only `action: list` or the seven launch fields named in the milestone contract.
- Launch is foreground regardless of old config and returns the normalized result.
- List launches no child and writes nothing.
- Removed calls do not enter legacy routes and receive no compatibility-specific handling.
- Extension shutdown aborts and cleans the owned child.

## Verification commands

```bash
npm run typecheck
node --experimental-strip-types --import ./test/support/isolated-temp-root.mjs --test test/unit/*schema*.test.ts test/unit/*extension*.test.ts
node --experimental-strip-types --import ./test/support/register-loader.mjs --test test/integration/*subagent*.test.ts
```
## Handoff/report requirements

Report changed files, exact commands and results, and unresolved risks. Stay within this card; do not self-select extra cards, do not mark the card done, and do not edit the milestone status table. Keep one writer in the shared cwd.

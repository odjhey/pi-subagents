---
id: SK-07
title: "Delete orchestration, async, integrations, and rich management"
status: ready
depends_on: [SK-06]
risk: high
---

# SK-07: Delete orchestration, async, integrations, and rich management

## Outcome

Delete every product surface beyond configured discovery, list, and exact one-child foreground launch.

## Source context

Targets include `src/workflows/`, `src/runs/background/`, worktree/lane/fanout modules, `src/intercom/`, `src/tui/`, `src/inspectors/`, `src/integrations/`, RPC/bridges/slash workflow/admin modules, external CLI/job adapters and APIs, and the old foreground executor after cutover.

## In scope

- Remove async entirely, including status/stop, workers, watchers, retention, artifacts, auto-drain, and process ownership machinery.
- Remove workflows/chains/fanout/resources, worktrees/lanes, supervision/intercom, TUI/Fleet/RPC, Herdr/Orca/Gist/bridges, external CLI/vendor jobs, and management actions except list.
- Remove associated tests and stale internal types/imports.
- Preserve only launch lifecycle cleanup and minimal result formatting proven by SK-03/04.

## Out of scope

Package export and prose cleanup (SK-08), speculative extraction packages, universal adapters, or compatibility rejection stubs.

## Implementation notes

Delete by feature family in reviewable commits if desired, but deliver one card boundary. External support is removed, not generalized. Do not replace rich UI with another UI framework.

## Acceptance criteria

- No background child, workflow, chain, worktree, vendor runner, rich UI, intercom, RPC, or old manager can be reached or imported.
- Only list and launch are registered.
- Source dependency graph contains no deleted-family islands.
- Foreground kernel tests and dogfood invocation still pass.

## Verification commands

```bash
rg -n "async|workflowScript|mission|worktree|lane|Fleet|intercom|Herdr|Orca|externalCli|externalJob|rpc|bg_wait" src test || true
npm run typecheck
node --experimental-strip-types --import ./test/support/isolated-temp-root.mjs --test test/unit/*.test.ts
node --experimental-strip-types --import ./test/support/register-loader.mjs --test test/integration/*.test.ts
```
## Handoff/report requirements

Report changed files, exact commands and results, and unresolved risks. Stay within this card; do not self-select extra cards, do not mark the card done, and do not edit the milestone status table. Keep one writer in the shared cwd.

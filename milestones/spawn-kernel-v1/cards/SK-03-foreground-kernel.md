---
id: SK-03
title: "Implement the single-child foreground kernel"
status: ready
depends_on: [SK-01, SK-02]
risk: high
---

# SK-03: Implement the single-child foreground kernel

## Outcome

Create an independently callable kernel that validates one launch, opens exactly one Pi child session, waits in the foreground, and returns a bounded normalized result.

## Source context

`src/runs/shared/child-session.ts` is the viable Pi session seam. `src/runs/foreground/subagent-executor.ts` and `execution.ts` mix that seam with policy, workflows, async, artifacts, intercom, worktrees, and management. Context helpers live under `src/shared/fork-context.ts`; lifecycle helpers are spread through `src/runs/shared/`.

## In scope

- Minimal launch request and normalized terminal result types.
- Fresh in-memory session default; exact explicit fork only.
- Explicit cwd/model/thinking/tools/config validation and honest Pi errors.
- Neutral recursion isolation that withholds the parent launcher registration.
- Timeout, AbortSignal/host abort, startup failure, disposal, and idempotent bounded cleanup.
- Bounded output and error text with stable truncation markers; stable reported-usage projection.
- Injectable session factory tests proving one create and one prompt maximum.

## Out of scope

Public extension/tool routing, async, steering/follow-up, acceptance, artifacts/history, provider auth/registration, or broad legacy deletion.

## Implementation notes

Center the new module on `child-session.ts`, retaining only Pi-native resource loading needed by explicit definitions. Do not infer task intent or make extra model calls. Settle every terminal path through one cleanup routine and test races with fake timers/factories. Define concrete bounds as named constants and test Unicode boundary behavior.

## Acceptance criteria

- One request creates exactly one session and blocks until terminal.
- Default storage/context is fresh; fork occurs only by explicit request.
- Recursion tool is unavailable without injected supervisory prose.
- Timeout and caller abort return distinct normalized errors and dispose once.
- Output/error never exceed documented bounds; usage is stable and unjudged.
- No persistence/background process is created.

## Verification commands

```bash
npm run typecheck
node --experimental-strip-types --import ./test/support/isolated-temp-root.mjs --test test/unit/*child-session*.test.ts test/unit/*foreground*.test.ts test/unit/*spawn*.test.ts
```
## Handoff/report requirements

Report changed files, exact commands and results, and unresolved risks. Stay within this card; do not self-select extra cards, do not mark the card done, and do not edit the milestone status table. Keep one writer in the shared cwd.

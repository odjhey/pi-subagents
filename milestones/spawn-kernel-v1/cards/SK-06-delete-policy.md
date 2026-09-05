---
id: SK-06
title: "Delete policy inference and prompt mutation systems"
status: ready
depends_on: [SK-05]
risk: high
---

# SK-06: Delete policy inference and prompt mutation systems

## Outcome

Remove all code that decides how child work should behave or whether it is adequate, leaving only syntactic launch/result validation.

## Source context

Policy is concentrated in `src/runs/shared/{acceptance,task-intent,completion-guard,llm-intent-arbiter,completion-evidence,mutation-evidence}.ts`, `src/missions/`, `src/policy/`, `src/watchdog/`, `src/agents/{agent-memory,agent-refinements,proactive-skills}.ts`, `src/profiles/`, model fallback/exclusions, control/intercom prompt runtime, and prescriptive tool text.

## In scope

Delete those modules, callers, schemas/types/config, tests, prompt additions, hidden model calls, and persistence readers/writers. Remove schedules here because they synthesize authority and dispatch. Keep only neutral recursion isolation, explicit exact model/thinking, timeout, and syntactic bounds.

## Out of scope

Workflow/async/UI/vendor platform deletion assigned to SK-07; package/docs exports assigned to SK-08.

## Implementation notes

Delete rather than stub. Update/delete tests that preserve removed behavior. Use dependency searches after each family; do not fold unrelated kernel refactors into this card.

## Acceptance criteria

- No task prose is classified for intent, authority, mutation, adequacy, completion, or review.
- No hidden prompt policy or extra model call exists.
- Missions, schedules, watchdog, memory/refinements/profiles/fallback are absent.
- Explicit unavailable models fail rather than reroute.
- Kernel contract tests remain green.

## Verification commands

```bash
rg -n "acceptance|completionGuard|taskIntent|mission|schedule|watchdog|refinement|agentMemory|fallbackModels|modelExclusions" src test || true
npm run typecheck
node --experimental-strip-types --import ./test/support/isolated-temp-root.mjs --test test/unit/*.test.ts
```
## Handoff/report requirements

Report changed files, exact commands and results, and unresolved risks. Stay within this card; do not self-select extra cards, do not mark the card done, and do not edit the milestone status table. Keep one writer in the shared cwd.

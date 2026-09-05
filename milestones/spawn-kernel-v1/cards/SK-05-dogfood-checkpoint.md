---
id: SK-05
title: "Dogfood the cutover launcher on a real repository task"
status: ready
depends_on: [SK-04]
risk: medium
---

# SK-05: Dogfood the cutover launcher on a real repository task

## Outcome

Prove the new public launcher can perform a real, useful repository task before legacy systems are deleted.

## Source context

The cutover path from SK-04 must now be the only public path. This checkpoint is evidence, not a synthetic unit test and not permission to repair unrelated behavior.

## In scope

- Add a temporary project agent with read-only tools and fresh context.
- Through the installed/local extension, ask it to inspect `src/extension/index.ts` and report imports that belong to removal cards SK-06/SK-07, with file paths and no edits.
- Verify exactly one foreground child, bounded output/usage, no recursive `subagent`, and no new background/artifact/mission files.
- Record reproducible request, output summary, command/transcript location, and cleanup the temporary agent.

## Out of scope

Implementing findings, accepting subjective quality, running via an old executor, background mode, or retaining the temporary definition.

## Implementation notes

Use real Pi credentials/config already available; do not add secrets or mock the session. Provider auth/registration failures are environment failures to report honestly. Snapshot relevant generated-file locations before/after. If dogfood fails, stop the milestone and return to the owning prior card.

## Acceptance criteria

- A real Pi child returns a useful import inventory from fresh context.
- Evidence shows one foreground session and no recursion launch tool.
- No legacy persistence/background side effects appear.
- Output/error/usage obey the public normalized bounds.
- Temporary agent and evidence secrets are absent from the final diff.

## Verification commands

```bash
git status --short
# Run the documented local Pi invocation for the recorded list and launch requests.
find .pi .subagents -type f -newer /tmp/spawn-kernel-dogfood-start 2>/dev/null || true
git status --short
```
## Handoff/report requirements

Report changed files, exact commands and results, and unresolved risks. Stay within this card; do not self-select extra cards, do not mark the card done, and do not edit the milestone status table. Keep one writer in the shared cwd.

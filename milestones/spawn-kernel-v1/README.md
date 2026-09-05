# Spawn Kernel v1

## Objective

Reduce `pi-subagents` in place to a policy-neutral Pi child-agent launcher: deterministically discover configured agents, list them, or launch exactly one Pi child in the foreground and return one bounded normalized result. This is a hard cutover, not a compatibility program.

## Why this exists instead of vanilla Pi

Vanilla Pi can create sessions, but it does not provide this small named-child boundary for a parent session: layered configured-agent discovery, exact-name resolution, recursion isolation, launch validation, lifecycle cleanup, and a stable bounded result. The package earns its existence only by making that boundary convenient and deterministic. It must not plan, judge, supervise, schedule, persist, route among vendors, or manage repositories for the caller.

The owner's accepted spawn-only direction is authoritative over the current `VISION.md`. Card SK-01 therefore changes the acceptance policy before runtime work.

## Exact target contract

The extension exposes one `subagent` tool with two operations:

- **List:** `{ action: "list" }` returns `{ agents: Array<{ name, description, source }>, diagnostics: Array<{ code, message, source? }> }`. Agents and diagnostics are stably sorted. An empty array is valid. Listing has no side effects.
- **Launch (default operation):** `{ agent, task, cwd?, context?, model?, thinking?, timeoutMs? }` resolves one exact configured agent and synchronously launches exactly one Pi child. `agent` and non-empty `task` are required; `context` is `"fresh" | "fork"`; `timeoutMs` is a positive finite integer subject to a documented implementation ceiling. The optional fields are explicit launch overrides, never inferred from task prose.

Configured definitions may specify `name`, `description`, `systemPrompt`, `tools`, `model`, `thinking`, context, and Pi-native skills/extensions where retained. Discovery precedence, lowest to highest, is package, user, configured scan directories in declaration order, project, then runtime registration; entries within a tier are path/name sorted before merge. A higher tier replaces the same exact name while producing a stable diagnostic; an ambiguous duplicate within one tier blocks that name. No agents are bundled. Builtin/chain discovery and compatibility aliases are removed.

`context` defaults to `fresh`. A fork is used only when explicitly requested and must be the exact supported Pi fork behavior, not a pruned or inferred context. Provider authentication and provider registration are Pi responsibilities. An unavailable explicit model/provider fails the launch; the kernel does not reroute or register providers.

A launch returns `{ status, output, error?, usage? }`, where `status` is `"completed" | "failed" | "timed_out" | "aborted"`, `output` is UTF-8 text capped at 64 KiB, `error` is `{ code, message }` with its message capped at 16 KiB, and truncation uses one documented marker included within the cap. `usage`, when Pi reports it, is `{ inputTokens?, outputTokens?, cacheReadTokens?, cacheWriteTokens?, costUsd? }`; absent values remain absent and are never interpreted as acceptance. Timeout, parent abort, and extension disposal abort the owned child, allow at most 5 seconds for cleanup, and never leave a live owned child. The child cannot access the parent `subagent` registration or recursively launch through this package. List and fresh-context launch create no persistent state; an explicit fork may create only Pi's native branch session file.

There is no async field or background lifecycle in v1. Unknown removed fields/actions fail ordinary schema validation; no bespoke compatibility messages or forwarding shims remain.

## Non-goals

- Async/background execution, status, stop, resume, steering, retention, or result artifacts.
- Workflows, chains, fanout, missions, goals, schedules, authority or acceptance policy.
- Completion inference, mutation inference, review/CI policy, watchdog behavior, memory, refinements, proactive skills, or model profiles/fallback.
- Worktrees, lanes, Git conventions, rich supervision/intercom, Fleet/TUI, RPC, Herdr, Orca, Gist, bridges, or project panes.
- Agent CRUD or legacy management actions beyond list.
- External CLI/vendor runners or provider integrations. Those may become separate packages if real demand appears; this milestone does **not** design a universal adapter API.
- Owning provider authentication or registration, which remains Pi's responsibility.

## Invariants

1. One launch request creates at most one child session and blocks until its terminal result.
2. Fresh context is the default; every deviation is explicit and observable.
3. Names, model, tools, context, and cwd are configuration, not conclusions drawn from English.
4. Discovery order and collision behavior are deterministic across repeated runs.
5. The child never receives this extension's launch tool; recursion isolation does not inject supervision policy.
6. Timeout, abort, startup failure, and disposal converge on bounded cleanup exactly once.
7. Returned output/errors/usage are normalized and bounded; success means Pi launch completion, not inferred adequacy.
8. List and fresh-context launch create no mission, schedule, artifact, history, worktree, watcher, or background process. Explicit fork may create only Pi's native branch session file.
9. No feature flags, deprecated aliases, compatibility branches, or dead exports preserve removed behavior.
10. Only Pi-native child sessions are core; explicit unavailable resources fail honestly.

## Ordered cards and dependency graph

| Order | Card | Purpose | Depends on |
|---|---|---|---|
| 1 | [SK-01](cards/SK-01-vision-contract.md) | Rewrite product acceptance policy | — |
| 2 | [SK-02](cards/SK-02-discovery-definition.md) | Reduce and prove deterministic configured-agent discovery | SK-01 |
| 3 | [SK-03](cards/SK-03-foreground-kernel.md) | Build and prove the lifecycle/result kernel | SK-01, SK-02 |
| 4 | [SK-04](cards/SK-04-public-cutover.md) | Switch the extension to list + foreground launch | SK-03 |
| 5 | [SK-05](cards/SK-05-dogfood-checkpoint.md) | Execute a real repository task through the new path | SK-04 |
| 6 | [SK-06](cards/SK-06-delete-policy.md) | Delete policy and prompt mutation systems | SK-05 |
| 7 | [SK-07](cards/SK-07-delete-platforms.md) | Delete orchestration, async, integrations, and UI products | SK-06 |
| 8 | [SK-08](cards/SK-08-surface-doc-cutover.md) | Remove stale exports/config/docs and package residue | SK-07 |
| 9 | [SK-09](cards/SK-09-final-proof.md) | Prove positive contract and absence of removed systems | SK-08 |

```text
SK-01 -> SK-02 -> SK-03 -> SK-04 -> SK-05 -> SK-06 -> SK-07 -> SK-08 -> SK-09
           \---------> SK-03
```

The kernel and public switch precede broad deletion so reviewers can compare a working replacement against legacy behavior. SK-05 is the explicit gate before deletion.

## Hands-on acceptance

Use [ACCEPTANCE-GUIDE.md](ACCEPTANCE-GUIDE.md) to test the tagged fork manually, including list behavior, fresh and fork context, exact failures, timeout recovery, parallel calls, parent waiting, strict definitions, and the final product-fit scorecard.

## Dogfood operating procedure

1. The parent assigns exactly one ready card and names its worker; workers do not self-select extra cards.
2. Use one writer in the shared cwd. Reviewers remain read-only; do not run concurrent writers or create worktree/lane machinery.
3. The worker reads this README, its card, `AGENTS.md`, and the then-current `VISION.md`, and reports any contract conflict before editing.
4. Keep the diff within the assigned card. Do not opportunistically clean later-card surfaces.
5. Run only the card's verification commands and record exact commands/results. A worker does **not** mark the card done or edit the parent-owned status table.
6. At SK-05, configure a temporary project agent and use the cutover launcher to perform the card's real read-only repository task. Capture the request and bounded result; remove temporary fixtures.
7. Hand off changed files, commands/results, and unresolved risks. The parent reviews evidence, updates status, and assigns the next card.

## Definition of done

- All cards are parent-approved and the status table is complete.
- Public behavior exactly matches list + single foreground launch; async and all named non-goals are absent from runtime, schemas, exports, package/docs, and tests.
- Discovery, fresh default, explicit fork/overrides, recursion isolation, timeout/abort/disposal, normalized bounds, errors, and usage have focused tests.
- SK-05 demonstrates a real repository task with no hidden policy, persistence, or background process.
- Grep/exports/package checks find no compatibility residue or removed feature entry points.
- Typecheck, focused tests, then the full unit and integration suites pass at milestone completion.
- README, CHANGELOG, and supported docs describe only the shipped contract, and VISION is the spawn-only acceptance policy.

## Parent-owned status

Only the parent/orchestrator edits this table. Workers must not mark cards done.

| Card | Status | Owner | Evidence / review |
|---|---|---|---|
| SK-01 | done | dogfood | `VISION.md` rewrite; `git diff --check`; reviewer PASS |
| SK-02 | done | dogfood | New deterministic discovery module; typecheck; 10 focused tests; reviewer PASS |
| SK-03 | done | dogfood | Foreground kernel + neutral child-session seam; lifecycle/unit/integration checks; reviewer PASS |
| SK-04 | done | dogfood | Public list/foreground hard cutover; deterministic source resolver + runtime registration; 53 focused unit tests; public integration; reviewer PASS |
| SK-05 | done | parent | Real local-extension foreground launch; one child; fresh/no recursion/no persistence; `evidence/SK-05.md`; reviewer PASS |
| SK-06 | done | dogfood + parent | Combined SK-06/SK-07 unreachable-graph deletion; no retained policy/prompt mutation; broad typecheck/tests/grep; reviewer PASS |
| SK-07 | done | dogfood + parent | Orchestration/async/integration/UI deletion; retained foreground lifecycle/recursion/fork-result fixes; 54 unit + 7 integration checks; reviewer PASS |
| SK-08 | done | dogfood + parent | v1.0 package/docs/export hard cutover; real Pi 0.85 dependency + lifecycle proof; 17-file tarball; 54 unit + 8 integration checks; reviewer PASS |
| SK-09 | done | dogfood + parent | `evidence/SK-09.md`; 55 unit + 10 integration + 3 proof tests; real public fresh smoke; 17-file tarball; reviewer release PASS |

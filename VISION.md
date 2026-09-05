# Vision

## Product boundary

`pi-subagents` is a policy-neutral spawn kernel for Pi. It deterministically discovers configured child-agent definitions, lists them, or launches exactly one named Pi child in the foreground and returns one bounded result.

Vanilla Pi can create sessions, but it does not provide this small named-child boundary: layered discovery, exact-name resolution, recursion isolation, launch validation, bounded lifecycle cleanup, and a stable normalized result. That boundary is the package's entire reason to exist. The parent remains responsible for deciding what work to delegate and whether the result is adequate.

## Public contract

The extension exposes one `subagent` tool with two operations:

- `{ action: "list" }` returns `{ agents, diagnostics }`. Agents contain `name`, `description`, and `source`; diagnostics contain `code`, `message`, and an optional `source`. Both arrays are stably sorted, an empty list is valid, and listing has no side effects.
- `{ agent, task, cwd?, context?, model?, thinking?, timeoutMs? }` resolves one exact configured name and synchronously launches at most one child. `agent` and a non-empty `task` are required. The optional fields are explicit launch overrides and are never inferred from task prose. `context` is `"fresh" | "fork"`; `timeoutMs` is a positive finite integer subject to a documented ceiling.

Definitions may configure identity, description, system prompt, tools, model, thinking, context, and retained Pi-native skills or extensions. No agents are bundled. Discovery precedence from lowest to highest is package, user, configured scan directories in declaration order, project, then runtime registration. Entries within a tier are path/name sorted before merge. A higher tier deterministically replaces the same exact name and emits a stable diagnostic; an ambiguous duplicate within one tier blocks that name. Builtin and chain discovery and compatibility aliases are not part of the product.

Fresh context is the default. Forking occurs only when explicitly requested and uses Pi's exact supported fork behavior; the kernel neither prunes nor invents context. Names, models, tools, context, and working directories are configuration, not conclusions drawn from English. Provider authentication and registration belong to Pi. An explicitly requested unavailable model or provider fails rather than being registered, substituted, or rerouted by this package.

A launch returns `{ status, output, error?, usage? }`. Status is `"completed" | "failed" | "timed_out" | "aborted"`. Output is UTF-8 text capped at 64 KiB. An error has `code` and `message`, with its message capped at 16 KiB. Truncation uses one documented marker included within the relevant cap. Usage, when Pi reports it, may contain `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, and `costUsd`; missing values remain missing and never affect acceptance.

A timeout, parent abort, or extension disposal aborts the owned child, permits at most five seconds for cleanup, and leaves no live owned child. Startup failure and every other terminal path also converge on cleanup exactly once. The child cannot access the parent's `subagent` registration or recursively launch through this package. Completion means only that Pi completed the launch; it is not a judgment about the quality, evidence, intent, or adequacy of the child's work.

## Deliberate exclusions

Version 1 is foreground-only. It has no async field, background lifecycle, status/stop/resume/steering API, retention, result artifacts, or hidden process. List and fresh-context launch create no history, watcher, worktree, lane, mission, schedule, or other persistent coordination state. An explicit fork may create only the Pi-native branch session file required by that requested context mode.

The kernel does not own workflows, chains, fanout, goals, authority, scheduling, supervision, intercom, completion or mutation inference, review or CI policy, watchdog behavior, memory, prompt refinements, proactive skills, model profiles, or fallback routing. It does not plan, judge, supervise, persist, or manage repositories for its caller. It injects no acceptance policy; recursion isolation is a technical boundary, not child-behavior policy.

Fleet/TUI surfaces, RPC, Herdr, Orca, Gist, bridges, project panes, Git conventions, managed worktrees, agent CRUD beyond listing, and legacy management actions are outside the product. External CLI or vendor runners and provider integrations are not Pi child spawning. If real demand appears, they may become separate packages; this project does not promise or design a universal adapter API.

Removed behavior is removed by hard cutover. Unknown actions and removed fields fail ordinary schema validation. There are no feature flags, deprecated aliases, forwarding shims, bespoke compatibility errors, dead exports, or compatibility branches preserving the former platform.

## Repository authoring tooling

The repository may host separately packaged authoring tools under `packages/`, such as `packages/preset-creator`. These tools help authors create and validate agent definitions and preset packages against the kernel's current contract. Keeping their source and tests alongside the kernel allows contract changes and authoring guidance to be maintained together.

Each authoring tool has its own package manifest, installation, and tests. Authoring tools and their skills, examples, and scaffolding helpers are excluded from the root kernel package and its public exports. The kernel runtime does not load or depend on them. Generated task-specific presets remain independent packages; their guidance does not become kernel policy.

## Acceptance policy

A kernel change belongs only when it strengthens deterministic configured-agent discovery or the single foreground Pi-child launch boundary while preserving all constraints above. It must keep fresh context as the default, make every deviation explicit and observable, create at most one child per request, isolate recursion, clean up owned children within the bound, and return normalized bounded data without interpreting success.

A kernel change does not belong when it adds policy inference, orchestration, persistence, background work, provider ownership, external execution, compatibility residue, or any surface unrelated to listing configured agents and launching one exact child. Prefer honest failure over hidden fallback and a hard cutover over preserving removed behavior.

An authoring-tool change belongs when it helps authors produce or validate configuration for this contract and preserves the separate package boundary above. It must not expand the kernel runtime, add kernel-owned orchestration, or bundle task-specific presets into the root package.

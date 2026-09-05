# pi-subagents

`pi-subagents` is a policy-neutral Pi extension that discovers configured child agents, lists them, or launches exactly one named Pi child in the foreground. It ships no agents, prompts, skills, workflows, or external runners.

This is the `odjhey/pi-subagents` spawn-kernel fork. The npm package named `pi-subagents` is the upstream project and does not install this fork.

## Install this fork

```bash
pi install git:github.com/odjhey/pi-subagents@v1.0.0
```

For development from an untagged branch, use `pi -e /absolute/path/to/pi-subagents/index.ts`.

Version 1.0 targets the Pi 0.85 API line. Pi owns provider definitions and authentication. Explicit child extensions are loaded through Pi and may register their own providers; this package supplies none and never substitutes or reroutes an unavailable explicitly requested model.

## List configured agents

Call the `subagent` tool from Pi:

```js
subagent({ action: "list" })
```

The result is `{ agents, diagnostics }`. Each agent has `name`, `description`, and `source`; each diagnostic has `code`, `message`, and optional `source`. Both arrays are stably sorted. Listing has no side effects.

With no definitions, the valid result is:

```json
{ "agents": [], "diagnostics": [] }
```

## Define an agent

Create `.pi/agents/code-map.md` in a project:

```md
---
name: code-map
description: Maps a requested code path
tools: read, grep, find, ls
context: fresh
thinking: medium
---

Follow the supplied task. Return concrete findings and file paths.
```

Markdown frontmatter supports exactly `name`, `description`, `tools`, `model`, `thinking`, `context`, `cwd`, `skills`, and `extensions`; the Markdown body is the system prompt. For files, `name` defaults to the filename and `description` defaults to an empty string. `context` is `fresh` or `fork`. Unknown fields invalidate the definition.

Definitions are merged from lowest to highest precedence:

1. package agent directories declared in a package manifest as `pi-subagents.agents` or `pi.subagents.agents`;
2. user definitions in `$PI_CODING_AGENT_DIR/agents` (normally `~/.pi/agent/agents`);
3. `subagents.agentScanDirs` from user settings followed by project settings, in declaration order;
4. project definitions in `<project>/.pi/agents`;
5. runtime registration.

Package manifests are inspected at the project root, under Pi's user/project managed npm roots, and at package sources declared in the user/project Pi `settings.json` `packages` arrays. Manifest agent-directory paths resolve from that package root. User and project scan-directory paths resolve from their respective configuration directories; `~` is supported. Project discovery uses the nearest ancestor containing Pi's project configuration directory or `.git`.

Files within a tier are path/name sorted. A higher tier replaces the same exact name and emits a diagnostic. A duplicate name within one tier is ambiguous and unavailable. Resolution is exact and case-sensitive.

## Launch one foreground child

Omitting `action` selects launch:

```js
subagent({
  agent: "code-map",
  task: "Trace the authentication request path without editing files."
})
```

Optional launch overrides are `cwd`, `context`, `model`, `thinking`, and `timeoutMs`. `agent` and a non-empty `task` are required. Overrides are explicit configuration and are never inferred from task prose. `timeoutMs` is a positive integer capped at 86,400,000 ms (24 hours). Launch and definition `cwd` values resolve from the parent invocation's current working directory. Configured `skills` and `extensions` are passed exactly to Pi's isolated child resource loader, which resolves relative paths from the resolved child `cwd`; ambient skills and extensions remain disabled.

`context` defaults to `fresh`, which creates no persistent history. `context: "fork"` explicitly uses Pi's native fork behavior and may create Pi's native branch session file; the kernel does not prune or invent context. An unavailable requested model/provider fails.

A launch blocks until it returns:

```ts
{
  status: "completed" | "failed" | "timed_out" | "aborted",
  output: string,
  error?: { code: string, message: string },
  usage?: {
    inputTokens?: number,
    outputTokens?: number,
    cacheReadTokens?: number,
    cacheWriteTokens?: number,
    costUsd?: number
  }
}
```

Output is UTF-8 capped at 64 KiB; error messages are capped at 16 KiB. Truncated text ends with `\n[truncated]`, included within the cap. Missing usage values remain missing. `completed` means Pi completed the child launch, not that the work was correct or adequate.

Timeout, parent abort, extension disposal, startup failure, and other terminal paths converge on cleanup exactly once. Abort/disposal allows at most five seconds for cleanup and leaves no owned child running. Each request creates at most one child. The child does not receive the parent's `subagent` registration, preventing recursive launches through this package.

## Runtime registration

Other Pi extensions may register process-local definitions through the only public subpath:

```ts
import { registerAgent } from "pi-subagents/agents";

const registration = registerAgent({
  pi,
  name: "runtime-helper",
  definition: {
    description: "Handles a bounded request",
    systemPrompt: "Follow the supplied task exactly.",
    tools: ["read", "grep"],
    context: "fresh"
  }
});

registration.dispose();
```

`registerAgent` works whether the calling extension or the owning `pi-subagents` extension loads first. It validates synchronously, rejects duplicate exact names once an owner adopts the registration, and returns an idempotent process-local disposal handle. The `./agents` export also exposes `RegisterAgentInput`, `RuntimeAgentDefinition`, and `RuntimeAgentRegistration`. Runtime registration requires `pi`, `name`, and `definition.description`; the remaining supported definition fields are optional: `systemPrompt`, `tools`, `model`, `thinking`, `context`, `cwd`, `skills`, and `extensions`.

## Preset authoring

This repository includes a separately installable authoring package at [`packages/preset-creator`](packages/preset-creator/README.md). It provides `/skill:preset-creator`, scaffold commands for individual agents and preset packages, and checks against the kernel's definition parser and Pi's skill loader. The authoring package is excluded from the root kernel distribution.

From the project where you want to author agents or presets, install it from a local checkout:

```bash
pi install -l /absolute/path/to/pi-subagents/packages/preset-creator
pi
```

Then ask `/skill:preset-creator` to create the agent or preset you need. Generated task-specific presets remain independent packages.

For development in this repository, `npm run test:preset-creator` validates the creator against the containing kernel checkout. `npm run test:all` includes both the kernel and creator suites; the package proof continues to enforce the kernel's exact 17-file distribution.

## Scope

This package provides only deterministic configured-agent discovery and one foreground Pi-child launch. The parent decides what to delegate and evaluates the result. There is no background lifecycle, persistence, orchestration, management UI, acceptance policy, provider integration, or external command runner.

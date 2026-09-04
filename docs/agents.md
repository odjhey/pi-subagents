# Custom agents

pi-subagents ships no agent definitions. An empty installation has no launchable agents.

## Discovery

Definitions are loaded from:

- project: `.pi/agents/*.md` (legacy `.agents/` is also scanned)
- user: the Pi agent directory and `~/.agents/`
- package: directories declared by installed packages through `pi-subagents.agents` or `pi.subagents.agents`
- additional directories: `subagents.agentScanDirs` or `PI_SUBAGENT_EXTRA_AGENT_DIRS`
- runtime: `registerAgent(...)` from another extension

Project and user definitions override lower-precedence package definitions. `subagent({action:"list", capabilities:true})` reports the effective inventory and source.

## Markdown contract

```md
---
name: code-map
description: Maps a requested code path
acceptanceRole: read-only
tools: read, grep, find, ls
systemPromptMode: replace
inheritProjectContext: true
inheritGlobalContext: false
defaultContext: fresh
---

Follow the caller's task. Return file paths and concrete evidence. Do not edit files.
```

Use `description`, prompt body, `tools`, `excludeTools`, `extensions`, `subagentOnlyExtensions`, `mcpDirectTools`, `model`, `thinking`, `defaultContext`, inheritance flags, `acceptanceRole`, `defaultAcceptance`, permissions, budgets, and runner configuration to state behavior explicitly. A definition's `name` and `aliases` are selection keys only.

`acceptanceRole: read-only | writer` affects acceptance and mutation contracts when task wording is ambiguous. It does not grant tools. Explicit no-edit or mutation wording in the task takes precedence.

## Runtime registration

```ts
import { registerAgent } from "pi-subagents/agents";

const registration = registerAgent({
  pi,
  name: "runtime-helper",
  definition: {
    description: "Handles a bounded request",
    systemPrompt: "Follow the supplied task and declared tool contract.",
    tools: ["read", "grep"]
  }
});

// Later:
registration.dispose();
```

Runtime names and aliases may use any valid unoccupied identity. Collisions are checked against agents actually present in the effective inventory, not a historical reserved-name list.

## Package agents

A package can expose its own definitions:

```json
{
  "pi-subagents": { "agents": ["./agents"] }
}
```

Package definitions are opt-in content owned by that package. pi-subagents provides discovery and execution but does not prescribe their names or roles.

## Context and tools

Defaults are role-neutral: `systemPromptMode` defaults to `replace`, project/global context inheritance defaults to false, and no name changes those values. Set inheritance and `defaultContext` explicitly when needed.

Omitted `tools` uses the normal child tool contract. An explicit list narrows it. `mcp:` selections and external runner adapters must be declared in configuration. Nested delegation requires `allowNestedSubagents: true` and remains depth/budget bounded.

## Management

`create`, `update`, and `delete` manage custom definitions. `get`, `list`, `models`, and `doctor` inspect them. Package definitions can be ejected into an editable user/project file where supported. With no configured agents, execution fails with the normal unknown-agent diagnostic.

Refinement is explicit:

```js
subagent({ action: "refine", agent: "target-agent", proposalAgent: "configured-evaluator" })
```

No proposal agent is selected automatically.

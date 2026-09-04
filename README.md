# pi-subagents

`pi-subagents` is a Pi extension for launching and supervising explicitly configured child agents.

## No bundled agents

The package ships **zero agent profiles, prompt recipes, or orchestration skills**. Installation adds the delegation engine, discovery, workflows, supervision, observability, and management APIs only. Agent names are identifiers: names and aliases do not imply tools, write access, context inheritance, acceptance policy, model selection, or follow-up behavior.

## Install

```bash
pi install npm:pi-subagents
```

After installation, `subagent({ action: "list" })` can legitimately return an empty list. Add at least one agent before executing work.

## Define a project agent

Create `.pi/agents/analysis-agent.md`:

```md
---
name: analysis-agent
description: Examines a requested area without changing files
acceptanceRole: read-only
tools: read, grep, find, ls
inheritProjectContext: true
---

Follow the task exactly. Return concrete findings and file paths. Do not edit files.
```

Definitions may instead live in user directories, installed packages, configured scan directories, or a runtime extension registration. See [docs/agents.md](docs/agents.md).

## Execute configured agents

```js
subagent({ agent: "analysis-agent", task: "Trace the authentication request path. Do not edit files." })
```

```js
subagent({
  workflowScript: `
    const analysis = await runs.run("analysis", {
      agent: "analysis-agent",
      task: "Identify the relevant files without editing"
    });
    return analysis.output;
  `,
  async: true
})
```

A workflow never chooses an agent by role. Every child launch names an installed agent explicitly. If mutation, independent checking, special context, or stronger evidence is required, state it in the task and configure the relevant tools, `acceptanceRole`, `context`, and `acceptance` fields explicitly.

## Discovery sources

Agents compose by precedence from installed packages, user configuration, project configuration, configured scan directories, and runtime registration. Custom definitions can use any valid name, including names used by older releases.

## Documentation

- [Agents](docs/agents.md) — authoring, discovery, runtime registration, and explicit contracts
- [Workflows](docs/workflows.md) — generic single, sequential, and parallel execution
- [Configuration](docs/configuration.md) — settings and context policy
- [Models](docs/models.md) — explicit model selection
- [Tool reference](docs/tool-reference.md) — execution and management shapes
- [Missions](docs/missions.md), [Observability](docs/observability.md), [Watchdog](docs/watchdog.md)
- [Extension API](docs/extension-api.md)

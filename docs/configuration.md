# Configuration

pi-subagents has two configuration surfaces.

## Extension config

Runtime and launch controls belong in:

`~/.pi/agent/extensions/subagent/config.json`

(`~/.pi/agent` follows `PI_CODING_AGENT_DIR` when set.) Common fields include `defaultSubagentContext`, `forkContext`, `asyncByDefault`, `globalConcurrencyLimit`, `maxActiveAsyncRunsPerSession`, `maxSubagentSpawnsPerSession`, `maxSubagentSpawnsPerRun`, `timeoutMs`, `toolTimeoutMs`, `permissions`, `toolBudget`, `usageBudget`, `worktree`, `artifactDir`, `missions`, and observability/display controls.

```json
{
  "defaultSubagentContext": "fresh",
  "asyncByDefault": true,
  "globalConcurrencyLimit": 8,
  "maxSubagentSpawnsPerRun": 32
}
```

## Pi settings

Agent discovery and definition overrides belong under `subagents` in user Pi settings (`~/.pi/agent/settings.json`) or project Pi settings (`<project>/.pi/settings.json`). Project values take precedence when both scopes are active.

Common fields include `defaultModel`, `defaultProvider`, `defaultThinking`, `defaultExtensions`, `maxThinking`, `agentScanDirs`, `projectRootResolution`, `modelScope`, `agentOverrides`, `agentOverridesByProvider`, and watchdog settings.

```json
{
  "subagents": {
    "agentScanDirs": ["~/my-agents"],
    "agentOverrides": {
      "configured-agent": {
        "inheritProjectContext": true,
        "acceptanceRole": "read-only",
        "tools": ["read", "grep", "find", "ls"]
      }
    }
  }
}
```

The package ships no agent definitions. An override does not create an agent: add a user, project, package, scan-directory, or runtime definition first. Agent names are identifiers only and do not imply behavior.

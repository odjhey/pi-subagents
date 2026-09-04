# Tool reference

## Execute

```js
{ agent: "configured-agent", task: "Perform the explicit task" }
```

```js
{ workflowScript: `return runs.run("main", { agent: "configured-agent", task: "Perform the explicit task" })`, async: true }
```

Execution and management fields are mutually exclusive. `workflowScriptPath` loads a script relative to request cwd. `workflow` selects an extension-owned named resource.

Common execution fields include `agent`, `task`, `model`, `context`, `cwd`, `worktree`, `output`, `outputSchema`, `acceptance`, tool/runtime/token budgets, mission attachment, and async controls. Agent names only resolve a discovered configuration.

## Inspect and manage

- `list`, `get`, `models`, `doctor`, `guide`
- `create`, `update`, `delete`, `eject`, `disable`, `enable`, `reset`
- `status`, `debug.run`, `interrupt`, `stop`, `resume`, `steer`, `children.list`
- mission, schedule, worktree, lane, inspector, project, refinement, and watchdog actions

Use `list` before execution. Zero rows is valid and means no agent is installed.

## Acceptance

Automatic acceptance considers explicit `acceptanceRole`, task mutation/no-edit wording, async/dynamic risk, and explicit acceptance configuration. It does not inspect the agent name. Risk can raise evidence requirements, but it does not invent an independent agent. Configure `acceptance.review.agent` explicitly and orchestrate that agent when independent review is required.

## Refinement

```js
{ action: "refine", agent: "target-agent", proposalAgent: "configured-evaluator" }
```

`proposalAgent` is mandatory for refinement. `refine.show` and `refine.rollback` address the target only.

## Named resources

```js
{ workflow: "run-ci", args: { command: "npm test" } }
{ workflow: "review", args: { agent: "configured-evaluator", task: "Check this result" } }
```

No named resource chooses an agent implicitly.

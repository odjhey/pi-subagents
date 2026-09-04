# Workflows

Workflows orchestrate explicitly configured agents. The extension ships no workflow prompts or role recipes and never substitutes an agent identity.

## Single child

```js
subagent({ agent: "configured-agent", task: "Perform the bounded task" })
```

## Sequential

```js
subagent({
  workflowScript: `
    const first = await runs.run("first", {
      agent: "configured-a",
      task: "Produce the requested analysis"
    });
    return (await runs.run("second", {
      agent: "configured-b",
      task: "Use this input and perform the requested change:\n" + first.output
    })).output;
  `,
  async: true
})
```

## Parallel

```js
subagent({
  workflowScript: `
    const results = await runs.all([
      { key: "api", agent: "configured-a", task: "Check the API contract" },
      { key: "ui", agent: "configured-b", task: "Check the UI contract" }
    ]);
    return results.map(result => result.output);
  `,
  async: true
})
```

`runs.all` returns an ordered array. Keys are stable execution identities, not object properties. Await every launch. Use managed worktrees or distinct cwd values for concurrent mutation.

## Context and acceptance

Set `context: fresh | fork | profile` explicitly when it matters. Otherwise configured global and per-agent defaults apply. Names do not select context.

Set `acceptance` explicitly for required criteria, verification commands, evidence, or independent review. A required review must name a configured agent in `acceptance.review.agent` and the workflow must orchestrate that child; there is no fallback identity.

## Prompt templates

User, project, or package prompt files can become commands when their frontmatter contains an explicit `subagent` value:

```md
---
description: Run a configured analysis
subagent: configured-a
---
Analyze $ARGUMENTS without editing files.
```

Templates without an explicit agent are not registered as subagent workflows.

## Named resources

`run-ci` is an extension-owned host resource with bounded commands. `review` is generic and requires both fields:

```js
subagent({ workflow: "review", args: { agent: "configured-evaluator", task: "Check the result" } })
```

## Supervision

Async execution remains observable through status, events, artifacts, notifications, and control actions. Workflow children can be resumed or steered only where their explicit runner contract supports it. Nested delegation requires explicit agent configuration and remains depth/session limited.

# Missions

Missions attach durable objective, state, decision, and run records to explicitly requested delegation. They do not choose agents or create work by themselves.

```js
subagent({
  mission: { title: "Bounded change", objective: "Complete the stated contract" },
  workflowScript: `return runs.run("main", { agent: "configured-agent", task: "Perform the approved task" })`,
  async: true
})
```

Use mission management actions to create, list, show, update, resolve decisions, attach runs, and close missions. Every child launch inside a mission still names a discovered agent explicitly and follows that agent's declared configuration.

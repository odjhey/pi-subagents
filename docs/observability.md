# Observability

Foreground and async runs expose their configured agent identity, state, duration, model, token/tool usage, outputs, and errors. Agent labels are displayed as supplied; they carry no role semantics.

Use `subagent({action:"status", id:"..."})` for retained runs, fleet view for a summary, transcript view for bounded output, and `debug.run` for lifecycle diagnostics. Async run directories contain status, event, and output artifacts. Workflow and worktree handoffs retain explicit child identities and paths.

Observability and supervision remain available even though the package ships no agent profiles. An empty discovery inventory is a normal state, not an observability failure.

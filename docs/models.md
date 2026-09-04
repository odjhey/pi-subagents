# Models

Model choice is explicit configuration, never an agent-name convention.

```json
{
  "subagents": {
    "defaultProvider": "provider-id",
    "defaultModel": "model-id",
    "defaultThinking": "medium",
    "agentOverrides": {
      "configured-agent": {
        "model": "provider-id/model-id",
        "thinking": "high"
      }
    }
  }
}
```

Agent frontmatter may set `model`, `fallbackModels`, and `thinking`. Request fields override configured defaults. Call `subagent({action:"models"})` to inspect resolved models and use an exact provider/id when ambiguity is possible.

`modelScope` constrains models globally or per explicitly named configured agent. It does not select a model or infer a capability.

Use `/subagents-refresh-provider-models <provider>` to refresh observed cost, context, output, latency, and quality signals. `/subagents-recommend-profile-models <provider>` reports quota and quality tier candidates but does not write a profile or invent agent mappings. Create profile `agentOverrides` for configured custom identities deliberately before applying it.

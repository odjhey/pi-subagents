# Extension API

Other extensions can compose with pi-subagents without adopting predefined roles.

## Register an agent

```ts
import { registerAgent } from "pi-subagents/agents";

const handle = registerAgent({
  pi,
  name: "package-helper",
  definition: {
    description: "Handles the package's bounded operation",
    systemPrompt: "Follow the explicit task and capability contract.",
    tools: ["read", "grep"]
  }
});
```

Names and aliases are available unless they collide with an agent actually registered or discovered. Historical profile names are not reserved.

## Execute and observe

Use the delegation/public execution APIs for explicit `{agent, task}` or workflow requests. Background-work, control-channel, intercom, capability-ceiling, preflight, external-run/provider, and project-pane APIs remain independent of shipped content.

External CLI behavior is declared through `runner.type` and `runner.adapter`; external-job behavior is declared by its provider. Neither is inferred from the agent identity.

Dispose runtime registrations when their owning extension unloads.

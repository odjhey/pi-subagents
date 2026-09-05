---
name: preset-creator
description: Create or update pi-subagents agent definitions and independent Pi preset packages, including complementary agents, parent skills, package metadata, and validation. Use when asked to make a Pi agent or a reusable agent preset.
---

Build the requested agents or preset as reusable configuration for the `odjhey/pi-subagents` v1 fork. Read [the authoring contract](references/contract.md) before writing definitions. Keep authoring files and task-specific guidance in the requested project or a separate preset package.

## Choose the output

Infer the task, intended users, and destination from the request and workspace. Inspect existing package manifests and definitions before changing them. Resolve routine design choices yourself; ask only when a material capability, scope, or destination cannot be inferred.

- For a reusable team, create a separate Pi package with agent definitions. Add a parent skill when the team needs selection guidance or handoffs.
- For one project agent, create a Markdown definition under that project's `.pi/agents/` directory.
- For an agent added to an existing preset, use its declared agent directory and preserve the existing manifest and other agents.
- For updates, edit the existing files directly and validate the final result. The scaffold only creates new destinations and never overwrites files.

Choose the number and responsibilities of agents from the task. Define distinct contributions and useful input/output handoffs; a preset does not have to use a scout/implementer/verifier sequence. Give agents exact, distinctive names to avoid package-tier collisions. Use the smallest tool set that supports their work, fresh context by default, and configured Pi model defaults unless the user requests specific overrides.

## Write complete definitions

For each agent, specify what it receives, what it should do, and what evidence or result it returns. Include behavior that matters to the task instead of generic personality prose. Frontmatter configures launch options; the Markdown body carries instructions. Write reusable instructions without copying session secrets, private task data, or machine-specific paths into the package.

For a parent skill, explain when to use the team, how to select its exact names, what context each fresh child needs, and how to hand results to dependent stages. Include applicable repository instructions in each child task. The parent owns sequencing, any parallel calls, and judgment of the results. Launches omit `action`; `{"action":"list"}` is only for discovery. A completed child can still report failed checks or incomplete work.

Preserve the user's requested authority and scope. Source-preservation instructions are behavior conventions when an agent has shell access. Do not describe them as an enforced sandbox.

## Scaffold new files

Resolve helper paths relative to this SKILL.md. The complete starter [preset.example.json](assets/preset.example.json) demonstrates a one-agent preset and parent skill. Read and adapt it when creating a package; replace its domain, names, prompts, tools, and handoffs with the requested design.

Write a JSON spec outside the output package. Each agent uses `name`, `description`, and `systemPrompt`, plus any supported launch defaults from the reference. A preset adds package `name`, `description`, an `agents` array, and optionally a `skill` with `name`, `description`, and `instructions`.

```bash
node /path/to/preset-creator/scripts/scaffold.mjs preset \
  --spec /path/to/preset-spec.json --out /path/to/new-preset
```

For one agent, the spec is a single agent object:

```bash
node /path/to/preset-creator/scripts/scaffold.mjs agent \
  --spec /path/to/agent-spec.json --out /project/.pi/agents/example-agent.md
```

The scaffold produces valid frontmatter and portable package resource paths, defaults tools to `read, grep, find, ls` when omitted, and leaves model selection unset. Inspect the generated README and prompts for fit. Replace all draft placeholders before presenting the output as usable. Choose package licensing with the user’s existing project conventions; a newly scaffolded package starts with `UNLICENSED` metadata.

## Validate and hand off

Use the real kernel and Pi loaders when a compatible kernel checkout is available. Locate the checkout from workspace context or the installed fork's package directory; do not install the upstream npm package named `pi-subagents` as a substitute.

```bash
node /path/to/preset-creator/scripts/check.mjs \
  --path /path/to/new-preset --kernel /path/to/pi-subagents
```

`--path` also accepts one agent Markdown file. For packages, this checks discovery and skill loading from an actual tarball, including resources accidentally omitted from packaging. It uses no provider calls or global settings changes. Report an unavailable kernel checkout as a verification gap rather than claiming the integration check passed.

For a new coordination pattern, exercise a representative task in a disposable workspace when execution is authorized and the needed tools/provider are available. Check useful handoffs and the resulting artifacts, not just model-reported completion. Preserve the user's existing work and report the limits of the test. A static check establishes loadability, not whether the team works well.

Deliver the output location, agent names and responsibilities, installation/invocation instructions, checks actually run, and any remaining gaps. Installation into the user's normal Pi environment and publishing are separate actions; creation alone does not require either. Package discovery requires registration in Pi's package settings, so document `pi install -l /path/to/preset`. Loading a preset only through `-e` does not register its agents for kernel discovery.

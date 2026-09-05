# pi-preset-creator

A reusable authoring skill for creating Pi agent definitions and independent preset packages. Ask an agent for the team or helper you need; the skill guides its design, scaffolds complete files, and checks them against the spawn kernel.

It provides `/skill:preset-creator`, a complete starter preset, a scaffold command, and an offline integration checker. The author chooses the roles, tools, prompts, and handoffs; the helper writes the package structure and constrained frontmatter.

Its source lives in `packages/preset-creator` within the `pi-subagents` repository. It has its own package manifest and installation, and is excluded from the root kernel distribution.

## Use in Pi

From the project where you want to make the authoring skill available:

```bash
pi install -l /absolute/path/to/pi-subagents/packages/preset-creator
pi
```

Then ask:

```text
/skill:preset-creator Create a documentation-review preset with a fact checker and a clarity reviewer. Keep it in a separate package at /path/to/pi-preset-doc-review. Include a parent skill and validate it against /path/to/pi-subagents.
```

The installed skill is also discoverable for ordinary requests to create Pi presets or agents. The `/skill:preset-creator` command loads it explicitly.

Or create a single agent:

```text
/skill:preset-creator Add a read-only agent named api-mapper to this project's .pi/agents directory. It should trace an API endpoint through its implementation and return paths and relevant tests. Validate against /path/to/pi-subagents.
```

The skill also supports updates to existing definitions. New scaffolds refuse existing destinations; updates are targeted edits followed by validation. Creation does not install generated presets into other projects or publish packages.

For Codex or another agent that can read local skills, explicitly point it to [skills/preset-creator/SKILL.md](skills/preset-creator/SKILL.md). All scripts, examples, and references live under that skill directory so it can also be installed as a standalone skill.

## Use the helpers directly

Requires Node.js 22.19+; the package has no npm dependencies. From `packages/preset-creator`, scaffold the complete example:

```bash
node skills/preset-creator/scripts/scaffold.mjs preset \
  --spec skills/preset-creator/assets/preset.example.json \
  --out /path/to/new-preset
```

For a custom preset, copy and adapt that JSON spec before generating. A preset requires `name`, `description`, and a non-empty `agents` array. Its optional `skill` supplies a parent skill's `name`, `description`, and `instructions`.

Each agent requires `name`, `description`, and `systemPrompt`. Optional fields are `tools`, `context`, `model`, `thinking`, `cwd`, `skills`, and `extensions`. The scaffold defaults to fresh context and inspection tools, with model selection left to Pi. Its `systemPrompt` becomes the Markdown body. Agent frontmatter and Pi skill frontmatter are separate schemas.

To add one definition, use a single agent object as the spec:

```bash
node skills/preset-creator/scripts/scaffold.mjs agent \
  --spec /path/to/agent-spec.json \
  --out /project/.pi/agents/api-mapper.md
```

Validate a preset directory or one agent file against a kernel checkout with dependencies installed:

```bash
node skills/preset-creator/scripts/check.mjs \
  --path /path/to/new-preset --kernel /path/to/pi-subagents
```

The checker uses the kernel's production discovery parser and Pi's skill loader. For packages, it packs and extracts a tarball and compares loaded agents and skills with the source, catching resources omitted from publication. Package lifecycle scripts are disabled during packing. Checks use a temporary project and do not call a model or edit Pi's global settings. Pi manifests using skill globs should be checked through Pi's full package loader; this helper accepts concrete skill paths.

See [the authoring contract](skills/preset-creator/references/contract.md) for exact supported fields, package installation, context behavior, and parent coordination.

## Develop and test

Install the root repository's development dependencies with `npm ci --ignore-scripts`, then run from the repository root:

```bash
npm run test:preset-creator
```

Alternatively, run `npm test` from `packages/preset-creator`. Tests use the containing kernel checkout by default; set `PI_SUBAGENTS_DIR` to test against a different compatible checkout.

It exercises generation from the packed creator, real discovery, skill loading, scalar round-tripping, single-agent creation, rejection before writing, preservation of existing files, and detection of missing packed resources. These checks establish that the output can load; authors should also test new team handoffs on representative tasks.

This is a local package. No remote or registry release is assumed.

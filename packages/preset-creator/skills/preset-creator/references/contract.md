# pi-subagents v1 authoring contract

This targets the `odjhey/pi-subagents` spawn-kernel fork with Pi 0.85.x. The npm package named `pi-subagents` is upstream and is not this fork.

## Agent definitions

A definition is one Markdown file. Its body is the system prompt. Supported frontmatter fields are exactly:

| Field | Meaning |
|---|---|
| `name` | Exact, case-sensitive name; letters, digits, `.`, `_`, `-`; starts with a letter or digit. Defaults to filename if absent. |
| `description` | Concise discovery description. |
| `tools` | Tool names as a comma-separated list or YAML-style block list. Omission uses Pi defaults. |
| `context` | `fresh` or `fork`; the kernel default is `fresh`. |
| `model` | An explicit Pi model reference, only when needed. Unavailable requests fail. |
| `thinking` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. |
| `cwd` | Working directory override, relative to the parent's invocation directory. |
| `skills` | Explicit Pi-native child skill paths. |
| `extensions` | Explicit Pi-native child extension paths. |

`role`, `workflow`, `dependsOn`, `async`, and other extra frontmatter keys invalidate the definition. In the scaffold JSON, `systemPrompt` supplies the Markdown body; it is not a frontmatter key.

The file parser supports constrained frontmatter, not arbitrary YAML. Use block lists or comma-separated strings for tools/paths; inline JSON/YAML arrays are not supported. The scaffold emits block scalars and lists to preserve descriptions containing quotes or multiple lines. List items cannot contain commas or line breaks with this parser.

Children have fresh context by default. Ambient parent extensions, skills, and repository instructions are not automatically loaded. Pass relevant user/repository instructions explicitly in the child task. Explicit `skills` and `extensions` paths resolve from the child working directory, not from the definition's package directory. Do not assume `./skills/helper` refers to an asset beside the agent file.

Tools such as `bash` can mutate files even when `edit` and `write` are absent. Choose actual tool restrictions and describe behavioral conventions accurately.

## Preset packages

An independent package can contain any useful number of agents and an optional parent skill:

```json
{
  "name": "pi-preset-example",
  "version": "0.1.0",
  "keywords": ["pi-package"],
  "files": ["agents", "skills", "README.md"],
  "pi": { "skills": ["./skills"] },
  "pi-subagents": { "agents": ["./agents"] }
}
```

`pi.subagents.agents` is also a supported declaration. Keep manifest resource paths relative to the package root so packing or moving the package preserves discovery. Register the package with `pi install -l /absolute/path/to/package` in a target project, or use a separately published Git/npm source when one exists. A local package is not automatically published by scaffolding it.

Discovery precedence, low to high: package, user, configured scan directories, project, runtime. Definitions with the same name within the package tier are ambiguous; a project override replaces an entire definition and emits a diagnostic. A parent skill should inspect list diagnostics affecting the names it plans to use.

Keep kernel installation separate: `pi install -l git:github.com/odjhey/pi-subagents@v1.0.0`, or load a development checkout with `pi --no-extensions -e /absolute/path/to/pi-subagents/index.ts`. Do not declare an npm dependency on the upstream package name to obtain the fork.

## Parent skills and handoffs

A Pi skill is a `skills/<name>/SKILL.md` file with `name` and `description` frontmatter. Skill names use lowercase letters, digits, and single hyphens, up to 64 characters. Pi exposes `/skill:<name>`. Its description determines when an agent considers loading it, so scope it to the preset's actual tasks.

List with `{"action":"list"}`. Launch with `{"agent":"exact-name","task":"complete assignment"}` and optional `cwd`, `context`, `model`, `thinking`, or `timeoutMs`. Omit `action` on launch. Timeout is a positive integer no greater than 86,400,000 ms.

One call owns at most one foreground child. Independent calls can overlap, but the parent waits for their results. Children cannot launch other agents through this package. The parent passes useful results to later calls; fresh children cannot read previous conversations merely because a task says “as above.”

The kernel returns `status`, `output`, optional `error`, and reported `usage`. Status is `completed`, `failed`, `timed_out`, or `aborted`; completion describes the session lifecycle. Inspect the result text for actual evidence, failures, and open questions. Output is capped at 64 KiB and error messages at 16 KiB, with `\n[truncated]` included in the cap. Prefer concise handoffs with paths and evidence over large dumps.

Task-specific roles, sequencing guidance, and quality criteria belong in the preset's definitions or parent skill. The spawn kernel provides discovery and lifecycle handling. It does not execute a preset graph, enforce a quality verdict, schedule background work, or provide persistent coordination state.

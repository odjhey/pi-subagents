# Changelog

## [1.0.0] - 2026-09-05

### Breaking changes

- Hard-cut the package to a policy-neutral foreground spawn kernel. The public `subagent` tool now supports only `{ action: "list" }` and an actionless launch of one exact configured agent.
- Removed all prior orchestration, background lifecycle, persistence, management, UI, external-runner, prompt-policy, and compatibility surfaces. Removed inputs fail ordinary schema validation; there is no migration shim.
- Reduced package exports to the root Pi extension and `pi-subagents/agents` runtime registration/types surface.
- Removed bundled agent definitions, prompts, skills, and installer behavior. Every agent must be supplied through package, user, configured scan-directory, project, or runtime discovery.
- Fresh context is now the default; forking must be requested explicitly. Launches return a bounded normalized terminal result and owned children receive no recursive `subagent` registration.
- Provider authentication and registration remain Pi responsibilities. Explicitly unavailable models/providers fail rather than being substituted.

Version `0.65.0` and earlier described a different product and are intentionally not reproduced in the shipped contract after this hard cutover. Consult repository history or release notes for archival information.

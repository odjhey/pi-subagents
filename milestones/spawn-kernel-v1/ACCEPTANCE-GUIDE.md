# Spawn Kernel v1 — hands-on acceptance guide

Use this guide to decide whether the `odjhey/pi-subagents` fork is the product you want, rather than merely whether its automated tests pass.

## What you are deciding

The intended product is deliberately narrow:

1. discover configured agents deterministically;
2. list them without side effects;
3. launch one exact configured agent per tool call as a foreground Pi child;
4. return one bounded result after cleanup.

Several independent calls may overlap when the parent emits parallel tool calls, but the parent model turn waits for all foreground calls. There is no detach, background status, resume, workflow engine, or package-managed fanout.

## Prerequisites

- Pi 0.85.x with a working provider login.
- Git and a shell.
- Node.js 22.19+ and npm for the automated/package gate in section 10.
- Access to `github.com/odjhey/pi-subagents`.

Test the tagged fork, not `npm:pi-subagents` (that npm name is upstream):

```bash
EXT='git:github.com/odjhey/pi-subagents@v1.0.0'
```

You can run every test without permanently installing the extension:

```bash
pi --no-extensions -e "$EXT"
```

## 1. Create an isolated test project

```bash
TEST_ROOT="$(mktemp -d)/pi-subagents-uat"
mkdir -p "$TEST_ROOT/.pi/agents"
cd "$TEST_ROOT"

printf 'alpha marker\n' > alpha.txt
printf 'bravo marker\n' > bravo.txt
printf 'charlie marker\n' > charlie.txt

cat > .pi/agents/probe.md <<'EOF'
---
name: probe
description: Read-only acceptance probe
tools: read, grep, find, ls
context: fresh
thinking: low
---
Follow the supplied task exactly. Be concise. Do not edit files.
EOF
```

Capture a baseline of the project files. The scratch paths in this guide contain no newlines; this pipeline is compatible with stock macOS and propagates failures:

```bash
set -o pipefail
snapshot() {
  find . -type f -not -path './.git/*' -print \
    | LC_ALL=C sort \
    | while IFS= read -r file; do shasum -a 256 "$file"; done
}
snapshot > /tmp/pi-subagents-before.sha256
test -s /tmp/pi-subagents-before.sha256
```

> Your normal user/package agent definitions may also appear in list results. The project `probe` definition must appear regardless.

## 2. Verify list behavior

Start Pi:

```bash
pi --no-extensions -e "$EXT"
```

Ask the parent:

```text
Call the subagent tool exactly once with {"action":"list"}. Show the structured details without launching an agent.
```

### Pass criteria

- `probe` appears with source `project`.
- The response contains `agents` and `diagnostics` arrays.
- No child launch/progress appears.
- Repeating the call returns the same ordering.
- The project snapshot is unchanged:

```bash
snapshot > /tmp/pi-subagents-after-list.sha256
diff -u /tmp/pi-subagents-before.sha256 /tmp/pi-subagents-after-list.sha256
```

Any output from `diff` is a failure to investigate.

## 3. Verify one fresh foreground child

Ask:

```text
Call subagent exactly once with this actionless request:
{"agent":"probe","task":"Read alpha.txt. Return its exact contents, then write SUBAGENT_AVAILABLE=yes or no based only on the tools available inside your child.","context":"fresh","timeoutMs":120000}
Relay the structured result without another tool call.
```

### Pass criteria

- Exactly one `subagent` call occurs.
- Status is `completed`.
- Output contains `alpha marker`.
- Output contains `SUBAGENT_AVAILABLE=no`.
- Usage is present when Pi/provider reports it; missing usage fields are acceptable.
- The parent does not produce its final answer until the child result returns.
- No repository file changes:

```bash
snapshot > /tmp/pi-subagents-after-fresh.sha256
diff -u /tmp/pi-subagents-before.sha256 /tmp/pi-subagents-after-fresh.sha256
```

## 4. Verify exact names and honest failure

Ask for the wrong case:

```text
Call subagent exactly once with {"agent":"Probe","task":"Read alpha.txt"}. Show the structured result.
```

Expected: `failed` with code `agent_not_found`; no child starts.

Then ask for an unavailable explicit model:

```text
Call subagent exactly once with {"agent":"probe","task":"Read alpha.txt","model":"definitely-missing-provider/definitely-missing-model"}. Show the structured result.
```

Expected: bounded `failed`/startup failure. It must not silently choose another model.

## 5. Verify timeout cleanup and recovery

Ask:

```text
Call subagent exactly once with {"agent":"probe","task":"Read all three marker files and explain them","timeoutMs":1}. Show the structured result.
```

Expected: `timed_out` (the tiny deadline may expire during startup).

Immediately follow with a normal call:

```text
Call subagent exactly once with {"agent":"probe","task":"Read bravo.txt and return its exact contents","timeoutMs":120000}.
```

### Pass criteria

- The first call terminates rather than hanging indefinitely.
- The second call completes and returns `bravo marker`.
- The extension is not wedged after cancellation.

This manual recovery probe does **not** prove exact cleanup timing or inspect an internal live-child count. Section 10's production-seam lifecycle tests are the authoritative gate for abort, late startup, shutdown ordering, the shared cleanup deadline, and exactly-once disposal.

## 6. Verify concurrent calls and parent waiting

This checks the exact concurrency contract: **one child per call, multiple calls may overlap, parent turn waits**.

For the clearest trace, exit interactive Pi and run:

```bash
pi --no-extensions -e "$EXT" \
  --no-builtin-tools --tools subagent \
  --mode json -p \
  'In your next assistant message, issue exactly three subagent tool calls at once, using exactly these actionless JSON requests. Omit the action field from every launch request.
{"agent": "probe", "task": "Read alpha.txt and return its exact contents.", "context": "fresh", "timeoutMs": 120000}
{"agent": "probe", "task": "Read bravo.txt and return its exact contents.", "context": "fresh", "timeoutMs": 120000}
{"agent": "probe", "task": "Read charlie.txt and return its exact contents.", "context": "fresh", "timeoutMs": 120000}
After all three results arrive, report the three outputs. Make exactly three tool calls total.' \
  | tee /tmp/pi-subagents-concurrency.jsonl
```

Inspect the trace:

```bash
grep -nE 'subagent|tool_execution_(start|end)' /tmp/pi-subagents-concurrency.jsonl
```

### Pass criteria

- There are exactly three `subagent` calls.
- Pi reports all three tool starts before the first matching tool end.
- Each call owns one child and returns its matching marker.
- The parent final response appears only after all three tool results.
- Pi's UI/process remains responsive and can be interrupted, but the parent model does not continue reasoning while the foreground calls are outstanding.

### Important interpretation

- If starts and ends interleave, inspect validation errors and the assistant's tool-call batches before diagnosing scheduling. Pi can reject invalid calls during preflight even when the parent emits all three together. Launch requests must omit `action`; `action: "list"` is the only supported action value.
- If the parent emits invalid or sequential requests, retry once with the exact prompt above and retain both traces. A run with validation failures followed by successful retries still fails the exactly-three-calls criterion. If three valid calls are emitted together but execution remains sequential, investigate Pi's tool-execution configuration or runtime scheduling.
- If parallel calls overlap: the current kernel supports the desired parent-composed concurrency.
- If you need the parent model to continue while children run, or to detach and return later, this product is **not** sufficient; that would require a background lifecycle product.
- Child startup may be briefly serialized because Pi's in-process extension cache is global. Their task execution can overlap afterward.

## 7. Verify fresh versus explicit fork

Start an ordinary interactive Pi session with persistence enabled (do not use `--no-session`):

```bash
pi --no-extensions -e "$EXT"
```

Tell the parent:

```text
Remember this exact phrase for the current session: UAT-FORK-731. Reply only "acknowledged".
```

Then test fresh context without including the phrase in the child task:

```text
Call subagent once with {"agent":"probe","task":"What exact test phrase was established earlier in the parent conversation? If it is unavailable, say UNKNOWN.","context":"fresh"}.
```

Expected: the child cannot recover the parent phrase and should answer `UNKNOWN`.

Now test explicit fork:

```text
Call subagent once with {"agent":"probe","task":"What exact test phrase was established earlier in the parent conversation?","context":"fork"}.
```

Expected: the child can recover `UAT-FORK-731` from Pi's native forked context. A native branch session file is allowed for this explicit fork.

## 8. Verify strict definition validation

Add an unsupported field:

```bash
cat > .pi/agents/invalid-probe.md <<'EOF'
---
name: invalid-probe
description: Must be rejected
role: reviewer
---
This definition must not load.
EOF
```

Call list again.

### Pass criteria

- `invalid-probe` is absent from the usable agents.
- Diagnostics report `invalid_definition` and the unknown `role` field.
- The extension does not infer a reviewer role or silently ignore the field.

Remove the fixture:

```bash
rm .pi/agents/invalid-probe.md
```

## 9. Optional: verify project scan precedence

Create a lower-priority configured scan directory with another `probe`:

```bash
mkdir -p .pi/scan-agents
cat > .pi/settings.json <<'EOF'
{"subagents":{"agentScanDirs":["./scan-agents"]}}
EOF
cat > .pi/scan-agents/probe.md <<'EOF'
---
name: probe
description: Lower-priority scan probe
---
Return SCAN VERSION.
EOF
```

Call list and then launch `probe`.

Expected:

- diagnostics report that the lower-tier scan definition was replaced;
- the project definition wins;
- the child reads the requested marker rather than returning `SCAN VERSION`.

Clean up:

```bash
rm -rf .pi/scan-agents .pi/settings.json
```

## 10. Run the automated boundary and package gate

Some defining properties are intentionally difficult or expensive to observe through the public tool:

- the exact 64 KiB output and 16 KiB error caps, including Unicode-safe truncation;
- exact cleanup ordering and the single five-second deadline under races;
- absence of fresh child history outside the project directory;
- the exact packaged file whitelist and export importability.

Verify those against the tagged source in a disposable checkout instead of trying to infer them from one model run:

```bash
VERIFY_ROOT="$(mktemp -d)/pi-subagents-v1-proof"
git clone --depth 1 --branch v1.0.0 \
  https://github.com/odjhey/pi-subagents.git "$VERIFY_ROOT"
cd "$VERIFY_ROOT"
npm ci --ignore-scripts
npm run typecheck
npm run test:all
npm pack --dry-run --json > /tmp/pi-subagents-pack.json
node -e '
const fs = require("node:fs");
const packed = JSON.parse(fs.readFileSync("/tmp/pi-subagents-pack.json", "utf8"))[0];
if (packed.entryCount !== 17) throw new Error(`expected 17 files, got ${packed.entryCount}`);
console.log(packed.files.map(file => file.path).join("\n"));
'
```

### Pass criteria

- Typecheck passes.
- 55 unit tests, 10 integration tests, and 3 final-proof tests pass.
- The real Pi lifecycle integration passes.
- The package command reports exactly 17 files.
- The printed package list contains only `README.md`, `CHANGELOG.md`, `LICENSE`, `package.json`, `index.ts`, and the 12 retained `src` files.
- It contains no bundled agent definitions, prompts, skills, docs directory, installer, runner, test fixture, or legacy entrypoint.

The final-proof suite checks the exact list, not only a path-pattern sample, and fails if `npm pack` itself fails.

## Decision scorecard

Mark each row honestly:

| Question | Accept if… | Reject/rethink if… | Your result |
|---|---|---|---|
| Discovery | Agent sources and precedence are predictable | You need aliases, role guessing, or automatic selection | ☐ |
| Launch unit | One exact agent per call is easy to reason about | You need package-owned workflows/fanout | ☐ |
| Concurrency | Parent-composed parallel calls are enough | Parent must continue while children run | ☐ |
| Context | Fresh default plus explicit Pi fork is sufficient | You need automatic pruning or context synthesis | ☐ |
| Lifecycle | Manual recovery works and production-seam lifecycle tests pass | You need detach/status/resume/recovery | ☐ |
| Results | Automated caps plus bounded output/error/usage are enough | You need artifacts, streaming history, or acceptance verdicts | ☐ |
| Policy | Parent-owned planning and judgment is desirable | You want the package to review or enforce work quality | ☐ |
| Integrations | Pi-native children are enough | You need core-managed external CLIs/vendors | ☐ |

## Final acceptance rule

Keep this v1 design if all of these are true:

- exact named-agent configuration is valuable beyond vanilla `createAgentSession`;
- foreground parent waiting is acceptable;
- parallelism composed by multiple parent tool calls is sufficient;
- absence of persistence, workflow, supervision, and policy is a feature.

Reopen product design before adding features if any of these are essential:

- the parent must continue while children run;
- work must survive parent/session exit;
- the package must plan dependencies or aggregate fanout;
- children need steering, resume, durable artifacts, or status queries;
- the package must judge work quality or manage repositories.

Those are not small additions to this kernel; they recreate the platform boundary deliberately removed in v1.

The project snapshots above prove only that list and fresh launch do not mutate the test repository. The automated storage tests prove that fresh children use in-memory session storage; the interactive parent itself may still persist its own normal Pi session.

## Cleanup

```bash
rm -rf "$TEST_ROOT"
rm -f /tmp/pi-subagents-before.sha256 \
      /tmp/pi-subagents-after-list.sha256 \
      /tmp/pi-subagents-after-fresh.sha256 \
      /tmp/pi-subagents-concurrency.jsonl
```

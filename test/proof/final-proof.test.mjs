import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const expectedFiles = [
  "CHANGELOG.md", "LICENSE", "README.md", "index.ts", "package.json",
  "src/agents/configured-runtime-registry.ts", "src/agents/discovery.ts", "src/agents/frontmatter.ts",
  "src/agents/runtime-agent-events.ts", "src/api/agents.ts", "src/extension/discovery-sources.ts",
  "src/extension/index.ts", "src/extension/schemas.ts", "src/runs/foreground/kernel.ts",
  "src/runs/shared/child-session.ts", "src/shared/model-info.ts", "src/shared/utils.ts",
];

function packJson() {
  return JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: root, encoding: "utf8" }))[0];
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(name) : [name];
  });
}

test("invariant 9: package exports are exact and every exported target is importable", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.deepEqual(manifest.exports, { ".": "./index.ts", "./agents": "./src/api/agents.ts" });
  for (const target of Object.values(manifest.exports)) assert.ok(fs.statSync(path.join(root, target)).isFile());
  const script = [
    `const root = ${JSON.stringify(path.join(root, "index.ts"))};`,
    `const agents = ${JSON.stringify(path.join(root, "src/api/agents.ts"))};`,
    "const a = await import(root); const b = await import(agents);",
    "if (typeof a.default !== 'function') throw new Error('root default export missing');",
    "if (Object.keys(a).join() !== 'default') throw new Error('unexpected root export');",
    "if (typeof b.registerAgent !== 'function') throw new Error('agents export missing');",
    "if (Object.keys(b).join() !== 'registerAgent') throw new Error('unexpected agents runtime export');",
  ].join("\n");
  execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "--eval", script], { cwd: root, stdio: "pipe" });
});

test("invariants 8 and 9: npm package is an exact source-only whitelist with no bundled product assets", () => {
  const packed = packJson();
  assert.deepEqual(packed.files.map(file => file.path), expectedFiles);
  assert.deepEqual(packed.bundled, []);
  assert.equal(packed.entryCount, expectedFiles.length);
  for (const file of packed.files) {
    assert.doesNotMatch(file.path, /^(?:agents|prompts|skills|install|docs?|runners?|fixtures)(?:\/|$)/i);
    assert.doesNotMatch(file.path, /async|background|workflow|mission|schedule|worktree|fleet|intercom|herdr|orca|external/i);
  }
});

test("invariants 5, 8, 9, and 10: retained source graph has no removed runtime systems or registrations", () => {
  const files = [...walk(path.join(root, "src")), path.join(root, "index.ts")];
  const forbidden = /\b(?:workflowScript|mission|schedule|worktree|Fleet|intercom|Herdr|Orca|externalCli|externalJob|compatibility)\b/;
  for (const file of files) assert.doesNotMatch(fs.readFileSync(file, "utf8"), forbidden, path.relative(root, file));
  const sourcePaths = files.map(file => path.relative(root, file).replaceAll(path.sep, "/"));
  assert.equal(sourcePaths.some(file => /\/(?:background|missions|workflows|watchdog|integrations|inspectors|intercom|tui|slash)\//.test(`/${file}`)), false);
});

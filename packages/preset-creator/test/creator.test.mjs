import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const kernel = process.env.PI_SUBAGENTS_DIR ? path.resolve(process.env.PI_SUBAGENTS_DIR) : path.resolve(root, "../..");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "preset-creator-test-"));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const [packed] = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", scratch], {
  cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
}));
execFileSync("tar", ["-xzf", path.join(scratch, packed.filename), "-C", scratch]);
const skill = path.join(scratch, "package", "skills", "preset-creator");
const generator = path.join(skill, "scripts", "scaffold.mjs");
const checker = path.join(skill, "scripts", "check.mjs");
const example = JSON.parse(fs.readFileSync(path.join(skill, "assets", "preset.example.json"), "utf8"));
const { discoverConfiguredAgents } = await import(pathToFileURL(path.join(kernel, "src/agents/discovery.ts")));
let counter = 0;

function generate(mode, spec, out) {
  const specFile = path.join(scratch, `spec-${counter++}.json`);
  fs.writeFileSync(specFile, JSON.stringify(spec));
  return spawnSync(process.execPath, [generator, mode, "--spec", specFile, "--out", out], { encoding: "utf8" });
}

function check(target) {
  return spawnSync(process.execPath, [checker, "--path", target, "--kernel", kernel], { encoding: "utf8" });
}

function succeeds(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("packed creator includes its executable helpers, reference, example, and a loadable Pi skill", () => {
  assert.deepEqual(packed.files.map(file => file.path).sort(), [
    "LICENSE", "README.md", "package.json", "skills/preset-creator/SKILL.md",
    "skills/preset-creator/assets/preset.example.json", "skills/preset-creator/references/contract.md",
    "skills/preset-creator/scripts/check.mjs", "skills/preset-creator/scripts/scaffold.mjs",
  ].sort());
  const loaded = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "--eval",
    'import { loadSkills } from "@earendil-works/pi-coding-agent"; console.log(JSON.stringify(loadSkills({cwd: process.argv[1], agentDir: process.argv[1], skillPaths: [process.argv[2]], includeDefaults: false})));',
    scratch, skill,
  ], { cwd: kernel, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  assert.deepEqual(loaded.diagnostics, []);
  assert.deepEqual(loaded.skills.map(item => item.name), ["preset-creator"]);
  assert.equal(loaded.skills[0].disableModelInvocation, false);
});

test("relocated creator generates and validates an independent two-agent preset with parent skill", () => {
  const out = path.join(scratch, "two-agent-preset");
  const spec = structuredClone(example);
  spec.agents.push({ name: "outline-checker", description: "Check the map against repository files.",
    systemPrompt: "Verify the parent's repository map against the actual files and return discrepancies." });
  succeeds(generate("preset", spec, out));
  const result = succeeds(check(out));
  assert.deepEqual(result.agents, ["outline-checker", "outline-mapper"]);
  assert.deepEqual(result.skills, ["repo-outline"]);
  const checkerAgent = discoverConfiguredAgents({ packageDirs: [path.join(out, "agents")] }).agents[0];
  assert.equal(checkerAgent.context, "fresh");
  assert.equal(checkerAgent.model, undefined);
  assert.deepEqual(checkerAgent.tools, ["read", "grep", "find", "ls"]);
});

test("an agents-only preset packs and validates without an invented coordinator", () => {
  const out = path.join(scratch, "agents-only");
  const { skill: unused, ...spec } = example;
  succeeds(generate("preset", spec, out));
  const result = succeeds(check(out));
  assert.deepEqual(result.skills, []);
  assert.equal(fs.existsSync(path.join(out, "skills")), false);
});

test("single-agent fields round-trip through production discovery without YAML quote or newline corruption", () => {
  const out = path.join(scratch, "project", ".pi", "agents", "quoted.md");
  const spec = { name: "quoted", description: 'Quotes " and \' and backslash \\ stay literal.\nSecond: line # stays literal.',
    systemPrompt: "Follow the task.\n\nReturn a concise answer containing the requested evidence.",
    tools: [], context: "fork", thinking: "high", model: "configured-provider/model:low", cwd: "./space dir", skills: [], extensions: [] };
  succeeds(generate("agent", spec, out));
  succeeds(check(out));
  const discovery = discoverConfiguredAgents({ projectDir: path.dirname(out) });
  assert.deepEqual(discovery.diagnostics, []);
  const { filePath, source, ...actual } = discovery.agents[0];
  assert.deepEqual(actual, spec);
});

test("invalid specs fail before creating an output, including duplicate names and unsupported fields", () => {
  const badSpecs = [
    { ...example, agents: [...example.agents, example.agents[0]] },
    { ...example, agents: [{ ...example.agents[0], role: "reviewer" }] },
    { ...example, agents: [{ ...example.agents[0], name: "../escape" }] },
    { ...example, agents: [{ ...example.agents[0], tools: ["read,write"] }] },
    { ...example, skill: { ...example.skill, name: "../escape" } },
  ];
  for (const spec of badSpecs) {
    const out = path.join(scratch, `invalid-${counter}`);
    assert.notEqual(generate("preset", spec, out).status, 0);
    assert.equal(fs.existsSync(out), false);
  }
});

test("existing files, directories, and dangling symlinks are preserved", () => {
  const file = path.join(scratch, "existing.md");
  fs.writeFileSync(file, "existing user work\n");
  assert.notEqual(generate("agent", example.agents[0], file).status, 0);
  assert.equal(fs.readFileSync(file, "utf8"), "existing user work\n");
  const directory = path.join(scratch, "existing-preset");
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, "notes.txt"), "keep me\n");
  assert.notEqual(generate("preset", example, directory).status, 0);
  assert.deepEqual(fs.readdirSync(directory), ["notes.txt"]);
  const link = path.join(scratch, "dangling.md");
  const missing = path.join(scratch, "missing.md");
  fs.symlinkSync(missing, link);
  assert.notEqual(generate("agent", example.agents[0], link).status, 0);
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  assert.equal(fs.existsSync(missing), false);
});

test("checker rejects definitions made invalid by manual edits", () => {
  const file = path.join(scratch, "manually-edited.md");
  succeeds(generate("agent", example.agents[0], file));
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("---\n", "---\nrole: reviewer\n"));
  const result = check(file);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /role/);
});

test("checker catches missing packed skills and machine-specific skill paths", () => {
  const out = path.join(scratch, "missing-resources");
  succeeds(generate("preset", example, out));
  const manifestPath = path.join(out, "package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.files = ["agents", "README.md"];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.notEqual(check(out).status, 0);
  manifest.pi.skills = [path.join(out, "skills")];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const absolute = check(out);
  assert.notEqual(absolute.status, 0);
  assert.match(absolute.stderr, /portable relative paths/);
});

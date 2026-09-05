import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

function options(args) {
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--path", "--kernel"].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--") || result[args[i]]) throw new Error("Expected --path <package-dir|agent.md> --kernel <kernel-dir>");
    result[args[i]] = args[i + 1];
  }
  if (!result["--path"] || !result["--kernel"]) throw new Error("Expected --path <package-dir|agent.md> --kernel <kernel-dir>");
  return result;
}

function agentDirs(manifest, root) {
  const declaration = manifest["pi-subagents"] ?? manifest.pi?.subagents;
  assert.ok(Array.isArray(declaration?.agents) && declaration.agents.length, "Package must declare its agent directories");
  return declaration.agents.map(dir => {
    assert.equal(typeof dir, "string", "Manifest agent paths must be strings");
    assert.ok(dir.trim() && !path.isAbsolute(dir), "Manifest agent paths must be portable relative paths");
    const resolved = path.resolve(root, dir);
    assert.ok(resolved === root || resolved.startsWith(root + path.sep), "Manifest agent paths must stay inside the package");
    return resolved;
  });
}

function definitions(discovered) {
  assert.deepEqual(discovered.diagnostics, [], "Agent discovery diagnostics must be resolved");
  assert.ok(discovered.agents.length, "No usable agents discovered");
  return discovered.agents.map(({ filePath, source, ...definition }) => definition);
}

function skills(root, manifest, kernel, userDir) {
  const paths = manifest.pi?.skills ?? [];
  assert.ok(Array.isArray(paths), "pi.skills must be an array");
  const skillPaths = paths.map(p => {
    assert.ok(typeof p === "string" && p.trim() && !path.isAbsolute(p), "Skill paths must be portable relative paths");
    assert.ok(!/[*!?\[\]{}]/.test(p), "Use concrete skill paths with this checker; validate globs through Pi's package loader");
    const resolved = path.resolve(root, p);
    assert.ok(resolved === root || resolved.startsWith(root + path.sep), "Skill paths must stay inside the package");
    return resolved;
  });
  const opts = { cwd: root, agentDir: userDir, includeDefaults: false, skillPaths };
  const loaded = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "--eval",
    'import { loadSkills } from "@earendil-works/pi-coding-agent"; console.log(JSON.stringify(loadSkills(JSON.parse(process.argv[1]))));', JSON.stringify(opts),
  ], { cwd: kernel, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  assert.deepEqual(loaded.diagnostics, [], "Skill diagnostics must be resolved");
  if (paths.length) assert.ok(loaded.skills.length, "Declared skill paths contain no usable skills");
  return loaded.skills.map(skill => ({ name: skill.name, description: skill.description,
    disableModelInvocation: skill.disableModelInvocation, contents: fs.readFileSync(skill.filePath, "utf8") }));
}

let scratch;
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
try {
  const opts = options(process.argv.slice(2));
  const target = path.resolve(opts["--path"]);
  const kernel = path.resolve(opts["--kernel"]);
  const { discoverConfiguredAgents } = await import(pathToFileURL(path.join(kernel, "src/agents/discovery.ts")));
  const { resolveDiscoverySources } = await import(pathToFileURL(path.join(kernel, "src/extension/discovery-sources.ts")));
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "preset-check-"));
  process.env.PI_CODING_AGENT_DIR = path.join(scratch, "user");
  const project = path.join(scratch, "project");
  fs.mkdirSync(path.join(project, ".pi"), { recursive: true });
  if (fs.statSync(target).isFile()) {
    assert.equal(path.extname(target), ".md", "Agent definition must be a Markdown file");
    const dir = path.join(project, ".pi", "agents");
    fs.mkdirSync(dir);
    fs.copyFileSync(target, path.join(dir, path.basename(target)));
    const agents = definitions(discoverConfiguredAgents(resolveDiscoverySources(project)));
    assert.equal(agents.length, 1);
    console.log(JSON.stringify({ valid: true, kind: "agent", agents: agents.map(agent => agent.name) }));
  } else {
    const manifest = JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8"));
    const sourceAgents = definitions(discoverConfiguredAgents({ packageDirs: agentDirs(manifest, target) }));
    const sourceSkills = skills(target, manifest, kernel, process.env.PI_CODING_AGENT_DIR);
    const [packed] = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", scratch], {
      cwd: target, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    }));
    execFileSync("tar", ["-xzf", path.join(scratch, packed.filename), "-C", scratch]);
    const installed = path.join(scratch, "package");
    const installedManifest = JSON.parse(fs.readFileSync(path.join(installed, "package.json"), "utf8"));
    agentDirs(installedManifest, installed);
    fs.writeFileSync(path.join(project, ".pi", "settings.json"), JSON.stringify({ packages: [installed] }));
    const installedAgents = definitions(discoverConfiguredAgents(resolveDiscoverySources(project)));
    assert.deepEqual(installedAgents, sourceAgents, "Packed agents differ from source definitions");
    const installedSkills = skills(installed, installedManifest, kernel, process.env.PI_CODING_AGENT_DIR);
    assert.deepEqual(installedSkills, sourceSkills, "Packed skills differ from source definitions");
    console.log(JSON.stringify({ valid: true, kind: "preset", packageFiles: packed.entryCount,
      agents: installedAgents.map(agent => agent.name), skills: installedSkills.map(skill => skill.name) }));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
}

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverConfiguredAgents } from "../../src/agents/discovery.ts";
import { resolveDiscoverySources } from "../../src/extension/discovery-sources.ts";

function json(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); }
function definition(dir: string, name: string): void { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `${name}.md`), `---\nname: ${name}\ndescription: ${name}\n---\nprompt\n`); }
function manifest(root: string, name: string, agentDir = "agents"): string { json(path.join(root, "package.json"), { pi: { subagents: { agents: [agentDir] } } }); definition(path.join(root, agentDir), name); return path.resolve(root, agentDir); }
function withEnv(root: string, run: (user: string, project: string) => void): void {
 const user = path.join(root, "home"); const project = path.join(root, "project"); fs.mkdirSync(path.join(project, ".git"), { recursive: true });
 const oldPi = process.env.PI_CODING_AGENT_DIR, oldHome = process.env.HOME; process.env.PI_CODING_AGENT_DIR = user; process.env.HOME = user;
 try { run(user, project); } finally { oldPi === undefined ? delete process.env.PI_CODING_AGENT_DIR : process.env.PI_CODING_AGENT_DIR = oldPi; oldHome === undefined ? delete process.env.HOME : process.env.HOME = oldHome; fs.rmSync(root, { recursive: true, force: true }); }
}

test("resolves every configured package syntax exactly and does not duplicate explicit npm roots", () => withEnv(fs.mkdtempSync(path.join(os.tmpdir(), "sources-")), (user, project) => {
 const config = path.join(project, ".pi");
 const expected = [
  manifest(path.join(user, "npm/node_modules/plain"), "npm-plain"),
  manifest(path.join(user, "npm/node_modules/@scope/pkg"), "npm-scoped"),
  manifest(path.join(user, "local"), "file-relative"),
  manifest(path.join(user, "git/host.test/owner/short"), "git-short"),
  manifest(path.join(user, "git/host.test/owner/https"), "git-https"),
  manifest(path.join(user, "git/host.test/owner/scp"), "git-scp"),
 ];
 json(path.join(user, "settings.json"), { packages: ["npm:plain@1", "npm:@scope/pkg@2", "file:local", "git:host.test/owner/short@main", "git:https://host.test/owner/https.git#dev", "git:git@host.test:owner/scp.git#tag"] });
 const options = resolveDiscoverySources(project);
 assert.deepEqual(options.packageDirs, [...expected].sort());
 assert.deepEqual(discoverConfiguredAgents(options).agents.map(({ name, source }) => ({ name, source })), ["file-relative", "git-https", "git-scp", "git-short", "npm-plain", "npm-scoped"].map(name => ({ name, source: "package" })));
}));

test("expands controlled HOME for scan ~ and file:~ forms", () => withEnv(fs.mkdtempSync(path.join(os.tmpdir(), "home-sources-")), (user, project) => {
 definition(user, "home-scan"); const child = path.join(user, "child"); manifest(child, "home-file-child");
 json(path.join(user, "package.json"), { pi: { subagents: { agents: ["root-agents"] } } }); definition(path.join(user, "root-agents"), "home-file-root");
 json(path.join(user, "settings.json"), { subagents: { agentScanDirs: ["~"] }, packages: ["file:~", "file:~/child"] });
 const options = resolveDiscoverySources(project);
 assert.deepEqual(options.scanDirs, [user]);
 assert.deepEqual(options.packageDirs, [path.join(user, "child", "agents"), path.join(user, "root-agents")].sort());
 assert.deepEqual(discoverConfiguredAgents(options).agents.map(a => [a.name, a.source]), [["home-file-child", "package"], ["home-file-root", "package"], ["home-scan", "scan"]]);
}));

test("rejects unsafe npm/git identities and accepts symlink package roots", () => withEnv(fs.mkdtempSync(path.join(os.tmpdir(), "safe-sources-")), (user, project) => {
 const target = path.join(user, "target"); manifest(target, "linked"); const link = path.join(user, "npm/node_modules/linked"); fs.mkdirSync(path.dirname(link), { recursive: true }); fs.symlinkSync(target, link, "dir");
 json(path.join(user, "settings.json"), { packages: ["npm:linked", "npm:..", "npm:", "npm:/escape", "npm:@scope/..", "git:/owner/repo", "git:host//repo", "git:host/../repo", "git:git@:owner/repo.git"] });
 const options = resolveDiscoverySources(project);
 assert.deepEqual(options.packageDirs, [path.join(link, "agents")]);
 assert.deepEqual(discoverConfiguredAgents(options).agents.map(a => ({ name: a.name, source: a.source })), [{ name: "linked", source: "package" }]);
}));

test("malformed arrays are atomic with exact deterministic diagnostics; missing files are quiet", () => withEnv(fs.mkdtempSync(path.join(os.tmpdir(), "source-errors-")), (user, project) => {
 const config = path.join(project, ".pi"); json(path.join(user, "settings.json"), { packages: ["npm:good", { source: "" }] });
 const bad = path.join(config, "npm/node_modules/bad"); json(path.join(bad, "package.json"), { pi: { subagents: { agents: ["agents", 3] } } });
 json(path.join(config, "settings.json"), { packages: ["npm:bad"] });
 const first = resolveDiscoverySources(project), second = resolveDiscoverySources(project);
 assert.deepEqual(first.packageDirs, []); assert.deepEqual(first.sourceDiagnostics, second.sourceDiagnostics);
 assert.deepEqual(first.sourceDiagnostics, [
  { code: "invalid_definition", source: path.join(user, "settings.json"), message: `Invalid discovery declaration in '${path.join(user, "settings.json")}': expected complete arrays of paths or package sources.` },
  { code: "invalid_definition", source: path.join(bad, "package.json"), message: `Invalid discovery declaration in '${path.join(bad, "package.json")}': expected a complete agents array.` },
 ]);
}));

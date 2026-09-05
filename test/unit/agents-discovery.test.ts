import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverConfiguredAgents, findConfiguredAgent } from "../../src/agents/discovery.ts";

function root(): string { return fs.mkdtempSync(path.join(os.tmpdir(), "spawn-discovery-")); }
function agent(dir: string, file: string, name: string, description = name): void {
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, file), `---\nname: ${name}\ndescription: ${description}\n---\nPrompt for ${name}\n`);
}

test("empty discovery is stable and empty", () => {
	const options = { packageDirs: [path.join(root(), "missing")] };
	assert.deepEqual(discoverConfiguredAgents(options), { agents: [], diagnostics: [] });
	assert.equal(JSON.stringify(discoverConfiguredAgents(options)), JSON.stringify(discoverConfiguredAgents(options)));
});

test("every adjacent source boundary honors precedence, provenance, and scan declaration order", () => {
	const base = root();
	const dirs = ["package", "user", "scan-1", "scan-2", "project"].map((part) => path.join(base, part));
	const boundaries = ["package-user", "user-scan1", "scan1-scan2", "scan2-project", "project-runtime"];
	for (const [index, dir] of dirs.entries()) {
		if (index > 0) agent(dir!, `lower-${index}.md`, boundaries[index - 1]!, `winner-${index}`);
		if (index < boundaries.length) agent(dir!, `upper-${index}.md`, boundaries[index]!, `loser-${index}`);
	}
	const options = {
		packageDirs: [dirs[0]!], userDir: dirs[1], scanDirs: [dirs[2]!, dirs[3]!], projectDir: dirs[4],
		runtime: [{ name: boundaries[4]!, description: "winner-runtime" }],
	};
	const first = discoverConfiguredAgents(options);
	assert.equal(JSON.stringify(first), JSON.stringify(discoverConfiguredAgents(options)));
	assert.deepEqual(boundaries.map((name) => {
		const found = findConfiguredAgent(name, first)!;
		return [found.description, found.source, found.filePath];
	}), [
		["winner-1", "user", path.resolve(dirs[1]!, "lower-1.md")],
		["winner-2", "scan", path.resolve(dirs[2]!, "lower-2.md")],
		["winner-3", "scan", path.resolve(dirs[3]!, "lower-3.md")],
		["winner-4", "project", path.resolve(dirs[4]!, "lower-4.md")],
		["winner-runtime", "runtime", `runtime:${boundaries[4]}`],
	]);
	assert.deepEqual(first.diagnostics.filter((item) => item.code === "definition_replaced").map((item) => item.name), [...boundaries].sort());
});

test("duplicate names within a tier block that name deterministically", () => {
	const base = root();
	const a = path.join(base, "a");
	const b = path.join(base, "b");
	agent(a, "z.md", "duplicate");
	agent(b, "a.md", "duplicate");
	const result = discoverConfiguredAgents({ packageDirs: [b, a] });
	assert.equal(findConfiguredAgent("duplicate", result), undefined);
	assert.deepEqual(result.agents, []);
	assert.equal(result.diagnostics[0]?.code, "duplicate_definition");
	assert.match(result.diagnostics[0]?.message ?? "", /\/a\/z\.md.*\/b\/a\.md/);
});

test("a later valid tier can replace a blocked lower-tier name", () => {
	const base = root();
	const a = path.join(base, "a");
	const b = path.join(base, "b");
	const project = path.join(base, "project");
	agent(a, "one.md", "same");
	agent(b, "two.md", "same");
	agent(project, "same.md", "same", "project");
	const result = discoverConfiguredAgents({ packageDirs: [a, b], projectDir: project });
	assert.equal(findConfiguredAgent("same", result)?.source, "project");
});

test("lookup is exact and minimal definitions reject legacy fields", () => {
	const dir = root();
	agent(dir, "reviewer.md", "reviewer");
	fs.writeFileSync(path.join(dir, "legacy.md"), "---\nname: legacy\ndescription: no\naliases: helper\n---\nprompt\n");
	const result = discoverConfiguredAgents({ userDir: dir });
	assert.equal(findConfiguredAgent("review", result), undefined);
	assert.equal(findConfiguredAgent("helper", result), undefined);
	assert.equal(findConfiguredAgent("reviewer", result)?.name, "reviewer");
	assert.ok(result.diagnostics.some((item) => item.code === "invalid_definition" && item.message.includes("aliases")));
});

test("valid optional values are preserved while malformed values are rejected independently", () => {
	const malformed = [
		["context", "guessed"], ["model", 7], ["tools", ["read", 7]], ["cwd", false], ["thinking", {}],
		["skills", [null]], ["extensions", 12],
	] as const;
	const runtime: unknown[] = [{
		name: "valid", description: "valid", context: "fork", model: "provider/model", cwd: "./child",
		thinking: "high", tools: ["read", "grep"], skills: ["one"], extensions: ["./extension.ts"],
	}];
	for (const [field, value] of malformed) runtime.push({ name: `bad-${field}`, description: "bad", [field]: value });
	const result = discoverConfiguredAgents({ runtime: runtime as never });
	const valid = findConfiguredAgent("valid", result)!;
	assert.deepEqual({ context: valid.context, model: valid.model, cwd: valid.cwd, thinking: valid.thinking, tools: valid.tools, skills: valid.skills, extensions: valid.extensions }, {
		context: "fork", model: "provider/model", cwd: "./child", thinking: "high", tools: ["read", "grep"], skills: ["one"], extensions: ["./extension.ts"],
	});
	for (const [field] of malformed) assert.equal(findConfiguredAgent(`bad-${field}`, result), undefined);
	assert.equal(result.diagnostics.filter((item) => item.code === "invalid_definition").length, malformed.length);
});

test("list validation rejects explicit undefined and sparse members", () => {
	const sparseTools = ["read"];
	sparseTools.length = 2;
	const runtime: unknown[] = [
		{ name: "undefined-tool", description: "bad", tools: ["read", undefined] },
		{ name: "sparse-tool", description: "bad", tools: sparseTools },
	];
	const result = discoverConfiguredAgents({ runtime: runtime as never });
	assert.deepEqual(result.agents, []);
	assert.equal(result.diagnostics.filter((item) => item.code === "invalid_definition").length, 2);
	assert.ok(result.diagnostics.every((item) => item.message.includes("tools[1]")));
});

test("malformed runtime entries and file paths produce stable diagnostics without crashing", () => {
	const runtime: unknown[] = [null, undefined, 4, [], { name: "bad-path", description: "bad", filePath: 9 }, { name: "empty-path", description: "bad", filePath: "" }];
	const first = discoverConfiguredAgents({ runtime: runtime as never });
	assert.equal(JSON.stringify(first), JSON.stringify(discoverConfiguredAgents({ runtime: runtime as never })));
	assert.deepEqual(first.diagnostics.map(({ code, source }) => [code, source]), [
		["invalid_definition", "runtime:0"], ["invalid_definition", "runtime:1"], ["invalid_definition", "runtime:2"],
		["invalid_definition", "runtime:3"], ["invalid_definition", "runtime:4"], ["invalid_definition", "runtime:5"],
	]);
});

test("empty system prompts are optional for files and runtime definitions", () => {
	const dir = root();
	fs.writeFileSync(path.join(dir, "no-prompt.md"), "---\nname: no-prompt\ndescription: valid\n---\n");
	const result = discoverConfiguredAgents({ projectDir: dir, runtime: [{ name: "runtime-no-prompt", description: "valid" }] });
	assert.equal(findConfiguredAgent("no-prompt", result)?.systemPrompt, "");
	assert.equal(findConfiguredAgent("runtime-no-prompt", result)?.systemPrompt, "");
	assert.deepEqual(result.diagnostics, []);
});

test("markdown symlinks include only followed regular files", () => {
	const base = root(); const dir = path.join(base, "agents"); const targets = path.join(base, "targets");
	agent(dir, "regular.md", "regular"); agent(targets, "linked-target.md", "linked");
	fs.symlinkSync(path.join(targets, "linked-target.md"), path.join(dir, "linked.md"));
	fs.symlinkSync(path.join(targets, "missing.md"), path.join(dir, "dangling.md"));
	fs.symlinkSync(targets, path.join(dir, "directory.md"));
	const result = discoverConfiguredAgents({ projectDir: dir });
	assert.deepEqual(result.agents.map((item) => item.name), ["linked", "regular"]);
	assert.deepEqual(result.diagnostics, []);
});

test("mixed diagnostics have stable ordering and filesystem read errors are reported", () => {
	const base = root();
	const notDirectory = path.join(base, "file");
	fs.writeFileSync(notDirectory, "not a directory");
	const duplicateA = path.join(base, "a");
	const duplicateB = path.join(base, "b");
	agent(duplicateA, "same.md", "same");
	agent(duplicateB, "same.md", "same");
	const result = discoverConfiguredAgents({ packageDirs: [duplicateB, duplicateA], userDir: notDirectory, runtime: [null as never] });
	assert.deepEqual(result.diagnostics.map((item) => [item.code, item.source]), [
		["duplicate_definition", "package"],
		["invalid_definition", "runtime:0"],
		["unreadable_directory", notDirectory],
	]);
});

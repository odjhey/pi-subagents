import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";
import {
	BUILTIN_AGENT_NAMES,
	clearAgentDiscoveryCache,
	discoverAgents,
	discoverAgentsAll,
	resolveAgentName,
} from "../../src/agents/agents.ts";
import { resolveEffectiveAcceptance } from "../../src/runs/shared/acceptance.ts";
import { classifyTaskMutationIntent } from "../../src/runs/shared/task-intent.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-role-neutral-"));
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

function writeAgent(filePath: string, name: string): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `---\nname: ${name}\ndescription: ${name} custom agent\n---\nFollow the explicit task.\n`, "utf-8");
}

before(() => {
	process.env.PI_CODING_AGENT_DIR = path.join(root, "pi-home");
	clearAgentDiscoveryCache();
});

after(() => {
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
	clearAgentDiscoveryCache();
	fs.rmSync(root, { recursive: true, force: true });
});

describe("role-neutral distribution", () => {
	it("discovers zero bundled agents in an empty installation", () => {
		const emptyProject = path.join(root, "empty-project");
		fs.mkdirSync(emptyProject, { recursive: true });
		assert.deepEqual(BUILTIN_AGENT_NAMES, []);
		assert.deepEqual(discoverAgents(emptyProject, "both").agents, []);
		assert.deepEqual(discoverAgentsAll(emptyProject).builtin, []);
	});

	it("lists user, project, and package custom agents through existing discovery", () => {
		const project = path.join(root, "composed-project");
		const packageRoot = path.join(root, "agent-package");
		writeAgent(path.join(process.env.PI_CODING_AGENT_DIR!, "agents", "user-choice.md"), "user-choice");
		writeAgent(path.join(project, ".pi", "agents", "project-choice.md"), "project-choice");
		writeAgent(path.join(packageRoot, "agents", "package-choice.md"), "package-choice");
		fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ name: "custom-agent-package", "pi-subagents": { agents: ["./agents"] } }), "utf-8");
		fs.writeFileSync(path.join(project, ".pi", "settings.json"), JSON.stringify({ packages: [packageRoot] }), "utf-8");
		clearAgentDiscoveryCache();

		const discovered = discoverAgents(project, "both").agents;
		assert.equal(discovered.find((agent) => agent.name === "user-choice")?.source, "user");
		assert.equal(discovered.find((agent) => agent.name === "project-choice")?.source, "project");
		assert.equal(discovered.find((agent) => agent.name === "package-choice")?.source, "package");
		for (const name of ["user-choice", "project-choice", "package-choice"]) {
			assert.equal(resolveAgentName(name, discovered).agent?.name, name);
		}
	});

	it("gives historical and arbitrary names identical policy for identical contracts", () => {
		for (const name of ["worker", "reviewer", "oracle", "scout", "anything-at-all"]) {
			assert.equal(classifyTaskMutationIntent(name, "Implement the requested fix").kind, "implementation", name);
			assert.equal(classifyTaskMutationIntent(name, "Review only; do not edit files").kind, "read-only", name);
			const acceptance = resolveEffectiveAcceptance({ agentName: name, task: "Implement the requested fix", async: true });
			assert.equal(acceptance.level, "checked", name);
			assert.equal(acceptance.review, undefined, name);
		}
	});
});

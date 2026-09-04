import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { handleManagementAction } from "../../src/agents/agent-management.ts";
import { clearAgentDiscoveryCache, discoverAgents, discoverAgentsAll } from "../../src/agents/agents.ts";

let root = "";
let previousAgentDir: string | undefined;
const ctx = () => ({ cwd: root, modelRegistry: { getAvailable: () => [] } });

function text(result: { content: Array<{ text?: string }> }): string {
	return result.content.map((part) => part.text ?? "").join("\n");
}

function writeAgent(filePath: string, name: string): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `---\nname: ${name}\ndescription: ${name}\n---\nFollow the task.\n`);
}

describe("custom/package agent management", () => {
	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-management-"));
		previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = path.join(root, "agent-home");
		clearAgentDiscoveryCache();
	});
	afterEach(() => {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		clearAgentDiscoveryCache();
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("ejects a package agent into an editable user definition", () => {
		const packageRoot = path.join(root, "package");
		writeAgent(path.join(packageRoot, "agents", "packaged.md"), "packaged");
		fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ name: "agent-package", "pi-subagents": { agents: ["./agents"] } }));
		fs.mkdirSync(path.join(root, ".pi"), { recursive: true });
		fs.writeFileSync(path.join(root, ".pi", "settings.json"), JSON.stringify({ packages: [packageRoot] }));
		clearAgentDiscoveryCache();
		assert.equal(discoverAgents(root, "both").agents.find((agent) => agent.name === "packaged")?.source, "package");
		const result = handleManagementAction("eject", { agent: "packaged" }, ctx());
		assert.equal(result.isError, false, text(result));
		assert.equal(discoverAgents(root, "both").agents.find((agent) => agent.name === "packaged")?.source, "user");
	});

	it("ejects a package agent into an editable project definition when requested", () => {
		const packageRoot = path.join(root, "project-eject-package");
		writeAgent(path.join(packageRoot, "agents", "project-eject.md"), "project-eject");
		fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ name: "project-eject-package", "pi-subagents": { agents: ["./agents"] } }));
		fs.mkdirSync(path.join(root, ".pi"), { recursive: true });
		fs.writeFileSync(path.join(root, ".pi", "settings.json"), JSON.stringify({ packages: [packageRoot] }));
		clearAgentDiscoveryCache();
		const result = handleManagementAction("eject", { agent: "project-eject", agentScope: "project" }, ctx());
		assert.equal(result.isError, false, text(result));
		assert.equal(discoverAgents(root, "both").agents.find((agent) => agent.name === "project-eject")?.source, "project");
	});

	it("refuses invalid eject scopes and existing custom destinations", () => {
		const packageRoot = path.join(root, "collision-package");
		writeAgent(path.join(packageRoot, "agents", "collision.md"), "collision");
		fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ name: "collision-package", "pi-subagents": { agents: ["./agents"] } }));
		fs.mkdirSync(path.join(root, ".pi"), { recursive: true });
		fs.writeFileSync(path.join(root, ".pi", "settings.json"), JSON.stringify({ packages: [packageRoot] }));
		clearAgentDiscoveryCache();
		assert.equal(handleManagementAction("eject", { agent: "collision", agentScope: "both" }, ctx()).isError, true);
		writeAgent(path.join(process.env.PI_CODING_AGENT_DIR!, "agents", "collision.md"), "collision");
		clearAgentDiscoveryCache();
		assert.equal(handleManagementAction("eject", { agent: "collision" }, ctx()).isError, true);
	});

	it("disables and enables an actually configured custom agent", () => {
		writeAgent(path.join(process.env.PI_CODING_AGENT_DIR!, "agents", "custom.md"), "custom");
		clearAgentDiscoveryCache();
		assert.ok(discoverAgents(root, "both").agents.some((agent) => agent.name === "custom"));
		assert.equal(handleManagementAction("disable", { agent: "custom" }, ctx()).isError, false);
		assert.equal(discoverAgents(root, "both").agents.some((agent) => agent.name === "custom"), false);
		assert.equal(discoverAgentsAll(root).user.find((agent) => agent.name === "custom")?.disabled, true);
		assert.equal(handleManagementAction("enable", { agent: "custom" }, ctx()).isError, false);
		assert.ok(discoverAgents(root, "both").agents.some((agent) => agent.name === "custom"));
	});

	it("preserves unrelated custom overrides while disabling and enabling", () => {
		const settingsPath = path.join(process.env.PI_CODING_AGENT_DIR!, "settings.json");
		writeAgent(path.join(process.env.PI_CODING_AGENT_DIR!, "agents", "configured.md"), "configured");
		fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
		fs.writeFileSync(settingsPath, JSON.stringify({ subagents: { agentOverrides: { configured: { model: "provider/model" } } } }));
		clearAgentDiscoveryCache();
		assert.equal(handleManagementAction("disable", { agent: "configured" }, ctx()).isError, false);
		let settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
		assert.deepEqual(settings.subagents.agentOverrides.configured, { model: "provider/model", disabled: true });
		assert.equal(handleManagementAction("enable", { agent: "configured" }, ctx()).isError, false);
		settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
		assert.deepEqual(settings.subagents.agentOverrides.configured, { model: "provider/model" });
	});

	it("disables a package agent through a user settings override", () => {
		const packageRoot = path.join(root, "disable-package");
		writeAgent(path.join(packageRoot, "agents", "package-choice.md"), "package-choice");
		fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ name: "disable-package", "pi-subagents": { agents: ["./agents"] } }));
		fs.mkdirSync(path.join(root, ".pi"), { recursive: true });
		fs.writeFileSync(path.join(root, ".pi", "settings.json"), JSON.stringify({ packages: [packageRoot] }));
		clearAgentDiscoveryCache();
		assert.equal(handleManagementAction("disable", { agent: "package-choice" }, ctx()).isError, false);
		assert.equal(discoverAgents(root, "both").agents.some((agent) => agent.name === "package-choice"), false);
		const configured = discoverAgentsAll(root).package.find((agent) => agent.name === "package-choice");
		assert.equal(configured?.disabled, true);
		assert.equal(configured?.override?.scope, "user");
	});

	it("reports the disabling scope when enable targets the wrong scope", () => {
		writeAgent(path.join(root, ".pi", "agents", "project-choice.md"), "project-choice");
		clearAgentDiscoveryCache();
		assert.equal(handleManagementAction("disable", { agent: "project-choice", agentScope: "project" }, ctx()).isError, false);
		const result = handleManagementAction("enable", { agent: "project-choice", agentScope: "user" }, ctx());
		assert.equal(result.isError, true);
		assert.match(text(result), /still disabled via a project scope override/);
	});

	it("fails clearly for management of an absent identity", () => {
		for (const action of ["eject", "disable", "enable", "reset"]) {
			const result = handleManagementAction(action, { agent: "absent" }, ctx());
			assert.equal(result.isError, true, action);
			assert.match(text(result), /not found/i);
		}
	});
});

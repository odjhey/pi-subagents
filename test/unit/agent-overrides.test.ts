import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { clearAgentDiscoveryCache, discoverAgents, discoverAgentsAll } from "../../src/agents/agents.ts";

let root = "";
let previousAgentDir: string | undefined;

function writeJson(filePath: string, value: unknown): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function writeAgent(filePath: string, name: string): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `---\nname: ${name}\ndescription: Custom ${name}\n---\nFollow the task.\n`);
}

describe("custom agent overrides", () => {
	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-overrides-"));
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

	it("keeps the builtin inventory empty", () => {
		assert.deepEqual(discoverAgentsAll(root).builtin, []);
	});

	it("applies global defaults and explicit overrides to supplied custom agents", () => {
		writeAgent(path.join(root, ".pi", "agents", "configured-agent.md"), "configured-agent");
		writeJson(path.join(root, ".pi", "settings.json"), {
			subagents: {
				defaultModel: "provider/default",
				agentOverrides: {
					"configured-agent": {
						model: "provider/specific",
						acceptanceRole: "writer",
						inheritProjectContext: true,
						tools: ["read", "write"],
					},
				},
			},
		});
		clearAgentDiscoveryCache();
		const agent = discoverAgents(root, "both").agents.find((candidate) => candidate.name === "configured-agent");
		assert.ok(agent);
		assert.equal(agent.source, "project");
		assert.equal(agent.model, "provider/specific");
		assert.equal(agent.acceptanceRole, "writer");
		assert.equal(agent.inheritProjectContext, true);
		assert.deepEqual(agent.tools, ["read", "write"]);
	});

	it("applies role-neutral model, provider, thinking, and extension defaults to custom agents", () => {
		writeAgent(path.join(root, ".pi", "agents", "defaulted.md"), "defaulted");
		writeJson(path.join(root, ".pi", "settings.json"), { subagents: {
			defaultModel: "model-id",
			defaultProvider: "provider-id",
			defaultThinking: "medium",
			defaultExtensions: ["./shared.ts"],
		} });
		clearAgentDiscoveryCache();
		const agent = discoverAgents(root, "both").agents.find((candidate) => candidate.name === "defaulted");
		assert.equal(agent?.model, "model-id");
		assert.equal(agent?.modelProvider, "provider-id");
		assert.equal(agent?.thinking, "medium");
		assert.deepEqual(agent?.extensions, ["./shared.ts"]);
	});

	it("does not create an agent from an override aimed at an absent name", () => {
		writeJson(path.join(root, ".pi", "settings.json"), { subagents: { agentOverrides: { worker: { model: "provider/model" } } } });
		clearAgentDiscoveryCache();
		assert.deepEqual(discoverAgents(root, "both").agents, []);
	});

	it("uses role-neutral defaults for arbitrary and historical custom names", () => {
		for (const name of ["worker", "anything"]) writeAgent(path.join(root, ".pi", "agents", `${name}.md`), name);
		clearAgentDiscoveryCache();
		const agents = discoverAgents(root, "both").agents;
		for (const name of ["worker", "anything"]) {
			const agent = agents.find((candidate) => candidate.name === name);
			assert.equal(agent?.systemPromptMode, "replace");
			assert.equal(agent?.inheritProjectContext, false);
		}
	});

	it("layers project overrides over user overrides without dropping unrelated custom fields", () => {
		const agentDir = process.env.PI_CODING_AGENT_DIR!;
		writeAgent(path.join(agentDir, "agents", "layered.md"), "layered");
		writeJson(path.join(agentDir, "settings.json"), {
			subagents: { agentOverrides: { layered: {
				model: "provider/user-model",
				thinking: "high",
				fallbackModels: ["provider/fallback"],
				output: "user.md",
				defaultReads: ["USER.md"],
			} } },
		});
		writeJson(path.join(root, ".pi", "settings.json"), {
			subagents: { agentOverrides: { layered: {
				output: "project.md",
				defaultReads: ["PROJECT.md"],
				subagentOnlyExtensions: ["./child-only.ts"],
			} } },
		});
		clearAgentDiscoveryCache();

		const agent = discoverAgents(root, "both").agents.find((candidate) => candidate.name === "layered");
		assert.equal(agent?.model, "provider/user-model");
		assert.equal(agent?.thinking, "high");
		assert.deepEqual(agent?.fallbackModels, ["provider/fallback"]);
		assert.equal(agent?.output, "project.md");
		assert.deepEqual(agent?.defaultReads, ["PROJECT.md"]);
		assert.deepEqual(agent?.subagentOnlyExtensions, ["./child-only.ts"]);
		assert.equal(agent?.override?.scope, "project");
	});

	it("layers active-provider overrides over ordinary overrides for a custom agent", () => {
		writeAgent(path.join(root, ".pi", "agents", "provider-aware.md"), "provider-aware");
		writeJson(path.join(root, ".pi", "settings.json"), {
			subagents: {
				agentOverrides: { "provider-aware": { model: "base/model", thinking: "low" } },
				agentOverridesByProvider: {
					alpha: { "provider-aware": { model: "alpha/model", thinking: "high" } },
					beta: { "provider-aware": { model: "beta/model" } },
				},
			},
		});
		clearAgentDiscoveryCache();
		const resolve = (provider?: string) => discoverAgents(root, "both", provider).agents.find((agent) => agent.name === "provider-aware");
		assert.deepEqual([resolve()?.model, resolve()?.thinking], ["base/model", "low"]);
		assert.deepEqual([resolve("alpha")?.model, resolve("alpha")?.thinking], ["alpha/model", "high"]);
		assert.deepEqual([resolve("beta")?.model, resolve("beta")?.thinking], ["beta/model", "low"]);
	});

	it("supports explicit false clears and empty values for custom frontmatter fields", () => {
		const filePath = path.join(root, ".pi", "agents", "clearable.md");
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, `---\nname: clearable\ndescription: Clearable\nmodel: provider/model\nthinking: high\noutput: report.md\ndefaultReads: CONTEXT.md\nextensions: ./ambient.ts\nacceptanceRole: writer\n---\nFollow the task.\n`);
		writeJson(path.join(root, ".pi", "settings.json"), {
			subagents: { agentOverrides: { clearable: {
				model: false,
				thinking: false,
				output: false,
				defaultReads: [],
				extensions: false,
				acceptanceRole: false,
			} } },
		});
		clearAgentDiscoveryCache();
		const agent = discoverAgents(root, "both").agents.find((candidate) => candidate.name === "clearable");
		assert.equal(agent?.model, undefined);
		assert.equal(agent?.thinking, undefined);
		assert.equal(agent?.output, undefined);
		assert.deepEqual(agent?.defaultReads, []);
		assert.equal(agent?.extensions, undefined);
		assert.equal(agent?.acceptanceRole, undefined);
	});

	it("applies full override fields to project and package agents", () => {
		const packageRoot = path.join(root, "custom-package");
		writeAgent(path.join(packageRoot, "agents", "package-agent.md"), "package-agent");
		writeAgent(path.join(root, ".pi", "agents", "project-agent.md"), "project-agent");
		writeJson(path.join(packageRoot, "package.json"), { name: "custom-package", "pi-subagents": { agents: ["agents"] } });
		writeJson(path.join(root, ".pi", "settings.json"), {
			packages: [packageRoot],
			subagents: { agentOverrides: {
				"project-agent": {
					output: "project-report.md",
					defaultReads: ["PROJECT.md"],
					thinking: "medium",
					extensions: ["./project-extension.ts"],
				},
				"package-agent": { output: "package-report.md", defaultReads: ["PACKAGE.md"] },
			} },
		});
		clearAgentDiscoveryCache();
		const agents = discoverAgents(root, "both").agents;
		const project = agents.find((agent) => agent.name === "project-agent");
		const packaged = agents.find((agent) => agent.name === "package-agent");
		assert.deepEqual([project?.output, project?.defaultReads, project?.thinking, project?.extensions], ["project-report.md", ["PROJECT.md"], "medium", ["./project-extension.ts"]]);
		assert.equal(packaged?.source, "package");
		assert.deepEqual([packaged?.output, packaged?.defaultReads], ["package-report.md", ["PACKAGE.md"]]);
	});

	it("respects discovery scope for settings precedence", () => {
		const agentDir = process.env.PI_CODING_AGENT_DIR!;
		writeAgent(path.join(agentDir, "agents", "scoped.md"), "scoped");
		writeAgent(path.join(root, ".pi", "agents", "project-only.md"), "project-only");
		writeJson(path.join(agentDir, "settings.json"), { subagents: { agentOverrides: { scoped: { model: "user/model" } } } });
		writeJson(path.join(root, ".pi", "settings.json"), { subagents: { agentOverrides: { scoped: { model: "project/model" }, "project-only": { model: "project/only" } } } });
		clearAgentDiscoveryCache();
		assert.equal(discoverAgents(root, "user").agents.find((agent) => agent.name === "scoped")?.model, "user/model");
		assert.equal(discoverAgents(root, "project").agents.find((agent) => agent.name === "project-only")?.model, "project/only");
		assert.equal(discoverAgents(root, "project").agents.some((agent) => agent.name === "scoped"), false);
	});

	it("fails closed for malformed global default values", () => {
		const settingsPath = path.join(process.env.PI_CODING_AGENT_DIR!, "settings.json");
		for (const [field, value] of [["defaultModel", ""], ["defaultProvider", 42], ["defaultThinking", ""], ["disableThinking", "yes"]] as const) {
			writeJson(settingsPath, { subagents: { [field]: value } });
			clearAgentDiscoveryCache();
			assert.throws(() => discoverAgents(root, "both"), new RegExp(field));
		}
	});

	it("fails closed for malformed settings files and override values", () => {
		const settingsPath = path.join(process.env.PI_CODING_AGENT_DIR!, "settings.json");
		writeAgent(path.join(process.env.PI_CODING_AGENT_DIR!, "agents", "invalid-config.md"), "invalid-config");
		fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
		fs.writeFileSync(settingsPath, '{"subagents":');
		assert.throws(() => discoverAgents(root, "both"), /Failed to parse settings file/);

		writeJson(settingsPath, { subagents: { agentOverrides: { "invalid-config": { output: 42 } } } });
		clearAgentDiscoveryCache();
		assert.throws(() => discoverAgents(root, "both"), /invalid-config.*output|output.*invalid-config/);
	});
});

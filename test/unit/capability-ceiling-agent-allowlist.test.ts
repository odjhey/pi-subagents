import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { handleList } from "../../src/agents/agent-management.ts";
import type { AgentConfig } from "../../src/agents/agents.ts";
import { resolveSubagentLaunchContract } from "../../src/api/preflight.ts";
import {
	decodeSubagentCapabilityCeiling,
	encodeSubagentCapabilityCeiling,
	intersectSubagentCapabilityCeilings,
	parseSubagentCapabilityCeiling,
	registerSubagentCapabilityCeiling,
} from "../../src/api/capability-ceiling.ts";
import { runSync } from "../../src/runs/foreground/execution.ts";
import { buildInProcessChildLaunch } from "../../src/runs/shared/child-launch.ts";

function agent(name: string): AgentConfig {
	return {
		name,
		description: `${name} agent`,
		systemPrompt: `${name} prompt`,
		systemPromptMode: "replace",
		inheritProjectContext: false,
		inheritSkills: false,
		source: "project",
		filePath: `/tmp/${name}.md`,
	};
}

describe("capability ceiling agent allowlist", () => {
	it("parses, round-trips, and intersects allowedAgents", () => {
		const parsed = parseSubagentCapabilityCeiling({ version: 1, allowedAgents: ["worker", "reviewer", "worker"], denyExtensions: false, sources: ["plan"] });
		assert.deepEqual(parsed.allowedAgents, ["reviewer", "worker"]);
		assert.deepEqual(decodeSubagentCapabilityCeiling(encodeSubagentCapabilityCeiling(parsed)), parsed);

		assert.deepEqual(intersectSubagentCapabilityCeilings(
			{ version: 1, allowedAgents: ["worker", "reviewer"], denyExtensions: false, sources: ["outer"] },
			{ version: 1, allowedAgents: ["reviewer", "scout"], denyExtensions: true, sources: ["inner"] },
		), {
			version: 1,
			allowedAgents: ["reviewer"],
			denyExtensions: true,
			sources: ["inner", "outer"],
		});

		assert.deepEqual(intersectSubagentCapabilityCeilings(
			{ version: 1, allowedTools: ["read"], denyExtensions: false, sources: ["tools-only"] },
			{ version: 1, allowedAgents: [], denyExtensions: false, sources: ["none"] },
		)?.allowedAgents, []);
	});

	it("marks configured non-allowlisted agents as restricted in list output", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-allowlist-list-"));
		const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = path.join(cwd, "agent-home");
		try {
			for (const name of ["allowed-agent", "restricted-agent"]) {
				const filePath = path.join(cwd, ".pi", "agents", `${name}.md`);
				fs.mkdirSync(path.dirname(filePath), { recursive: true });
				fs.writeFileSync(filePath, `---\nname: ${name}\ndescription: ${name}\n---\nFollow the task.\n`);
			}
			const sessionId = `allowlist-list-${Date.now()}-${Math.random()}`;
			const handle = registerSubagentCapabilityCeiling({ sessionId, source: "plan-mode", ceiling: { allowedAgents: ["allowed-agent"] } });
			try {
				const text = handleList({}, { cwd, currentSessionId: sessionId, modelRegistry: { getAvailable: () => [] } }).content[0]?.text ?? "";
				assert.match(text, /Executable agents:[\s\S]*- allowed-agent /);
				assert.match(text, /Restricted agents[\s\S]*- restricted-agent /);
			} finally { handle.dispose(); }
		} finally {
			if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
			fs.rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("rejects a configured non-allowlisted agent in preflight", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-allowlist-preflight-"));
		try {
			const filePath = path.join(cwd, ".pi", "agents", "configured-agent.md");
			fs.mkdirSync(path.dirname(filePath), { recursive: true });
			fs.writeFileSync(filePath, "---\nname: configured-agent\ndescription: Configured\n---\nFollow the task.\n");
			const result = await resolveSubagentLaunchContract({
				agent: "configured-agent", cwd,
				capabilityCeiling: { version: 1, allowedAgents: ["other-agent"], denyExtensions: false, sources: ["plan-mode"] },
			});
			assert.equal(result.ok, false);
			assert.equal(result.code, "restricted_agent");
			assert.match(result.message, /does not allow agent 'configured-agent'/);
		} finally { fs.rmSync(cwd, { recursive: true, force: true }); }
	});

	it("rejects a non-allowlisted foreground launch before spawning", async () => {
		const result = await runSync(process.cwd(), [agent("worker"), agent("reviewer")], "worker", "Do work", {
			capabilityCeiling: { version: 1, allowedAgents: ["reviewer"], denyExtensions: false, sources: ["plan-mode"] },
		});
		assert.equal(result.exitCode, 1);
		assert.match(result.error ?? "", /does not allow agent 'worker'/);
		assert.deepEqual(result.capabilityCeiling?.allowedAgents, ["reviewer"]);
	});

	it("includes allowedAgents in the child runtime config and audit metadata", () => {
		const { config, capabilityAudit } = buildInProcessChildLaunch({
			host: "parent",
			cwd: process.cwd(),
			sessionEnabled: false,
			inheritProjectContext: false,
			inheritGlobalContext: false,
			inheritSkills: false,
			childAgentName: "reviewer",
			childIndex: 0,
			capabilityCeiling: { version: 1, allowedAgents: ["reviewer"], allowedTools: ["read"], denyExtensions: true, sources: ["plan-mode"] },
		});
		assert.equal(capabilityAudit?.agentAllowed, true);
		assert.deepEqual(capabilityAudit?.agentRestrictionSources, ["plan-mode"]);
		assert.deepEqual(config.capabilityCeiling?.allowedAgents, ["reviewer"]);
	});
});

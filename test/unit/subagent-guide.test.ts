import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readSubagentGuide, SUBAGENT_GUIDE_TOPICS } from "../../src/extension/subagent-guide.ts";
import { SUBAGENT_ACTIONS } from "../../src/shared/types.ts";

describe("subagent guide", () => {
	it("reads the role-neutral packaged overview", () => {
		const guide = readSubagentGuide();
		assert.match(guide, /# pi-subagents/);
		assert.match(guide, /ships \*\*zero agent profiles/i);
		assert.match(guide, /Agent names are identifiers/i);
	});

	it("lists valid topics for an unknown topic without changing files", () => {
		const guide = readSubagentGuide("unknown");
		assert.match(guide, /Unknown subagents guide topic 'unknown'/);
		assert.match(guide, /No files were changed\./);
		assert.match(guide, new RegExp(SUBAGENT_GUIDE_TOPICS.join(", ")));
	});

	it("registers guide action and documents explicit authoring and workflows", () => {
		assert.ok(SUBAGENT_ACTIONS.includes("guide"));
		assert.match(readSubagentGuide("agents"), /pi-subagents ships no agent definitions/i);
		assert.match(readSubagentGuide("agents"), /Runtime registration/);
		assert.match(readSubagentGuide("workflows"), /Sequential[\s\S]*Parallel/);
		assert.match(readSubagentGuide("workflows"), /never substitutes an agent identity/i);
		assert.match(readSubagentGuide("tool-reference"), /does not inspect the agent name/i);
	});
});

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import {
	buildSubagentToolDescription,
	buildSubagentToolPromptMetadata,
	COMPACT_SUBAGENT_TOOL_DESCRIPTION,
	DEFAULT_SUBAGENT_TOOL_DESCRIPTION,
	FULL_SUBAGENT_TOOL_DESCRIPTION,
	SUBAGENT_SAFETY_GUIDANCE,
} from "../../src/extension/tool-description.ts";

describe("registered subagent tool description", () => {
	it("uses role-neutral split metadata by default", () => {
		const description = buildSubagentToolDescription();
		const metadata = buildSubagentToolPromptMetadata();
		assert.equal(description, DEFAULT_SUBAGENT_TOOL_DESCRIPTION);
		assert.match(description, /ships no agent profiles/i);
		assert.match(description, /Agent behavior comes only from explicit configuration/i);
		assert.match(metadata.promptSnippet ?? "", /explicitly configured child agents/i);
		assert.match(metadata.promptGuidelines?.join("\n") ?? "", /Agent names are identifiers only/i);
		assert.doesNotMatch(`${description}\n${metadata.promptGuidelines?.join("\n")}`, /agent:\s*["'](?:worker|reviewer|scout|oracle|delegate)["']/i);
	});

	it("keeps full and compact descriptions role-neutral", () => {
		const full = buildSubagentToolDescription({ toolDescriptionMode: "full" });
		const compact = buildSubagentToolDescription({ toolDescriptionMode: "compact" });
		assert.equal(full, FULL_SUBAGENT_TOOL_DESCRIPTION);
		assert.equal(compact, COMPACT_SUBAGENT_TOOL_DESCRIPTION);
		for (const description of [full, compact]) {
			assert.match(description, /no (?:default agents|agent profiles are bundled)/i);
			assert.match(description, /Agent names/i);
			assert.match(description, /SAFETY-CRITICAL SUBAGENT GUIDANCE/);
			assert.doesNotMatch(description, /agent:\s*["'](?:worker|reviewer|scout|oracle|delegate)["']/i);
		}
		assert.ok(compact.length < full.length);
	});

	it("renders custom templates and appends mandatory safety guidance last", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-tool-desc-"));
		const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-agent-dir-"));
		try {
			fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
			fs.writeFileSync(path.join(cwd, ".pi", "subagent-tool-description.md"), "Custom for {{agentDir}}.\n\n{{safetyGuidance}}\n\nCustom tail.");
			const description = buildSubagentToolDescription({ toolDescriptionMode: "custom" }, { cwd, agentDir });
			assert.match(description, /Custom for/);
			assert.match(description, new RegExp(agentDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
			assert.equal(description.split(SUBAGENT_SAFETY_GUIDANCE).length - 1, 1);
			assert.ok(description.endsWith(SUBAGENT_SAFETY_GUIDANCE));
		} finally {
			fs.rmSync(cwd, { recursive: true, force: true });
			fs.rmSync(agentDir, { recursive: true, force: true });
		}
	});

	it("falls back to full mode for an invalid description mode", () => {
		const warnings: string[] = [];
		const description = buildSubagentToolDescription({ toolDescriptionMode: "invalid" } as never, { warn: (warning) => warnings.push(warning) });
		assert.equal(description, FULL_SUBAGENT_TOOL_DESCRIPTION);
		assert.match(warnings.join("\n"), /Ignoring invalid toolDescriptionMode/);
	});

	it("falls back to full mode for a missing custom description", () => {
		const warnings: string[] = [];
		const description = buildSubagentToolDescription({ toolDescriptionMode: "custom" }, {
			cwd: fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-tool-desc-missing-")),
			agentDir: fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-agent-dir-missing-")),
			warn: (warning) => warnings.push(warning),
		});
		assert.equal(description, FULL_SUBAGENT_TOOL_DESCRIPTION);
		assert.equal(warnings.length, 1);
	});
});

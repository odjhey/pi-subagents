import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionConfig, ToolDescriptionMode } from "../shared/types.ts";
import { getAgentDir, getProjectConfigDir } from "../shared/utils.ts";

const CUSTOM_TOOL_DESCRIPTION_FILE = "subagent-tool-description.md";
const CUSTOM_TOOL_DESCRIPTION_MAX_BYTES = 50 * 1024;
const AGENT_SELECTION_GUIDANCE = "Before execution, call { action: \"list\", capabilities: true } and select an executable, non-disabled configured agent. An empty list means no agent is installed; add a user, project, package, or runtime agent before launching.";
const WORKFLOW_GUIDANCE = "Use stable unique keys with runs.run and runs.all. runs.all returns an ordered array. Await every child promise. Workflow scripts cannot access the filesystem, shell, Pi tools, or host globals directly.";
const WORKFLOW_RESOURCE_GUIDANCE = "Named resources are extension-owned. run-ci accepts a bounded command. review requires both args.agent and args.task; it never chooses an agent implicitly.";

export const SUBAGENT_TOOL_PROMPT_SNIPPET = "Delegate to explicitly configured child agents.";

export const SUBAGENT_TOOL_PROMPT_GUIDELINES = [
	`Use subagent only when delegation is requested or useful. ${AGENT_SELECTION_GUIDANCE}`,
	'Omit action for execution. Use { agent, task? } for one child or one { workflowScript, async: true } call for orchestration. Use action only for management and control.',
	"Agent names are identifiers only. Capabilities, context, tools, acceptance, and task intent come from explicit configuration and request fields.",
	"Keep concurrent mutation isolated by cwd or managed worktree, and return explicit outputs and validation evidence.",
];

export const SUBAGENT_SAFETY_GUIDANCE = `SAFETY-CRITICAL SUBAGENT GUIDANCE:
• ${AGENT_SELECTION_GUIDANCE}
• Agent names and aliases do not imply permissions, context, acceptance policy, or task intent.
• Omit action for execution and use action only for management/control.
• Async work remains visible through status and artifacts. Consume results before dependent work.
• Ordinary children cannot launch descendants unless nested delegation is explicitly configured and within limits.
• Isolate concurrent file mutation by cwd or managed worktree.
• Configure acceptance and any independent review agent explicitly; no agent identity is synthesized.`;

export const DEFAULT_SUBAGENT_TOOL_DESCRIPTION = `Delegate to configured subagents. This package ships no agent profiles. Use {agent, task?} for one child, workflowScript or workflowScriptPath for orchestration, or an extension-owned named workflow resource. ${AGENT_SELECTION_GUIDANCE} ${WORKFLOW_GUIDANCE} ${WORKFLOW_RESOURCE_GUIDANCE} Agent behavior comes only from explicit configuration and task/request fields. Use action only for management and control; use {action:"guide", topic:"agents"} for custom-agent authoring.`;

export const FULL_SUBAGENT_TOOL_DESCRIPTION = `Run explicitly configured child agents. This package includes the delegation engine but no default agents, prompts, or orchestration skills.

EXECUTION:
• ${AGENT_SELECTION_GUIDANCE}
• Single child: {agent:"analysis-agent", task:"Analyze the request without editing files"}.
• Workflow: {workflowScript:"const a=await runs.run('a',{agent:'analysis-agent',task:'Analyze'}); return (await runs.run('b',{agent:'change-agent',task:'Apply this explicit plan: '+a.output})).output"}.
• Parallel: await runs.all([{key:"a",agent:"configured-a",task:"Check A"},{key:"b",agent:"configured-b",task:"Check B"}]).
• ${WORKFLOW_GUIDANCE}
• ${WORKFLOW_RESOURCE_GUIDANCE}
• context, model, tools, worktree, budgets, acceptance, and output settings are explicit request/config contracts. A name never supplies them.
• External CLI adapter behavior is selected by runner.adapter in an agent definition; it is not inferred from the agent name.

MANAGEMENT / CONTROL:
• list/get/models/doctor inspect configured agents. create/update/delete manage custom definitions. Status, supervision, missions, schedules, worktrees, refinements, and observability remain available.
• action=refine requires both agent and proposalAgent so refinement cannot select another agent implicitly.

${SUBAGENT_SAFETY_GUIDANCE}`;

export const COMPACT_SUBAGENT_TOOL_DESCRIPTION = `Run configured children with {agent,task?} or orchestrate them with workflowScript/workflowScriptPath. No agent profiles are bundled. ${AGENT_SELECTION_GUIDANCE} ${WORKFLOW_GUIDANCE} Agent names carry no behavioral meaning. Configure context, tools, acceptance, and any follow-up agent explicitly. ${SUBAGENT_SAFETY_GUIDANCE}`;

function isToolDescriptionMode(value: unknown): value is ToolDescriptionMode {
	return value === "full" || value === "compact" || value === "custom";
}

function warn(options: ToolDescriptionOptions | undefined, message: string): void {
	(options?.warn ?? console.warn)(`[pi-subagents] ${message}`);
}

export interface ToolDescriptionOptions {
	cwd?: string;
	agentDir?: string;
	warn?: (message: string) => void;
}

export interface SubagentToolPromptMetadata {
	promptSnippet?: string;
	promptGuidelines?: string[];
}

export function buildSubagentToolPromptMetadata(config: Pick<ExtensionConfig, "toolDescriptionMode"> = {}): SubagentToolPromptMetadata {
	if (config.toolDescriptionMode !== undefined) return {};
	return {
		promptSnippet: SUBAGENT_TOOL_PROMPT_SNIPPET,
		promptGuidelines: SUBAGENT_TOOL_PROMPT_GUIDELINES,
	};
}

export function resolveToolDescriptionMode(config: Pick<ExtensionConfig, "toolDescriptionMode">, options?: ToolDescriptionOptions): ToolDescriptionMode {
	const mode = config.toolDescriptionMode;
	if (mode === undefined) return "full";
	if (isToolDescriptionMode(mode)) return mode;
	warn(options, `Ignoring invalid toolDescriptionMode ${JSON.stringify(mode)}; expected "full", "compact", or "custom".`);
	return "full";
}

function customDescriptionPaths(options?: ToolDescriptionOptions): string[] {
	const cwd = options?.cwd ?? process.cwd();
	const agentDir = options?.agentDir ?? getAgentDir();
	return [
		path.join(getProjectConfigDir(cwd), CUSTOM_TOOL_DESCRIPTION_FILE),
		path.join(agentDir, CUSTOM_TOOL_DESCRIPTION_FILE),
	];
}

function renderCustomTemplate(template: string, options?: ToolDescriptionOptions): string {
	const cwd = options?.cwd ?? process.cwd();
	const agentDir = options?.agentDir ?? getAgentDir();
	const projectConfigDir = getProjectConfigDir(cwd);
	const variables: Record<string, () => string> = {
		fullDescription: () => FULL_SUBAGENT_TOOL_DESCRIPTION,
		full: () => FULL_SUBAGENT_TOOL_DESCRIPTION,
		compactDescription: () => COMPACT_SUBAGENT_TOOL_DESCRIPTION,
		compact: () => COMPACT_SUBAGENT_TOOL_DESCRIPTION,
		safetyGuidance: () => SUBAGENT_SAFETY_GUIDANCE,
		safety: () => SUBAGENT_SAFETY_GUIDANCE,
		agentDir: () => agentDir,
		projectConfigDir: () => projectConfigDir,
	};
	return template.replace(/\{\{(\w+)\}\}/g, (raw, name: string) => {
		const replacement = variables[name];
		if (replacement) return replacement();
		warn(options, `${CUSTOM_TOOL_DESCRIPTION_FILE}: unknown placeholder ${raw} left unchanged.`);
		return raw;
	});
}

function loadCustomToolDescription(options?: ToolDescriptionOptions): string | undefined {
	for (const filePath of customDescriptionPaths(options)) {
		let stat: fs.Stats;
		try {
			stat = fs.statSync(filePath);
		} catch (error) {
			if (typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") continue;
			warn(options, `Failed to inspect custom tool description '${filePath}': ${error instanceof Error ? error.message : String(error)}`);
			continue;
		}
		if (!stat.isFile()) {
			warn(options, `Ignoring custom tool description '${filePath}' because it is not a file.`);
			continue;
		}
		if (stat.size > CUSTOM_TOOL_DESCRIPTION_MAX_BYTES) {
			warn(options, `Ignoring custom tool description '${filePath}' because it is larger than ${CUSTOM_TOOL_DESCRIPTION_MAX_BYTES} bytes.`);
			continue;
		}
		try {
			const template = fs.readFileSync(filePath, "utf-8").trim();
			if (!template) {
				warn(options, `Ignoring empty custom tool description '${filePath}'.`);
				continue;
			}
			const rendered = renderCustomTemplate(template, options).trim();
			if (!rendered) {
				warn(options, `Ignoring custom tool description '${filePath}' because it rendered empty.`);
				continue;
			}
			return rendered;
		} catch (error) {
			warn(options, `Failed to read custom tool description '${filePath}': ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return undefined;
}

function withMandatorySafetyGuidance(description: string): string {
	const customDescription = description
		.split(SUBAGENT_SAFETY_GUIDANCE)
		.map((part) => part.trim())
		.filter(Boolean)
		.join("\n\n");
	return customDescription
		? `${customDescription}\n\n${SUBAGENT_SAFETY_GUIDANCE}`
		: SUBAGENT_SAFETY_GUIDANCE;
}

export function buildSubagentToolDescription(config: Pick<ExtensionConfig, "toolDescriptionMode"> = {}, options?: ToolDescriptionOptions): string {
	if (config.toolDescriptionMode === undefined) return DEFAULT_SUBAGENT_TOOL_DESCRIPTION;
	const mode = resolveToolDescriptionMode(config, options);
	let description: string;
	if (mode === "compact") description = COMPACT_SUBAGENT_TOOL_DESCRIPTION;
	else if (mode === "custom") {
		const custom = loadCustomToolDescription(options);
		if (custom) description = withMandatorySafetyGuidance(custom);
		else {
			warn(options, `${CUSTOM_TOOL_DESCRIPTION_FILE} was not found or valid for toolDescriptionMode "custom"; using full description.`);
			description = FULL_SUBAGENT_TOOL_DESCRIPTION;
		}
	} else description = FULL_SUBAGENT_TOOL_DESCRIPTION;
	return description;
}

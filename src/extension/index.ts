import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { discoverConfiguredAgents, findConfiguredAgent, type RuntimeConfiguredAgentDefinition } from "../agents/discovery.ts";
import { clearRuntimeAgents, listRuntimeAgents } from "../agents/configured-runtime-registry.ts";
import { registerRuntimeAgentEventListener } from "../agents/runtime-agent-events.ts";
import { boundForegroundText, createForegroundKernel, FOREGROUND_ERROR_MAX_BYTES, FOREGROUND_TIMEOUT_MAX_MS, type ForegroundResult } from "../runs/foreground/kernel.ts";
import { isSubagentChildContext } from "../runs/shared/child-session.ts";
import { createSubagentParamsSchema } from "./schemas.ts";
import { resolveDiscoverySources } from "./discovery-sources.ts";

const DESCRIPTION = "List configured child agents or launch one named Pi child in the foreground. Listing is side-effect-free. Launches return the child's normalized status, output, error, and reported usage.";
type Details = { agents: Array<{ name: string; description: string; source: string }>; diagnostics: Array<{ code: string; message: string; source?: string }> } | ForegroundResult;
type Kernel = ReturnType<typeof createForegroundKernel>;

function runtimeDefinitions(pi: ExtensionAPI): RuntimeConfiguredAgentDefinition[] { return listRuntimeAgents(pi); }
function result(details: Details): AgentToolResult<Details> {
	const failed = "status" in details && details.status !== "completed";
	const text = failed ? boundForegroundText(`Subagent launch failed (${details.status}): ${details.error?.message ?? "No error detail."}\n${JSON.stringify(details)}`, FOREGROUND_ERROR_MAX_BYTES) : JSON.stringify(details);
	return { content: [{ type: "text", text }], details };
}
function request(value: unknown): { action: "list" } | { agent: string; task: string; cwd?: string; context?: "fresh" | "fork"; model?: string; thinking?: string; timeoutMs?: number } {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("subagent request must be an object");
	const input = value as Record<string, unknown>;
	if (input.action === "list") {
		if (Object.keys(input).some((key) => key !== "action")) throw new Error("subagent list request contains an unknown field");
		return { action: "list" };
	}
	if (input.action !== undefined) throw new Error("subagent launch request contains an unknown field or action");
	const allowed = new Set(["agent", "task", "cwd", "context", "model", "thinking", "timeoutMs"]);
	if (Object.keys(input).some((key) => !allowed.has(key))) throw new Error("subagent launch request contains an unknown field or action");
	const text = (name: string, required = false): string | undefined => {
		const value = input[name];
		if (value === undefined && !required) return undefined;
		if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.includes("\0")) throw new Error(`${name} must be a non-empty trimmed string`);
		return value;
	};
	const context = input.context;
	if (context !== undefined && context !== "fresh" && context !== "fork") throw new Error("context must be 'fresh' or 'fork'");
	const timeoutMs = input.timeoutMs;
	if (timeoutMs !== undefined && (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > FOREGROUND_TIMEOUT_MAX_MS)) throw new Error(`timeoutMs must be a positive integer no greater than ${FOREGROUND_TIMEOUT_MAX_MS}`);
	return { agent: text("agent", true)!, task: text("task", true)!, ...(text("cwd") ? { cwd: text("cwd") } : {}), ...(context ? { context } : {}), ...(text("model") ? { model: text("model") } : {}), ...(text("thinking") ? { thinking: text("thinking") } : {}), ...(timeoutMs !== undefined ? { timeoutMs } : {}) };
}

export interface SubagentExtensionOptions {
	createKernel?: typeof createForegroundKernel;
	resolveSources?: typeof resolveDiscoverySources;
}

export default function registerSubagentExtension(pi: ExtensionAPI, options: SubagentExtensionOptions = {}): void {
	if (isSubagentChildContext()) return;
	const kernelFactory = options.createKernel ?? createForegroundKernel;
	const sourceResolver = options.resolveSources ?? resolveDiscoverySources;
	const kernels = new Map<object, Map<string, Kernel>>();
	let shuttingDown = false;
	const disposeEventListener = registerRuntimeAgentEventListener(pi);
	const getKernel = (ctx: ExtensionContext): Kernel => {
		if (shuttingDown) throw new Error("Subagent extension is shutting down.");
		const byCwd = kernels.get(ctx.sessionManager) ?? new Map<string, Kernel>();
		const cwd = ctx.cwd;
		const existing = byCwd.get(cwd); if (existing) return existing;
		const manager = ctx.sessionManager as typeof ctx.sessionManager & { createBranchedSession(leafId: string): string | undefined };
		const kernel = kernelFactory({ defaultCwd: cwd, forkSource: {
			getSessionFile: () => manager.getSessionFile(),
			getLeafId: () => manager.getLeafId(),
			createBranchedSession: (leafId) => manager.createBranchedSession(leafId),
		} });
		byCwd.set(cwd, kernel); kernels.set(ctx.sessionManager, byCwd);
		return kernel;
	};
	const parameters = createSubagentParamsSchema();
	const tool: ToolDefinition<typeof parameters, Details> = {
		name: "subagent", label: "Subagent", description: DESCRIPTION, parameters,
		async execute(_id, raw, signal, _onUpdate, ctx) {
			const parsed = request(raw);
			const discovery = discoverConfiguredAgents(sourceResolver(ctx.cwd, runtimeDefinitions(pi)));
			if ("action" in parsed) return result({
				agents: discovery.agents.map(({ name, description, source }) => ({ name, description, source })),
				diagnostics: discovery.diagnostics.map(({ code, message, source }) => ({ code, message, ...(source ? { source } : {}) })),
			});
			const agent = findConfiguredAgent(parsed.agent, discovery);
			if (!agent) return result({ status: "failed", output: "", error: { code: "agent_not_found", message: boundForegroundText(`Configured agent '${parsed.agent}' was not found.`, FOREGROUND_ERROR_MAX_BYTES) } });
			return result(await getKernel(ctx).launch({ agent, task: parsed.task, ...(parsed.cwd ? { cwd: parsed.cwd } : {}), ...(parsed.context ? { context: parsed.context } : {}), ...(parsed.model ? { model: parsed.model } : {}), ...(parsed.thinking ? { thinking: parsed.thinking } : {}), ...(parsed.timeoutMs ? { timeoutMs: parsed.timeoutMs } : {}), ...(signal ? { signal } : {}) }));
		},
	};
	pi.registerTool(tool);
	pi.on("session_shutdown", async () => {
		if (shuttingDown) return;
		shuttingDown = true;
		disposeEventListener(); clearRuntimeAgents(pi);
		const owned = [...kernels.values()].flatMap(byCwd => [...byCwd.values()]); kernels.clear();
		await Promise.allSettled(owned.map(kernel => kernel.dispose()));
	});
}

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RuntimeConfiguredAgentDefinition } from "./discovery.ts";
import { THINKING_LEVELS } from "../shared/model-info.ts";

export interface RuntimeAgentDefinition {
	description: string;
	systemPrompt?: string;
	tools?: readonly string[];
	model?: string;
	thinking?: string;
	context?: "fresh" | "fork";
	cwd?: string;
	skills?: readonly string[];
	extensions?: readonly string[];
}
export interface RegisterRuntimeAgentInput { pi: ExtensionAPI; name: string; definition: RuntimeAgentDefinition }
export interface RuntimeAgentRegistration { dispose(): void }
const records = new WeakMap<object, Map<string, RuntimeConfiguredAgentDefinition>>();
const allowed = new Set(["description", "systemPrompt", "tools", "model", "thinking", "context", "cwd", "skills", "extensions"]);
function text(value: unknown, field: string, optional = false): string | undefined {
	if (value === undefined && optional) return undefined;
	if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.includes("\0")) throw new Error(`${field} must be a non-empty trimmed string.`);
	return value;
}
function list(value: unknown, field: string): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) throw new Error(`${field} must be an array of strings.`);
	const result: string[] = [];
	for (let index = 0; index < value.length; index++) result.push(text(value[index], `${field}[${index}]`)!);
	return result;
}
export function validateRuntimeAgentRegistration(input: RegisterRuntimeAgentInput): { name: string; definition: RuntimeConfiguredAgentDefinition } {
	if (!input.pi || typeof input.pi !== "object") throw new Error("Runtime agent pi must be an ExtensionAPI object.");
	const name = text(input.name, "Runtime agent name")!;
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error("Runtime agent name is invalid.");
	if (!input.definition || typeof input.definition !== "object" || Array.isArray(input.definition)) throw new Error("Runtime agent definition must be an object.");
	const raw = input.definition as unknown as Record<string, unknown>;
	const unsupported = Object.keys(raw).filter(k => !allowed.has(k)).sort();
	if (unsupported.length) throw new Error(`Runtime agent definition has unsupported fields: ${unsupported.join(", ")}.`);
	if (raw.context !== undefined && raw.context !== "fresh" && raw.context !== "fork") throw new Error("Runtime agent definition context must be 'fresh' or 'fork'.");
	const thinking = text(raw.thinking, "Runtime agent definition thinking", true);
	if (thinking !== undefined && !THINKING_LEVELS.some((level) => level === thinking)) throw new Error(`Runtime agent definition thinking must be one of: ${THINKING_LEVELS.join(", ")}.`);
	const definition: RuntimeConfiguredAgentDefinition = { name, description: text(raw.description, "Runtime agent definition description")!,
		...(text(raw.systemPrompt, "Runtime agent definition systemPrompt", true) ? { systemPrompt: raw.systemPrompt as string } : {}),
		...(list(raw.tools, "Runtime agent definition tools") ? { tools: list(raw.tools, "Runtime agent definition tools") } : {}),
		...(text(raw.model, "Runtime agent definition model", true) ? { model: raw.model as string } : {}),
		...(thinking ? { thinking } : {}),
		...(raw.context ? { context: raw.context as "fresh" | "fork" } : {}), ...(text(raw.cwd, "Runtime agent definition cwd", true) ? { cwd: raw.cwd as string } : {}),
		...(list(raw.skills, "Runtime agent definition skills") ? { skills: list(raw.skills, "Runtime agent definition skills") } : {}),
		...(list(raw.extensions, "Runtime agent definition extensions") ? { extensions: list(raw.extensions, "Runtime agent definition extensions") } : {}) };
	return { name, definition };
}
export function registerRuntimeAgent(input: RegisterRuntimeAgentInput): RuntimeAgentRegistration {
	const { name, definition } = validateRuntimeAgentRegistration(input);
	const map = records.get(input.pi) ?? new Map(); if (map.has(name)) throw new Error(`Runtime agent '${name}' is already registered.`); map.set(name, definition); records.set(input.pi, map);
	let live = true; return { dispose() { if (!live) return; live = false; map.delete(name); } };
}
export function listRuntimeAgents(pi: object): RuntimeConfiguredAgentDefinition[] { return [...(records.get(pi)?.values() ?? [])].map(x => ({ ...x })).sort((a,b) => a.name.localeCompare(b.name)); }
export function clearRuntimeAgents(pi: object): void { records.delete(pi); }

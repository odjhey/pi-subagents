import * as fs from "node:fs";
import * as path from "node:path";
import { parseFrontmatter, parseFrontmatterList } from "./frontmatter.ts";
import { THINKING_LEVELS } from "../shared/model-info.ts";

/** The five definition sources retained by the spawn kernel, in precedence order. */
export type ConfiguredAgentSource = "package" | "user" | "scan" | "project" | "runtime";
export type AgentContext = "fresh" | "fork";

/** Policy-neutral configuration understood by the spawn kernel. */
export interface ConfiguredAgentDefinition {
	name: string;
	description: string;
	systemPrompt: string;
	tools?: string[];
	model?: string;
	thinking?: string;
	context?: AgentContext;
	cwd?: string;
	skills?: string[];
	extensions?: string[];
	source: ConfiguredAgentSource;
	filePath: string;
}

export interface RuntimeConfiguredAgentDefinition extends Omit<ConfiguredAgentDefinition, "source" | "filePath" | "systemPrompt"> {
	systemPrompt?: string;
	filePath?: string;
}

export interface AgentDiscoveryDiagnostic {
	code: "invalid_definition" | "duplicate_definition" | "definition_replaced" | "unreadable_directory";
	message: string;
	source?: string;
	name?: string;
}

export interface DiscoverConfiguredAgentsOptions {
	packageDirs?: readonly string[];
	userDir?: string;
	scanDirs?: readonly string[];
	projectDir?: string;
	runtime?: readonly RuntimeConfiguredAgentDefinition[];
	sourceDiagnostics?: readonly AgentDiscoveryDiagnostic[];
}

export interface ConfiguredAgentDiscoveryResult {
	agents: ConfiguredAgentDefinition[];
	diagnostics: AgentDiscoveryDiagnostic[];
}

interface Tier {
	source: ConfiguredAgentSource;
	label: string;
	definitions: ConfiguredAgentDefinition[];
	diagnostics: AgentDiscoveryDiagnostic[];
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const KNOWN_FIELDS = new Set(["name", "description", "tools", "model", "thinking", "context", "cwd", "skills", "extensions"]);

function nonEmpty(value: unknown, field: string): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.includes("\0")) {
		throw new Error(`${field} must be a non-empty trimmed string without NUL characters`);
	}
	return value;
}

function list(value: unknown, field: string): string[] | undefined {
	if (value === undefined) return undefined;
	const parsed = typeof value === "string" ? parseFrontmatterList(value) : value;
	if (!Array.isArray(parsed)) throw new Error(`${field} must be a list of strings`);
	const result: string[] = [];
	for (let index = 0; index < parsed.length; index++) {
		const item = nonEmpty(parsed[index], `${field}[${index}]`);
		if (item === undefined) throw new Error(`${field}[${index}] must be a non-empty trimmed string without NUL characters`);
		result.push(item);
	}
	return [...new Set(result)];
}

function normalize(input: Record<string, unknown>, source: ConfiguredAgentSource, filePath: string, systemPrompt: unknown): ConfiguredAgentDefinition {
	const unknown = Object.keys(input).filter((key) => !KNOWN_FIELDS.has(key)).sort();
	if (unknown.length) throw new Error(`unknown fields: ${unknown.join(", ")}`);
	const name = nonEmpty(input.name, "name");
	if (!name || !NAME.test(name)) throw new Error("name must contain only letters, numbers, '.', '_', or '-', and start with a letter or number");
	const context = input.context;
	if (context !== undefined && context !== "fresh" && context !== "fork") throw new Error("context must be 'fresh' or 'fork'");
	if (systemPrompt !== undefined && (typeof systemPrompt !== "string" || systemPrompt.includes("\0"))) {
		throw new Error("systemPrompt must be a string without NUL characters");
	}
	const thinking = nonEmpty(input.thinking, "thinking");
	if (thinking !== undefined && !THINKING_LEVELS.some((level) => level === thinking)) {
		throw new Error(`thinking must be one of: ${THINKING_LEVELS.join(", ")}`);
	}
	return {
		name,
		description: nonEmpty(input.description, "description") ?? "",
		systemPrompt: systemPrompt ?? "",
		...(list(input.tools, "tools") ? { tools: list(input.tools, "tools") } : {}),
		...(nonEmpty(input.model, "model") ? { model: nonEmpty(input.model, "model") } : {}),
		...(thinking ? { thinking } : {}),
		...(context ? { context: context as AgentContext } : {}),
		...(nonEmpty(input.cwd, "cwd") ? { cwd: nonEmpty(input.cwd, "cwd") } : {}),
		...(list(input.skills, "skills") ? { skills: list(input.skills, "skills") } : {}),
		...(list(input.extensions, "extensions") ? { extensions: list(input.extensions, "extensions") } : {}),
		source,
		filePath,
	};
}

function scanDirectory(dir: string, source: ConfiguredAgentSource, label: string): Tier {
	const definitions: ConfiguredAgentDefinition[] = [];
	const diagnostics: AgentDiscoveryDiagnostic[] = [];
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { source, label, definitions, diagnostics };
		diagnostics.push({ code: "unreadable_directory", message: `Cannot read agent directory '${dir}'.`, source: label });
		return { source, label, definitions, diagnostics };
	}
	const files = entries.filter((entry) => {
		if (!entry.name.endsWith(".md")) return false;
		if (entry.isFile()) return true;
		if (!entry.isSymbolicLink()) return false;
		try { return fs.statSync(path.join(dir, entry.name)).isFile(); } catch { return false; }
	}).map((entry) => path.resolve(dir, entry.name)).sort();
	for (const filePath of files) {
		try {
			const { frontmatter, body } = parseFrontmatter(fs.readFileSync(filePath, "utf8"));
			const input: Record<string, unknown> = { ...frontmatter, name: frontmatter.name ?? path.basename(filePath, ".md") };
			definitions.push(normalize(input, source, filePath, body));
		} catch (error) {
			diagnostics.push({ code: "invalid_definition", message: `Invalid agent definition '${filePath}': ${error instanceof Error ? error.message : String(error)}`, source: filePath });
		}
	}
	definitions.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.name.localeCompare(b.name));
	return { source, label, definitions, diagnostics };
}

function runtimeTier(runtime: readonly RuntimeConfiguredAgentDefinition[]): Tier {
	const definitions: ConfiguredAgentDefinition[] = [];
	const diagnostics: AgentDiscoveryDiagnostic[] = [];
	for (const [index, value] of runtime.entries()) {
		let diagnosticPath = `runtime:${index}`;
		try {
			if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("definition must be an object");
			const { systemPrompt, filePath: suppliedPath, ...input } = value as unknown as Record<string, unknown>;
			if (suppliedPath !== undefined) diagnosticPath = nonEmpty(suppliedPath, "filePath")!;
			const normalized = normalize(input, "runtime", diagnosticPath, systemPrompt);
			if (suppliedPath === undefined) normalized.filePath = `runtime:${normalized.name}`;
			definitions.push(normalized);
		} catch (error) {
			diagnostics.push({ code: "invalid_definition", message: `Invalid runtime agent definition '${diagnosticPath}': ${error instanceof Error ? error.message : String(error)}`, source: diagnosticPath });
		}
	}
	definitions.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.name.localeCompare(b.name));
	return { source: "runtime", label: "runtime", definitions, diagnostics };
}

/** Discover and merge definitions. Each configured scan directory is its own ordered precedence tier. */
export function discoverConfiguredAgents(options: DiscoverConfiguredAgentsOptions = {}): ConfiguredAgentDiscoveryResult {
	const tiers: Tier[] = [
		{ source: "package", label: "package", definitions: [], diagnostics: [] },
	];
	for (const dir of [...(options.packageDirs ?? [])].sort()) {
		const scanned = scanDirectory(dir, "package", dir);
		tiers[0]!.definitions.push(...scanned.definitions);
		tiers[0]!.diagnostics.push(...scanned.diagnostics);
	}
	if (options.userDir) tiers.push(scanDirectory(options.userDir, "user", options.userDir));
	for (const dir of options.scanDirs ?? []) tiers.push(scanDirectory(dir, "scan", dir));
	if (options.projectDir) tiers.push(scanDirectory(options.projectDir, "project", options.projectDir));
	tiers.push(runtimeTier(options.runtime ?? []));

	const effective = new Map<string, ConfiguredAgentDefinition>();
	const diagnostics = [...(options.sourceDiagnostics ?? []), ...tiers.flatMap((tier) => tier.diagnostics)];
	for (const tier of tiers) {
		tier.definitions.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.name.localeCompare(b.name));
		const groups = new Map<string, ConfiguredAgentDefinition[]>();
		for (const definition of tier.definitions) {
			const group = groups.get(definition.name) ?? [];
			group.push(definition);
			groups.set(definition.name, group);
		}
		for (const name of [...groups.keys()].sort()) {
			const candidates = groups.get(name)!;
			if (candidates.length > 1) {
				effective.delete(name);
				diagnostics.push({ code: "duplicate_definition", message: `Agent '${name}' is ambiguous within ${tier.label}: ${candidates.map((item) => item.filePath).join(", ")}.`, source: tier.label, name });
				continue;
			}
			const next = candidates[0]!;
			const previous = effective.get(name);
			if (previous) diagnostics.push({ code: "definition_replaced", message: `Agent '${name}' from '${previous.filePath}' was replaced by '${next.filePath}'.`, source: next.filePath, name });
			effective.set(name, next);
		}
	}
	return {
		agents: [...effective.values()].sort((a, b) => a.name.localeCompare(b.name) || a.filePath.localeCompare(b.filePath)),
		diagnostics: diagnostics.sort((a, b) => a.code.localeCompare(b.code) || (a.name ?? "").localeCompare(b.name ?? "") || (a.source ?? "").localeCompare(b.source ?? "") || a.message.localeCompare(b.message)),
	};
}

/** Resolve only an exact configured name. */
export function findConfiguredAgent(name: string, result: Pick<ConfiguredAgentDiscoveryResult, "agents">): ConfiguredAgentDefinition | undefined {
	return result.agents.find((agent) => agent.name === name);
}

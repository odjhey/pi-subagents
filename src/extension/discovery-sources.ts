import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentDiscoveryDiagnostic, DiscoverConfiguredAgentsOptions, RuntimeConfiguredAgentDefinition } from "../agents/discovery.ts";
import { getAgentDir, getProjectConfigDir } from "../shared/utils.ts";

type JsonObject = Record<string, unknown>;
interface Declaration { scans: string[]; packages: string[] }

function readObject(file: string, diagnostics: AgentDiscoveryDiagnostic[]): JsonObject | undefined {
	try {
		const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
		if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected a JSON object");
		return value as JsonObject;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		diagnostics.push({ code: "invalid_definition", source: file, message: `Invalid discovery settings '${file}': ${error instanceof Error ? error.message : String(error)}` });
		return undefined;
	}
}

function strings(value: unknown): string[] | undefined {
	if (value === undefined) return [];
	if (!Array.isArray(value)) return undefined;
	const result: string[] = [];
	for (let index = 0; index < value.length; index++) {
		if (typeof value[index] !== "string" || !value[index].trim()) return undefined;
		result.push(value[index]);
	}
	return result;
}

function packageSources(value: unknown): string[] | undefined {
	if (value === undefined) return [];
	if (!Array.isArray(value)) return undefined;
	const result: string[] = [];
	for (let index = 0; index < value.length; index++) {
		const entry = value[index];
		const source = typeof entry === "string" ? entry : entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as JsonObject).source : undefined;
		if (typeof source !== "string" || !source.trim()) return undefined;
		result.push(source);
	}
	return result;
}

function expandScan(entry: string, base: string): string[] {
	const normalized = entry.replaceAll("\\", path.sep);
	const resolved = normalized === "~" ? os.homedir() : normalized.startsWith(`~${path.sep}`) ? path.join(os.homedir(), normalized.slice(2)) : path.resolve(base, normalized);
	const parts = resolved.split(path.sep);
	if (!parts.includes("*")) return [resolved];
	if (parts.filter((part) => part === "*").length !== 1) return [];
	const index = parts.indexOf("*");
	const parent = parts.slice(0, index).join(path.sep) || path.sep;
	const tail = parts.slice(index + 1);
	try {
		return fs.readdirSync(parent, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
			.map((entry) => path.join(parent, entry.name, ...tail)).sort();
	} catch { return []; }
}

function declaration(file: string, base: string, diagnostics: AgentDiscoveryDiagnostic[]): Declaration {
	const settings = readObject(file, diagnostics);
	if (!settings) return { scans: [], packages: [] };
	const sub = settings.subagents;
	if (sub !== undefined && (!sub || typeof sub !== "object" || Array.isArray(sub))) return invalidDeclaration(file, diagnostics);
	const scans = strings((sub as JsonObject | undefined)?.agentScanDirs);
	const packages = packageSources(settings.packages);
	if (!scans || !packages) return invalidDeclaration(file, diagnostics);
	return { scans: scans.flatMap((entry) => expandScan(entry, base)), packages };
}

function invalidDeclaration(file: string, diagnostics: AgentDiscoveryDiagnostic[]): Declaration {
	diagnostics.push({ code: "invalid_definition", source: file, message: `Invalid discovery declaration in '${file}': expected complete arrays of paths or package sources.` });
	return { scans: [], packages: [] };
}

function safeIdentity(value: string): boolean {
	return value.length > 0 && !path.isAbsolute(value)
		&& value.split(/[\\/]/).every((part) => part.length > 0 && part !== "." && part !== "..");
}
function npmName(source: string): string | undefined {
	const spec = source.slice(4).trim();
	const match = spec.startsWith("@")
		? spec.match(/^(@[^/@]+\/[^/@]+)(?:@(.+))?$/)
		: spec.match(/^([^/@]+)(?:@(.+))?$/);
	const name = match?.[1];
	return name && safeIdentity(name) ? name : undefined;
}
function gitIdentity(source: string): { host: string; repo: string } | undefined {
	const spec = source.slice(4).trim();
	let host = ""; let repo = "";
	const scp = spec.match(/^git@([^:]+):(.+)$/);
	if (scp) { host = scp[1]!; repo = scp[2]!; }
	else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(spec)) {
		try { const url = new URL(spec); host = url.hostname; repo = url.pathname.replace(/^\/+/, ""); } catch { return undefined; }
	} else { const slash = spec.indexOf("/"); if (slash < 0) return undefined; host = spec.slice(0, slash); repo = spec.slice(slash + 1); }
	const ref = [repo.indexOf("@"), repo.indexOf("#")].filter((i) => i >= 0).sort((a, b) => a - b)[0];
	if (ref !== undefined) repo = repo.slice(0, ref);
	repo = repo.replace(/\.git$/, "").replace(/^\/+/, "");
	return safeIdentity(host) && safeIdentity(repo) && repo.split(/[\\/]/).length >= 2 ? { host, repo } : undefined;
}
function packageRoot(spec: string, managed: string): string | undefined {
	const source = spec.trim();
	if (source.startsWith("npm:")) { const name = npmName(source); return name ? path.join(managed, "npm", "node_modules", name) : undefined; }
	if (source.startsWith("git:")) { const parsed = gitIdentity(source); return parsed ? path.join(managed, "git", parsed.host, parsed.repo) : undefined; }
	if (/^https?:\/\//i.test(source)) { const parsed = gitIdentity(`git:${source}`); return parsed ? path.join(managed, "git", parsed.host, parsed.repo) : undefined; }
	const value = source.startsWith("file:") ? source.slice(5) : source;
	if (value === "~") return os.homedir();
	if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
	if (path.isAbsolute(value)) return value;
	return value === "." || value === ".." || value.startsWith("./") || value.startsWith("../") || source.startsWith("file:") ? path.resolve(managed, value) : undefined;
}

function manifestAgentDirs(root: string, diagnostics: AgentDiscoveryDiagnostic[]): string[] {
	const file = path.join(root, "package.json");
	const pkg = readObject(file, diagnostics);
	if (!pkg) return [];
	const pi = pkg.pi;
	const values = [pkg["pi-subagents"], pi && typeof pi === "object" && !Array.isArray(pi) ? (pi as JsonObject).subagents : undefined].filter((value) => value !== undefined);
	const result: string[] = [];
	for (const value of values) {
		if (!value || typeof value !== "object" || Array.isArray(value)) return invalidManifest(file, diagnostics);
		const agents = strings((value as JsonObject).agents);
		if (!agents) return invalidManifest(file, diagnostics);
		result.push(...agents.map((entry) => path.resolve(root, entry)));
	}
	return result;
}

function invalidManifest(file: string, diagnostics: AgentDiscoveryDiagnostic[]): string[] {
	diagnostics.push({ code: "invalid_definition", source: file, message: `Invalid discovery declaration in '${file}': expected a complete agents array.` });
	return [];
}

function npmRoots(base: string): string[] {
	const dir = path.join(base, "npm", "node_modules");
	try {
		const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory() || entry.isSymbolicLink()).sort((a, b) => a.name.localeCompare(b.name));
		return entries.flatMap((entry) => {
			const root = path.join(dir, entry.name);
			if (!entry.name.startsWith("@")) return [root];
			try { return fs.readdirSync(root, { withFileTypes: true }).filter((child) => child.isDirectory() || child.isSymbolicLink()).map((child) => path.join(root, child.name)).sort(); }
			catch { return []; }
		});
	} catch { return []; }
}

function nearestProjectRoot(cwd: string): string {
	let current = path.resolve(cwd);
	for (;;) {
		for (const marker of [getProjectConfigDir(current), path.join(current, ".git")]) {
			try { if (fs.statSync(marker).isDirectory()) return current; } catch { /* keep walking */ }
		}
		const parent = path.dirname(current);
		if (parent === current) return path.resolve(cwd);
		current = parent;
	}
}

export function resolveDiscoverySources(cwd: string, runtime: readonly RuntimeConfiguredAgentDefinition[] = []): DiscoverConfiguredAgentsOptions {
	const diagnostics: AgentDiscoveryDiagnostic[] = [];
	const projectRoot = nearestProjectRoot(cwd);
	const userRoot = getAgentDir();
	const projectConfig = getProjectConfigDir(projectRoot);
	const user = declaration(path.join(userRoot, "settings.json"), userRoot, diagnostics);
	const project = declaration(path.join(projectConfig, "settings.json"), projectConfig, diagnostics);
	const roots = [...new Set([projectRoot, ...npmRoots(userRoot), ...npmRoots(projectConfig), ...user.packages.map((source) => packageRoot(source, userRoot)), ...project.packages.map((source) => packageRoot(source, projectConfig))]
		.filter((value): value is string => !!value).map((value) => path.resolve(value)))];
	return {
		packageDirs: [...new Set(roots.flatMap((root) => manifestAgentDirs(root, diagnostics)))].sort(),
		userDir: path.join(userRoot, "agents"),
		scanDirs: [...user.scans, ...project.scans],
		projectDir: path.join(projectConfig, "agents"), runtime,
		sourceDiagnostics: diagnostics,
	};
}

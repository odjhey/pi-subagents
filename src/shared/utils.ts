import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const DEFAULT_CONFIG_DIR_NAME = ".pi";
const PI_CODING_AGENT_PACKAGE_NAME = "@earendil-works/pi-coding-agent";
export const PI_CODING_AGENT_PACKAGE_ROOT_ENV = "PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT";

function validConfigDirName(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function packageConfigDir(root: string | undefined): string | undefined {
	if (!root) return undefined;
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { name?: unknown; piConfig?: { configDir?: unknown } };
		return pkg.name === PI_CODING_AGENT_PACKAGE_NAME ? validConfigDirName(pkg.piConfig?.configDir) : undefined;
	} catch { return undefined; }
}

function configDirFromEntry(entryPoint: string | undefined, packageRoot: string | undefined): string | undefined {
	const explicit = packageConfigDir(packageRoot);
	if (explicit) return explicit;
	if (!entryPoint) return undefined;
	try {
		let directory = path.dirname(fs.realpathSync(entryPoint));
		while (directory !== path.dirname(directory)) {
			const value = packageConfigDir(directory);
			if (value) return value;
			directory = path.dirname(directory);
		}
	} catch { /* Metadata lookup is best-effort. */ }
	return undefined;
}

export function resolveConfigDirName(codingAgentModule?: unknown, entryPoint = process.argv[1], packageRoot = process.env[PI_CODING_AGENT_PACKAGE_ROOT_ENV]): string {
	const moduleValue = codingAgentModule && typeof codingAgentModule === "object"
		? validConfigDirName((codingAgentModule as { CONFIG_DIR_NAME?: unknown }).CONFIG_DIR_NAME)
		: undefined;
	return moduleValue ?? configDirFromEntry(entryPoint, packageRoot) ?? DEFAULT_CONFIG_DIR_NAME;
}

export function getConfigDirName(): string {
	return resolveConfigDirName();
}

export function getProjectConfigDir(projectRoot: string): string {
	return path.join(projectRoot, getConfigDirName());
}

export function getAgentDir(): string {
	const configured = process.env.PI_CODING_AGENT_DIR;
	const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
	if (configured === "~") return home;
	if (configured?.startsWith("~/") || configured?.startsWith("~\\")) return path.join(home, configured.slice(2));
	return configured || path.join(home, getConfigDirName(), "agent");
}

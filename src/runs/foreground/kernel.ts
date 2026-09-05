import * as fs from "node:fs";
import * as path from "node:path";
import type { ConfiguredAgentDefinition } from "../../agents/discovery.ts";
import { THINKING_LEVELS, type ThinkingLevel } from "../../shared/model-info.ts";
import { createDefaultChildSessionFactory, type ChildSession, type ChildSessionFactory, type ChildSessionLaunch } from "../shared/child-session.ts";

export const FOREGROUND_OUTPUT_MAX_BYTES = 64 * 1024;
export const FOREGROUND_ERROR_MAX_BYTES = 16 * 1024;
export const FOREGROUND_TIMEOUT_MAX_MS = 24 * 60 * 60 * 1000;
export const FOREGROUND_CLEANUP_MAX_MS = 5_000;
export const FOREGROUND_TRUNCATION_MARKER = "\n[truncated]";

export interface ForegroundLaunchRequest {
	agent: ConfiguredAgentDefinition;
	task: string;
	cwd?: string;
	context?: "fresh" | "fork";
	model?: string;
	thinking?: string;
	timeoutMs?: number;
	signal?: AbortSignal;
}

export interface ForegroundUsage {
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	costUsd?: number;
}

export interface ForegroundResult {
	status: "completed" | "failed" | "timed_out" | "aborted";
	output: string;
	error?: { code: string; message: string };
	usage?: ForegroundUsage;
}

/** The host supplies its Pi parent session manager. This calls Pi's branch operation directly. */
export interface ForegroundForkSource {
	getSessionFile(): string | undefined;
	getLeafId(): string | null;
	createBranchedSession(leafId: string): string | undefined;
}

export interface ForegroundKernelOptions {
	factory?: ChildSessionFactory;
	defaultCwd?: string;
	forkSource?: ForegroundForkSource;
	cleanupTimeoutMs?: number;
	/** Injected factories are caller-owned unless explicitly opted in. Production defaults are kernel-owned. */
	ownFactory?: boolean;
}

interface ActiveLaunch { session?: ChildSession; terminate: (outcome: TerminalOutcome) => void; }
type TerminalOutcome =
	| { status: "completed" }
	| { status: "failed"; error: unknown; code: "startup_failed" | "prompt_failed" }
	| { status: "timed_out"; error: string }
	| { status: "aborted"; error: string; code: "aborted" | "kernel_disposed" };

export function boundForegroundText(value: string, cap: number): string {
	if (Buffer.byteLength(value, "utf8") <= cap) return value;
	const budget = cap - Buffer.byteLength(FOREGROUND_TRUNCATION_MARKER, "utf8");
	let low = 0;
	let high = value.length;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		const end = middle > 0 && middle < value.length && /[\uD800-\uDBFF]/.test(value[middle - 1]!) ? middle - 1 : middle;
		if (Buffer.byteLength(value.slice(0, end), "utf8") <= budget) low = middle;
		else high = middle - 1;
	}
	let end = low;
	if (end > 0 && end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1]!)) end--;
	while (Buffer.byteLength(value.slice(0, end), "utf8") > budget) end--;
	return value.slice(0, end) + FOREGROUND_TRUNCATION_MARKER;
}

function errorResult(status: ForegroundResult["status"], code: string, error: unknown, output = ""): ForegroundResult {
	const message = error instanceof Error ? error.message : String(error);
	return { status, output: boundForegroundText(output, FOREGROUND_OUTPUT_MAX_BYTES), error: { code, message: boundForegroundText(message, FOREGROUND_ERROR_MAX_BYTES) } };
}

function nonEmpty(value: unknown, name: string): asserts value is string {
	if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.includes("\0")) throw new Error(`${name} must be a non-empty trimmed string without NUL characters`);
}

function validate(request: ForegroundLaunchRequest, baseCwd: string): { cwd: string; context: "fresh" | "fork"; timeoutMs?: number } {
	if (!request.agent || typeof request.agent !== "object") throw new Error("agent must be a configured agent definition");
	nonEmpty(request.agent.name, "agent.name");
	nonEmpty(request.task, "task");
	const context = request.context ?? request.agent.context ?? "fresh";
	if (context !== "fresh" && context !== "fork") throw new Error("context must be 'fresh' or 'fork'");
	for (const [name, value] of [["model", request.model ?? request.agent.model], ["thinking", request.thinking ?? request.agent.thinking]] as const) if (value !== undefined) nonEmpty(value, name);
	const thinking = request.thinking ?? request.agent.thinking;
	if (thinking !== undefined && !THINKING_LEVELS.some((level) => level === thinking)) throw new Error(`thinking must be one of: ${THINKING_LEVELS.join(", ")}`);
	const tools = request.agent.tools;
	if (tools !== undefined && (!Array.isArray(tools) || tools.some((tool) => typeof tool !== "string" || !tool.trim() || tool !== tool.trim()))) throw new Error("tools must be a list of non-empty trimmed strings");
	for (const [name, values] of [["extensions", request.agent.extensions], ["skills", request.agent.skills]] as const) {
		if (values !== undefined && (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value.trim() || value !== value.trim() || value.includes("\0")))) throw new Error(`${name} must be a list of non-empty trimmed paths without NUL characters`);
	}
	const timeoutMs = request.timeoutMs;
	if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || !Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > FOREGROUND_TIMEOUT_MAX_MS)) throw new Error(`timeoutMs must be a positive integer no greater than ${FOREGROUND_TIMEOUT_MAX_MS}`);
	const cwd = path.resolve(baseCwd, request.cwd ?? request.agent.cwd ?? ".");
	let stat: fs.Stats;
	try { stat = fs.statSync(cwd); } catch { throw new Error(`cwd does not exist: ${cwd}`); }
	if (!stat.isDirectory()) throw new Error(`cwd is not a directory: ${cwd}`);
	return { cwd, context, ...(timeoutMs !== undefined ? { timeoutMs } : {}) };
}

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.flatMap((part) => part && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string" ? [(part as { text: string }).text] : []).join("");
}

function normalizedSession(session: ChildSession, baseline = 0): Pick<ForegroundResult, "output" | "usage"> {
	let output = "";
	const usage: ForegroundUsage = {};
	for (const message of (session.messages as unknown as ReadonlyArray<Record<string, unknown>>).slice(baseline)) {
		if (message.role !== "assistant") continue;
		const text = textFromContent(message.content);
		if (text) output = text;
		const raw = message.usage as Record<string, unknown> | undefined;
		if (!raw) continue;
		const add = (target: keyof ForegroundUsage, source: string) => { const value = raw[source]; if (typeof value === "number" && Number.isFinite(value)) usage[target] = (usage[target] ?? 0) + value; };
		add("inputTokens", "input"); add("outputTokens", "output"); add("cacheReadTokens", "cacheRead"); add("cacheWriteTokens", "cacheWrite");
		const cost = raw.cost as Record<string, unknown> | undefined;
		if (typeof cost?.total === "number" && Number.isFinite(cost.total)) usage.costUsd = (usage.costUsd ?? 0) + cost.total;
	}
	return { output: boundForegroundText(output, FOREGROUND_OUTPUT_MAX_BYTES), ...(Object.keys(usage).length ? { usage } : {}) };
}

export function createForegroundKernel(options: ForegroundKernelOptions = {}) {
	const factory = options.factory ?? createDefaultChildSessionFactory();
	const ownsFactory = options.ownFactory ?? options.factory === undefined;
	const baseCwd = options.defaultCwd ?? process.cwd();
	const cleanupTimeoutMs = Math.max(0, Math.min(options.cleanupTimeoutMs ?? FOREGROUND_CLEANUP_MAX_MS, FOREGROUND_CLEANUP_MAX_MS));
	const active = new Set<ActiveLaunch>();
	const aborts = new WeakSet<ChildSession>();
	const hardDisposals = new WeakSet<ChildSession>();
	const cleanups = new WeakMap<ChildSession, Promise<void>>();
	const pendingCreations = new Set<Promise<void>>();
	let disposed = false;
	let factoryDisposal: Promise<void> | undefined;
	const delay = (ms: number) => new Promise<void>((resolve) => { const timer = setTimeout(resolve, ms); timer.unref?.(); });
	const requestAbort = (session: ChildSession): Promise<void> => {
		if (aborts.has(session)) return Promise.resolve();
		aborts.add(session);
		try { return Promise.resolve(session.abort()).catch(() => {}); } catch { return Promise.resolve(); }
	};
	const forceHardDispose = (session: ChildSession, abort: boolean): void => {
		if (abort) void requestAbort(session);
		if (hardDisposals.has(session)) return;
		hardDisposals.add(session);
		try { void Promise.resolve(session.hardDispose()).catch(() => {}); } catch { /* terminal result remains authoritative */ }
	};
	const clean = (session: ChildSession, abort: boolean, timeoutMs = cleanupTimeoutMs): Promise<void> => {
		const existing = cleanups.get(session);
		if (existing) return existing;
		const cleanup = (async () => {
			if (timeoutMs <= 0) {
				forceHardDispose(session, abort);
				return;
			}
			const graceful = (async () => {
				if (abort) await requestAbort(session);
				try { await session.dispose(); } catch { /* hard cleanup follows */ }
			})();
			if (await Promise.race([graceful.then(() => true), delay(timeoutMs).then(() => false)])) return;
			// Releasing the raw session is post-deadline best effort: do not let a
			// broken, never-settling hard disposer extend the cleanup deadline.
			forceHardDispose(session, abort);
		})();
		cleanups.set(session, cleanup);
		return cleanup;
	};
	const disposeFactory = () => {
		if (!ownsFactory) return Promise.resolve();
		factoryDisposal ??= Promise.race([
			Promise.resolve().then(() => factory.dispose()).catch(() => {}),
			delay(cleanupTimeoutMs),
		]).then(() => {});
		return factoryDisposal;
	};
	return {
		async launch(request: ForegroundLaunchRequest): Promise<ForegroundResult> {
			if (disposed) return errorResult("aborted", "kernel_disposed", "Foreground kernel is disposed.");
			let resolved: ReturnType<typeof validate>;
			try { resolved = validate(request, baseCwd); } catch (error) { return errorResult("failed", "invalid_request", error); }
			if (request.signal?.aborted) return errorResult("aborted", "aborted", "Launch was aborted by the caller.");
			let storage: ChildSessionLaunch["storage"] = { kind: "memory" };
			if (resolved.context === "fork") {
				try {
					const source = options.forkSource;
					if (!source?.getSessionFile()) throw new Error("Fork context requires a persisted parent session.");
					const leaf = source.getLeafId();
					if (!leaf) throw new Error("Fork context requires a current parent leaf.");
					const sessionFile = source.createBranchedSession(leaf);
					if (!sessionFile) throw new Error("Pi did not return a forked session file.");
					storage = { kind: "file", sessionFile };
				} catch (error) { return errorResult("failed", "fork_failed", error); }
			}
			const startup = new AbortController();
			let outcome: TerminalOutcome | undefined;
			let cleanupDeadline = Number.POSITIVE_INFINITY;
			const remainingCleanupMs = () => Math.max(0, cleanupDeadline - Date.now());
			let resolveOutcome!: (outcome: TerminalOutcome) => void;
			const outcomePromise = new Promise<TerminalOutcome>((resolve) => { resolveOutcome = resolve; });
			let timer: NodeJS.Timeout | undefined;
			const state: ActiveLaunch = { terminate: (next) => {
				if (outcome) return;
				outcome = next;
				cleanupDeadline = Date.now() + cleanupTimeoutMs;
				if (timer) clearTimeout(timer);
				request.signal?.removeEventListener("abort", onAbort);
				startup.abort(next);
				resolveOutcome(next);
			} };
			const onAbort = () => state.terminate({ status: "aborted", code: "aborted", error: "Launch was aborted by the caller." });
			active.add(state);
			request.signal?.addEventListener("abort", onAbort, { once: true });
			if (resolved.timeoutMs !== undefined) timer = setTimeout(() => state.terminate({ status: "timed_out", error: `Launch timed out after ${resolved.timeoutMs}ms.` }), resolved.timeoutMs);
			if (disposed) state.terminate({ status: "aborted", code: "kernel_disposed", error: "Foreground kernel is disposed." });
			else if (request.signal?.aborted) onAbort();
			const launch: ChildSessionLaunch = {
				cwd: resolved.cwd, storage, ...(request.model ?? request.agent.model ? { model: request.model ?? request.agent.model } : {}),
				...((request.thinking ?? request.agent.thinking) ? { thinking: (request.thinking ?? request.agent.thinking) as ThinkingLevel } : {}),
				...(request.agent.tools ? { tools: [...request.agent.tools] } : {}), extensionPaths: [...(request.agent.extensions ?? [])],
				skillPaths: [...(request.agent.skills ?? [])],
				...(request.agent.systemPrompt ? { systemPrompt: request.agent.systemPrompt } : {}), signal: startup.signal,
			};
			let creation: Promise<ChildSession>;
			try { creation = Promise.resolve(factory.create(launch)); }
			catch (error) { creation = Promise.reject(error); }
			let messageBaseline = 0;
			const pending = creation.then(async (session) => {
				state.session = session;
				messageBaseline = session.messages.length;
				if (outcome) { await clean(session, true, remainingCleanupMs()); return; }
				let prompting: Promise<void>;
				try { prompting = Promise.resolve(session.prompt(request.task)); }
				catch (error) { prompting = Promise.reject(error); }
				void prompting.then(
					() => state.terminate({ status: "completed" }),
					(error) => state.terminate({ status: "failed", code: "prompt_failed", error }),
				);
			}, (error) => state.terminate({ status: "failed", code: "startup_failed", error })).then(() => {});
			pendingCreations.add(pending); void pending.finally(() => pendingCreations.delete(pending));
			const settled = await outcomePromise;
			// If cancellation won during startup, let this launch's factory observe the
			// signal and finish its own cleanup before returning, up to the shared bound.
			if (!state.session) await Promise.race([pending, delay(remainingCleanupMs())]);
			const session = state.session;
			const projection = session ? normalizedSession(session, messageBaseline) : { output: "" };
			if (session) {
				const remaining = remainingCleanupMs();
				if (remaining > 0) await clean(session, settled.status !== "completed", remaining);
				else forceHardDispose(session, settled.status !== "completed");
			}
			active.delete(state);
			if (settled.status === "completed") return { status: "completed", ...projection };
			return { ...errorResult(settled.status, settled.status === "failed" ? settled.code : settled.status === "aborted" ? settled.code : "timed_out", settled.error, projection.output), ...(projection.usage ? { usage: projection.usage } : {}) };
		},
		async dispose(): Promise<void> {
			disposed = true;
			const launches = [...active];
			for (const launch of launches) launch.terminate({ status: "aborted", code: "kernel_disposed", error: "Foreground kernel is disposed." });
			await Promise.allSettled(launches.map((launch) => launch.session ? clean(launch.session, true) : Promise.resolve()));
			const pending = [...pendingCreations];
			if (pending.length) await Promise.race([Promise.allSettled(pending), delay(cleanupTimeoutMs)]);
			await disposeFactory();
		},
	};
}

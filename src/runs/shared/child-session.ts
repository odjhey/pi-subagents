/**
 * In-process child sessions.
 *
 * A child is a foreground pi `AgentSession` created inside the parent process.
 * The factory is injectable so tests can script a child without the real runtime;
 * the default implementation wraps `createAgentSession` from a pi package module.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { getAgentDir } from "../../shared/utils.ts";
import type { ThinkingLevel } from "../../shared/model-info.ts";

export interface ChildSessionExtensionError {
	extensionPath: string;
	event: string;
	error: unknown;
}

export type ChildSessionStorage =
	| { kind: "file"; sessionFile: string }
	| { kind: "memory" };

export interface ChildSessionLaunch {
	cwd: string;
	storage: ChildSessionStorage;
	/** Model reference as the agent config names it (`provider/id`, optionally `:thinking`). */
	model?: string;
	/** Explicit Pi thinking level, including when the default model is used. */
	thinking?: ThinkingLevel;
	/** Explicit tool allowlist; undefined keeps pi's defaults. */
	tools?: string[];
	/** Exact extension files loaded for this child. Ambient extension discovery remains disabled. */
	extensionPaths: string[];
	/** Exact Pi-native skill paths. Ambient skill discovery remains disabled. */
	skillPaths: string[];
	systemPrompt?: string;
	/** Startup cancellation owned by the launch host. Factories should checkpoint it. */
	signal?: AbortSignal;
	onExtensionError?: (error: ChildSessionExtensionError) => void;
}

export interface ChildSession {
	/** Resolves when the run ends, including after abort. */
	prompt(text: string): Promise<void>;
	abort(): Promise<void>;
	/** Emits `session_shutdown` to the child's extensions and disposes the session; resolves once that shutdown work is done. */
	dispose(): Promise<void>;
	/** Immediately release the underlying Pi session when graceful shutdown exceeds its deadline. */
	hardDispose(): void | Promise<void>;
	readonly messages: readonly AgentMessage[];
}

export interface ChildSessionFactory {
	create(launch: ChildSessionLaunch): Promise<ChildSession>;
	/** Abort and dispose every live child. */
	dispose(): Promise<void>;
}

export type PiCodingAgentModule = typeof import("@earendil-works/pi-coding-agent");

export interface DefaultChildSessionFactoryOptions {
	/**
	 * Loads the pi package the sessions are created from. Production uses the
	 * host's in-process module; tests may inject a compatible module.
	 */
	loadPiCodingAgent?: () => Promise<PiCodingAgentModule>;
	/** Upper bound on a disposed child's `session_shutdown` handlers before the session is dropped anyway. */
	shutdownTimeoutMs?: number;
}

type ModelRuntimeInstance = Awaited<ReturnType<PiCodingAgentModule["ModelRuntime"]["create"]>>;
type QueuedProviderRegistration = { name: string; config: Parameters<ModelRuntimeInstance["registerProvider"]>[1]; extensionPath: string };
type QueuedNativeProviderRegistration = { provider: Parameters<ModelRuntimeInstance["registerNativeProvider"]>[0]; extensionPath: string };

interface LoaderWithExtensions {
	getExtensions(): {
		runtime: {
			pendingProviderRegistrations: QueuedProviderRegistration[];
			pendingNativeProviderRegistrations: QueuedNativeProviderRegistration[];
		};
	};
}

const CHILD_CONTEXT_KEY = Symbol.for("pi-subagents.child-context.v1");
const childContextGlobals = globalThis as unknown as Record<symbol, AsyncLocalStorage<boolean> | undefined>;
const childContext = childContextGlobals[CHILD_CONTEXT_KEY] ??= new AsyncLocalStorage<boolean>();

/** True for an explicit child load, including late async extension-loader continuations. */
export function isSubagentChildContext(): boolean {
	return process.env.PI_SUBAGENT_CHILD === "1" || childContext.getStore() === true;
}

function runInSubagentChildContext<T>(operation: () => T): T {
	return childContext.run(true, operation);
}

/** Serialize extension reload and binding because Pi's in-process extension cache is global. */
let loading: Promise<unknown> = Promise.resolve();

/**
 * pi caches extension factories per process and clears that cache only when a
 * loader reloads a second time, so every child in one process would share each
 * extension's module state. Marking the child's loader as already loaded makes
 * its first `reload()` clear the cache, so the child gets its own instances the
 * way a separate process had them. The flag is a private field of pi's loader.
 */
function resetExtensionCacheOnReload(loader: object): boolean {
	if (!("loaded" in loader)) return false;
	(loader as { loaded: boolean }).loaded = true;
	return true;
}

function applyProcessEnv(values: Record<string, string | undefined> | undefined): void {
	if (!values) return;
	for (const [name, value] of Object.entries(values)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
	if (!signal) return operation;
	if (signal.aborted) return Promise.reject(signal.reason ?? new Error("Child startup aborted."));
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(signal.reason ?? new Error("Child startup aborted."));
		signal.addEventListener("abort", onAbort, { once: true });
		operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort)).catch(() => {});
	});
}

function flushQueuedProviderRegistrations(loader: object, modelRuntime: ModelRuntimeInstance, onError: ((error: ChildSessionExtensionError) => void) | undefined): void {
	if (!("getExtensions" in loader) || typeof loader.getExtensions !== "function") return;
	const { runtime } = (loader as LoaderWithExtensions).getExtensions();
	for (const { name, config, extensionPath } of runtime.pendingProviderRegistrations) {
		try {
			modelRuntime.registerProvider(name, config);
		} catch (error) {
			onError?.({ extensionPath, event: "register_provider", error });
		}
	}
	runtime.pendingProviderRegistrations = [];
	for (const { provider, extensionPath } of runtime.pendingNativeProviderRegistrations) {
		try {
			modelRuntime.registerNativeProvider(provider);
		} catch (error) {
			onError?.({ extensionPath, event: "register_provider", error });
		}
	}
	runtime.pendingNativeProviderRegistrations = [];
}

type ChildExtensionRunner = {
	hasHandlers(event: "session_shutdown"): boolean;
	emit(event: { type: "session_shutdown"; reason: "quit" }): Promise<unknown>;
	invalidate(): void;
};

function ownChildLifecycle(
	getRunner: () => ChildExtensionRunner | undefined,
	getSession: () => { dispose(): void | Promise<void> } | undefined,
	timeoutMs: number,
	onError: ((error: ChildSessionExtensionError) => void) | undefined,
): { shutdown(timeoutOverrideMs?: number): Promise<void>; hardDispose(): void } {
	let disposal: Promise<void> | undefined;
	let shutdown: Promise<void> | undefined;
	const invalidate = () => { try { getRunner()?.invalidate(); } catch { /* best effort */ } };
	const disposeSession = () => {
		const session = getSession();
		if (!session) return Promise.resolve();
		disposal ??= Promise.resolve().then(() => session.dispose()).catch(() => {});
		return disposal;
	};
	const hardDispose = () => { invalidate(); void disposeSession(); };
	return {
		shutdown(timeoutOverrideMs = timeoutMs) {
			shutdown ??= (async () => {
				const shutdownBudgetMs = Math.max(0, Math.min(timeoutOverrideMs, timeoutMs));
				if (shutdownBudgetMs <= 0) {
					hardDispose();
					return;
				}
				const work = (async () => {
					const runner = getRunner();
					try {
						if (runner?.hasHandlers("session_shutdown")) await runner.emit({ type: "session_shutdown", reason: "quit" });
					} catch (error) {
						onError?.({ extensionPath: "<session>", event: "session_shutdown", error });
					} finally {
						invalidate();
						await disposeSession();
					}
				})();
				let timer: NodeJS.Timeout | undefined;
				const completed = await Promise.race([
					work.then(() => true),
					new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), shutdownBudgetMs); }),
				]);
				if (timer) clearTimeout(timer);
				if (!completed) hardDispose();
			})();
			return shutdown;
		},
		hardDispose,
	};
}

/** Default factory: real pi sessions with an isolated `ModelRuntime` per child. */
export function createDefaultChildSessionFactory(options: DefaultChildSessionFactoryOptions = {}): ChildSessionFactory {
	const loadPiCodingAgent = options.loadPiCodingAgent ?? (() => import("@earendil-works/pi-coding-agent"));
	const shutdownTimeoutMs = Math.max(0, Math.min(options.shutdownTimeoutMs ?? 5_000, 5_000));
	const live = new Set<ChildSession>();
	/** Extension shutdowns still running for disposed children; `dispose()` waits for them. */
	const shutdowns = new Set<Promise<void>>();
	let disposal: Promise<void> | undefined;
	return {
		async create(launch) {
			const pi = await loadPiCodingAgent();
			if (launch.signal?.aborted) throw launch.signal.reason ?? new Error("Child startup aborted.");
			// Provider registrations are mutable, so isolated children receive isolated runtimes.
			const modelRuntime = await pi.ModelRuntime.create();
			if (launch.signal?.aborted) throw launch.signal.reason ?? new Error("Child startup aborted.");
			const agentDir = getAgentDir();
			const settingsManager = pi.SettingsManager.create(launch.cwd, agentDir);
			const loader = new pi.DefaultResourceLoader({
				cwd: launch.cwd,
				agentDir,
				settingsManager,
				noExtensions: true,
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
				noContextFiles: true,
				additionalExtensionPaths: launch.extensionPaths,
				additionalSkillPaths: launch.skillPaths,
				...(launch.systemPrompt !== undefined ? { systemPrompt: launch.systemPrompt } : {}),
			});
			const open = async () => {
				const environment = { PI_SUBAGENT_CHILD: "1" };
				const previous = Object.fromEntries(Object.keys(environment).map((name) => [name, process.env[name]]));
				applyProcessEnv(environment);
				const sessionManager = launch.storage.kind === "file"
					? pi.SessionManager.open(launch.storage.sessionFile, undefined, launch.cwd)
					: pi.SessionManager.inMemory(launch.cwd);
				let session: Awaited<ReturnType<PiCodingAgentModule["createAgentSession"]>>["session"] | undefined;
				let emergencyRunner: InstanceType<PiCodingAgentModule["ExtensionRunner"]> | undefined;
				let interruptedBind: Promise<void> | undefined;
				let lateSessionCreation: ReturnType<PiCodingAgentModule["createAgentSession"]> | undefined;
				const runnerForLoadedExtensions = () => {
					const loaded = loader.getExtensions();
					return new pi.ExtensionRunner(loaded.extensions, loaded.runtime, launch.cwd, sessionManager, new pi.ModelRegistry(modelRuntime));
				};
				const lifecycle = ownChildLifecycle(
					() => (session?.extensionRunner ?? emergencyRunner) as ChildExtensionRunner | undefined,
					() => session,
					shutdownTimeoutMs,
					launch.onExtensionError,
				);
				try {
					try {
						if (!resetExtensionCacheOnReload(loader) && launch.extensionPaths.length) launch.onExtensionError?.({ extensionPath: "<loader>", event: "load", error: new Error("pi's extension cache reset is unavailable; extensions loaded into this child share module state with other sessions in this process.") });
						if (launch.signal) emergencyRunner = runnerForLoadedExtensions();
						const reload = Promise.resolve().then(() => loader.reload());
						try {
							await abortable(reload, launch.signal);
						} catch (error) {
							if (launch.signal?.aborted) {
								void reload.then(async () => {
									const lateRunner = runnerForLoadedExtensions();
									await ownChildLifecycle(() => lateRunner as ChildExtensionRunner, () => undefined, shutdownTimeoutMs, launch.onExtensionError).shutdown();
								}, () => {}).catch(() => {});
							} else {
								emergencyRunner = runnerForLoadedExtensions();
							}
							throw error;
						}
						try { emergencyRunner?.invalidate(); } catch { /* initial empty runtime */ }
						emergencyRunner = runnerForLoadedExtensions();
						if (launch.signal?.aborted) throw launch.signal.reason ?? new Error("Child startup aborted.");
						flushQueuedProviderRegistrations(loader, modelRuntime, launch.onExtensionError);
						const resolvedModel = launch.model ? pi.resolveCliModel({ cliModel: launch.model, modelRuntime }) : undefined;
						if (resolvedModel?.error) throw new Error(resolvedModel.error);
						const creating = Promise.resolve().then(() => pi.createAgentSession({
							cwd: launch.cwd, agentDir, modelRuntime,
							...(resolvedModel?.model ? { model: resolvedModel.model } : {}),
							...((launch.thinking ?? resolvedModel?.thinkingLevel) ? { thinkingLevel: launch.thinking ?? resolvedModel?.thinkingLevel } : {}),
							...(launch.tools ? { tools: launch.tools } : {}), resourceLoader: loader, sessionManager, settingsManager,
							sessionStartEvent: { type: "session_start", reason: "startup" },
						}));
						try {
							session = (await abortable(creating, launch.signal)).session;
						} catch (error) {
							if (launch.signal?.aborted) lateSessionCreation = creating;
							throw error;
						}
						emergencyRunner = undefined;
						if (launch.signal?.aborted) throw launch.signal.reason ?? new Error("Child startup aborted.");
						const bind = Promise.resolve().then(() => session!.bindExtensions({ mode: "print", onError: (error) => launch.onExtensionError?.({ extensionPath: error.extensionPath, event: error.event, error: error.error }) }));
						try {
							await abortable(bind, launch.signal);
						} catch (error) {
							if (launch.signal?.aborted) interruptedBind = bind;
							throw error;
						}
						if (launch.signal?.aborted) throw launch.signal.reason ?? new Error("Child startup aborted.");
						return { session, lifecycle };
					} catch (error) {
						const cleanupDeadline = Date.now() + shutdownTimeoutMs;
						if (interruptedBind) {
							let timer: NodeJS.Timeout | undefined;
							await Promise.race([
								interruptedBind.then(() => undefined, () => undefined),
								new Promise<void>((resolve) => { timer = setTimeout(resolve, shutdownTimeoutMs); }),
							]);
							if (timer) clearTimeout(timer);
						}
						await lifecycle.shutdown(Math.max(0, cleanupDeadline - Date.now()));
						if (lateSessionCreation) {
							void lateSessionCreation.then(async ({ session: lateSession }) => {
								try { lateSession.extensionRunner.invalidate(); } catch { /* best effort */ }
								try { await lateSession.dispose(); } catch { /* best effort */ }
							}, () => {}).catch(() => {});
						}
						throw error;
					}
				} finally {
					applyProcessEnv(previous);
				}
			};
			const opened = loading.catch(() => {}).then(() => runInSubagentChildContext(open));
			loading = opened;
			const { session, lifecycle } = await opened;
			let pending: Promise<void> | undefined;
			const child: ChildSession = {
				prompt: (text) => session.prompt(text),
				abort: () => session.abort(),
				dispose: () => {
					if (!pending) {
						live.delete(child);
						pending = lifecycle.shutdown();
						shutdowns.add(pending);
						void pending.then(() => shutdowns.delete(pending!), () => shutdowns.delete(pending!));
					}
					return pending;
				},
				hardDispose: () => { live.delete(child); lifecycle.hardDispose(); },
				get messages() { return session.messages; },
			};
			live.add(child);
			return child;
		},
		async dispose() {
			if (disposal) return disposal;
			const current = (async () => {
				const children = [...live];
				await Promise.allSettled(children.map((child) => child.abort()));
				for (const child of children) {
					try { void child.dispose(); } catch { /* best effort */ }
				}
				await Promise.allSettled([...shutdowns]);
			})();
			disposal = current;
			try { await current; } finally { if (disposal === current) disposal = undefined; }
		},
	};
}

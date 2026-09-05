import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ConfiguredAgentDefinition } from "../../src/agents/discovery.ts";
import registerExtension from "../../src/extension/index.ts";
import { createForegroundKernel } from "../../src/runs/foreground/kernel.ts";
import { createDefaultChildSessionFactory, type ChildSessionLaunch, type PiCodingAgentModule } from "../../src/runs/shared/child-session.ts";

const launch: ChildSessionLaunch = { cwd: "/work", storage: { kind: "memory" }, extensionPaths: ["/ext.ts"], skillPaths: ["/skill.md"], tools: ["read"], model: "vendor/model", thinking: "high", systemPrompt: "system" };

type StubOptions = {
	bind?: () => Promise<void>;
	createError?: Error;
	reload?: () => Promise<void>;
	reloadError?: Error;
	resolveError?: string;
	shutdown?: () => Promise<void>;
};

function stub(options: StubOptions = {}) {
	const seen = { runtimes: 0, disposed: 0, aborted: 0, reloadEnv: [] as Array<string | undefined>, bindEnv: [] as Array<string | undefined>, shutdowns: 0, invalidations: 0, resourceLive: false, listenerLive: false };
	let loaderOptions: any;
	let sessionOptions: any;
	const runtime = { pendingProviderRegistrations: [], pendingNativeProviderRegistrations: [] };
	const extensions = [{ handlers: new Map([["session_shutdown", [async () => { seen.shutdowns++; await options.shutdown?.(); seen.resourceLive = false; }]]]) }];
	class Loader {
		loaded = false;
		constructor(value: any) { loaderOptions = value; }
		async reload() {
			seen.reloadEnv.push(process.env.PI_SUBAGENT_CHILD);
			assert.equal(this.loaded, true);
			seen.resourceLive = true;
			seen.listenerLive = true;
			await options.reload?.();
			if (options.reloadError) throw options.reloadError;
		}
		getExtensions() { return { extensions, runtime }; }
	}
	class Runner {
		readonly loaded: typeof extensions;
		constructor(loaded = extensions) { this.loaded = loaded; }
		hasHandlers(name: string) { return this.loaded.some(extension => extension.handlers.has(name)); }
		async emit(event: { type: string }) {
			for (const extension of this.loaded) for (const handler of extension.handlers.get(event.type) ?? []) await handler();
		}
		invalidate() { seen.invalidations++; seen.listenerLive = false; }
	}
	const session = {
		messages: [],
		extensionRunner: new Runner(),
		prompt: async () => {},
		abort: async () => { seen.aborted++; },
		dispose: async () => { seen.disposed++; },
		bindExtensions: async () => { seen.bindEnv.push(process.env.PI_SUBAGENT_CHILD); await options.bind?.(); },
	};
	const pi = {
		ModelRuntime: { create: async () => { seen.runtimes++; return { registerProvider() {}, registerNativeProvider() {} }; } },
		SettingsManager: { create: () => ({}) },
		DefaultResourceLoader: Loader,
		SessionManager: { inMemory: (cwd: string) => ({ memory: cwd }), open: () => ({}) },
		ModelRegistry: class { constructor(_runtime: unknown) {} },
		ExtensionRunner: Runner,
		resolveCliModel: () => options.resolveError ? { error: options.resolveError } : { model: { provider: "vendor", id: "model" }, thinkingLevel: "low" },
		createAgentSession: async (value: any) => {
			sessionOptions = value;
			if (options.createError) throw options.createError;
			return { session };
		},
	} as unknown as PiCodingAgentModule;
	return { pi, seen, values: () => ({ loaderOptions, sessionOptions }) };
}

function assertReleased(seen: ReturnType<typeof stub>["seen"], sessionCreated: boolean, expectedInvalidations = 1) {
	assert.equal(seen.shutdowns, 1);
	assert.equal(seen.resourceLive, false);
	assert.equal(seen.listenerLive, false);
	assert.equal(seen.invalidations, expectedInvalidations);
	assert.equal(seen.disposed, sessionCreated ? 1 : 0);
	assert.notEqual(process.env.PI_SUBAGENT_CHILD, "1");
}

test("default factory creates an exactly isolated fresh child and cleans it once", async () => {
	const s = stub();
	const previous = process.env.PI_SUBAGENT_CHILD;
	process.env.PI_SUBAGENT_CHILD = "parent-value";
	try {
		const factory = createDefaultChildSessionFactory({ loadPiCodingAgent: async () => s.pi });
		const child = await factory.create(launch);
		const { loaderOptions, sessionOptions } = s.values();
		assert.deepEqual(s.seen.reloadEnv, ["1"]);
		assert.deepEqual(s.seen.bindEnv, ["1"]);
		assert.equal(process.env.PI_SUBAGENT_CHILD, "parent-value");
		assert.deepEqual({ noExtensions: loaderOptions.noExtensions, noSkills: loaderOptions.noSkills, noPromptTemplates: loaderOptions.noPromptTemplates, noThemes: loaderOptions.noThemes, noContextFiles: loaderOptions.noContextFiles }, { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
		assert.deepEqual(loaderOptions.additionalExtensionPaths, ["/ext.ts"]);
		assert.deepEqual(loaderOptions.additionalSkillPaths, ["/skill.md"]);
		assert.equal(loaderOptions.systemPrompt, "system");
		assert.deepEqual(sessionOptions.sessionManager, { memory: "/work" });
		assert.deepEqual(sessionOptions.tools, ["read"]);
		assert.deepEqual(sessionOptions.model, { provider: "vendor", id: "model" });
		assert.equal(sessionOptions.thinkingLevel, "high");
		await Promise.all([child.dispose(), child.dispose()]);
		assertReleased(s.seen, true);
		await factory.dispose();
		assert.equal(s.seen.disposed, 1);
		assert.equal(s.seen.runtimes, 1);
	} finally {
		if (previous === undefined) delete process.env.PI_SUBAGENT_CHILD;
		else process.env.PI_SUBAGENT_CHILD = previous;
	}
});

test("model-resolution failure shuts down loaded extensions without a session", async () => {
	const s = stub({ resolveError: "unavailable" });
	const factory = createDefaultChildSessionFactory({ loadPiCodingAgent: async () => s.pi });
	await assert.rejects(factory.create(launch), /unavailable/);
	assert.equal(s.values().sessionOptions, undefined);
	assertReleased(s.seen, false);
});

test("session-creation failure shuts down loaded extensions", async () => {
	const s = stub({ createError: new Error("create failed") });
	const factory = createDefaultChildSessionFactory({ loadPiCodingAgent: async () => s.pi });
	await assert.rejects(factory.create(launch), /create failed/);
	assertReleased(s.seen, false);
});

test("resource reload failure shuts down the partially loaded extension runtime", async () => {
	const s = stub({ reloadError: new Error("reload failed") });
	const factory = createDefaultChildSessionFactory({ loadPiCodingAgent: async () => s.pi });
	await assert.rejects(factory.create(launch), /reload failed/);
	assertReleased(s.seen, false);
});

test("bind rejection shuts down extensions and disposes the created session", async () => {
	const s = stub({ bind: async () => { throw new Error("bind failed"); } });
	const factory = createDefaultChildSessionFactory({ loadPiCodingAgent: async () => s.pi });
	await assert.rejects(factory.create(launch), /bind failed/);
	assertReleased(s.seen, true);
});

test("never-settling reload cancellation restores globals, releases the queue, and keeps late imports isolated", async () => {
	let releaseReload!: () => void;
	const reloadGate = new Promise<void>((resolve) => { releaseReload = resolve; });
	let reloads = 0;
	const lateTools: string[] = [];
	const s = stub({ reload: async () => {
		if (reloads++ !== 0) return;
		await reloadGate;
		registerExtension({ registerTool: (tool: { name: string }) => lateTools.push(tool.name), on() {} } as any);
	} });
	const previous = process.env.PI_SUBAGENT_CHILD;
	process.env.PI_SUBAGENT_CHILD = "parent-value";
	try {
		const controller = new AbortController();
		const factory = createDefaultChildSessionFactory({ loadPiCodingAgent: async () => s.pi, shutdownTimeoutMs: 5 });
		const first = factory.create({ ...launch, signal: controller.signal });
		await new Promise(resolve => setImmediate(resolve));
		controller.abort(new Error("cancelled reload"));
		await assert.rejects(first, /cancelled reload/);
		assert.equal(process.env.PI_SUBAGENT_CHILD, "parent-value");
		const second = await factory.create(launch);
		await second.dispose();
		assert.equal(reloads, 2);
		releaseReload();
		await new Promise(resolve => setImmediate(resolve));
		await new Promise(resolve => setImmediate(resolve));
		assert.deepEqual(lateTools, []);
		assert.equal(process.env.PI_SUBAGENT_CHILD, "parent-value");
		await factory.dispose();
	} finally {
		releaseReload();
		if (previous === undefined) delete process.env.PI_SUBAGENT_CHILD;
		else process.env.PI_SUBAGENT_CHILD = previous;
	}
});

test("never-settling bind cancellation is bounded and restores the child environment", async () => {
	const s = stub({ bind: () => new Promise(() => {}) });
	const controller = new AbortController();
	const factory = createDefaultChildSessionFactory({ loadPiCodingAgent: async () => s.pi, shutdownTimeoutMs: 5 });
	const pending = factory.create({ ...launch, signal: controller.signal });
	await new Promise(resolve => setImmediate(resolve));
	controller.abort(new Error("cancelled"));
	await assert.rejects(pending, /cancelled/);
	assert.equal(s.seen.shutdowns, 0);
	assert.equal(s.seen.invalidations, 2);
	assert.equal(s.seen.listenerLive, false);
	assert.equal(s.seen.disposed, 1);
	assert.notEqual(process.env.PI_SUBAGENT_CHILD, "1");
});

test("kernel timeout waits for late bind settlement, extension shutdown, and disposal", async () => {
	let releaseBind!: () => void;
	let releaseShutdown!: () => void;
	const bindGate = new Promise<void>((resolve) => { releaseBind = resolve; });
	const shutdownGate = new Promise<void>((resolve) => { releaseShutdown = resolve; });
	const s = stub({ bind: () => bindGate, shutdown: () => shutdownGate });
	const factory = createDefaultChildSessionFactory({ loadPiCodingAgent: async () => s.pi, shutdownTimeoutMs: 100 });
	const kernel = createForegroundKernel({ factory, defaultCwd: process.cwd(), cleanupTimeoutMs: 100 });
	const agent: ConfiguredAgentDefinition = { name: "worker", description: "", systemPrompt: "", model: "vendor/model", source: "runtime", filePath: "runtime:worker" };
	const resultPromise = kernel.launch({ agent, task: "wait", timeoutMs: 2 });
	await new Promise(resolve => setTimeout(resolve, 10));
	let settled = false; void resultPromise.then(() => { settled = true; }); await Promise.resolve();
	assert.equal(settled, false);
	assert.equal(s.seen.shutdowns, 0);
	releaseBind();
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(s.seen.shutdowns, 1);
	assert.equal(s.seen.disposed, 0);
	assert.equal(settled, false);
	releaseShutdown();
	assert.equal((await resultPromise).status, "timed_out");
	assert.equal(s.seen.disposed, 1);
	await kernel.dispose();
});

test("real Pi runtime shuts down an explicit extension after pre-session model failure", async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "real-child-lifecycle-"));
	const state = path.join(root, "state.txt");
	const extension = path.join(root, "lifecycle.ts");
	fs.writeFileSync(extension, `import fs from "node:fs";\nexport default function(pi) { fs.appendFileSync(${JSON.stringify(state)}, "start\\n"); pi.on("session_shutdown", () => fs.appendFileSync(${JSON.stringify(state)}, "shutdown\\n")); }\n`);
	try {
		const factory = createDefaultChildSessionFactory({ shutdownTimeoutMs: 1_000 });
		await assert.rejects(factory.create({ cwd: root, storage: { kind: "memory" }, extensionPaths: [extension], skillPaths: [], model: "definitely-missing-provider/definitely-missing-model" }), /not found/i);
		assert.equal(fs.readFileSync(state, "utf8"), "start\nshutdown\n");
		await factory.dispose();
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

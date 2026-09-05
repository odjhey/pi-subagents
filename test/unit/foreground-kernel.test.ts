import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConfiguredAgentDefinition } from "../../src/agents/discovery.ts";
import { createForegroundKernel, FOREGROUND_ERROR_MAX_BYTES, FOREGROUND_OUTPUT_MAX_BYTES, FOREGROUND_TRUNCATION_MARKER } from "../../src/runs/foreground/kernel.ts";
import type { ChildSession, ChildSessionFactory, ChildSessionLaunch } from "../../src/runs/shared/child-session.ts";

const agent: ConfiguredAgentDefinition = { name: "worker", description: "", systemPrompt: "Be useful.", source: "runtime", filePath: "runtime:worker" };

function fixture(options: { messages?: unknown[]; inheritedMessages?: unknown[]; prompt?: () => Promise<void> } = {}) {
	const launches: ChildSessionLaunch[] = [];
	let prompts = 0;
	let aborts = 0;
	let disposals = 0;
	const messages = [...(options.inheritedMessages ?? [])];
	const session: ChildSession = {
		prompt: async () => { prompts++; await (options.prompt?.() ?? Promise.resolve()); messages.push(...(options.messages ?? [])); },
		abort: async () => { aborts++; }, dispose: async () => { disposals++; }, hardDispose: () => {},
		messages: messages as ChildSession["messages"],
	};
	const factory: ChildSessionFactory = { create: async (launch) => { launches.push(launch); return session; }, dispose: async () => {} };
	return { factory, launches, counts: () => ({ prompts, aborts, disposals }) };
}

test("foreground kernel creates and prompts one fresh isolated child", async () => {
	const fake = fixture({ messages: [{ role: "assistant", content: [{ type: "text", text: "done" }] }] });
	const kernel = createForegroundKernel({ factory: fake.factory });
	assert.deepEqual(await kernel.launch({ agent, task: "work" }), { status: "completed", output: "done" });
	assert.equal(fake.launches.length, 1);
	assert.equal(fake.counts().prompts, 1);
	assert.deepEqual(fake.launches[0]!.storage, { kind: "memory" });
	assert.equal(fake.counts().disposals, 1);
});

test("explicit fork uses exactly one Pi branch while fresh never does", async () => {
	let branches = 0;
	const fake = fixture();
	const kernel = createForegroundKernel({ factory: fake.factory, forkSource: { getSessionFile: () => "/parent.jsonl", getLeafId: () => "leaf", createBranchedSession: (leaf) => { assert.equal(leaf, "leaf"); branches++; return "/fork.jsonl"; } } });
	await kernel.launch({ agent, task: "fresh" });
	await kernel.launch({ agent, task: "fork", context: "fork" });
	assert.equal(branches, 1);
	assert.deepEqual(fake.launches.map((launch) => launch.storage), [{ kind: "memory" }, { kind: "file", sessionFile: "/fork.jsonl" }]);
});

test("fork results exclude inherited parent output and usage", async () => {
	const fake = fixture({
		inheritedMessages: [{ role: "assistant", content: [{ type: "text", text: "parent output" }], usage: { input: 100, output: 200, cost: { total: 9 } } }],
		messages: [{ role: "assistant", content: [{ type: "text", text: "child output" }], usage: { input: 2, output: 3, cost: { total: 0.25 } } }],
	});
	const kernel = createForegroundKernel({ factory: fake.factory, forkSource: { getSessionFile: () => "/parent.jsonl", getLeafId: () => "leaf", createBranchedSession: () => "/fork.jsonl" } });
	assert.deepEqual(await kernel.launch({ agent, task: "fork", context: "fork" }), { status: "completed", output: "child output", usage: { inputTokens: 2, outputTokens: 3, costUsd: 0.25 } });
});

test("failed fork prompt cannot report inherited parent output or usage", async () => {
	const fake = fixture({
		inheritedMessages: [{ role: "assistant", content: [{ type: "text", text: "parent output" }], usage: { input: 100, output: 200, cost: { total: 9 } } }],
		prompt: async () => { throw new Error("child failed"); },
	});
	const kernel = createForegroundKernel({ factory: fake.factory, forkSource: { getSessionFile: () => "/parent.jsonl", getLeafId: () => "leaf", createBranchedSession: () => "/fork.jsonl" } });
	assert.deepEqual(await kernel.launch({ agent, task: "fork", context: "fork" }), { status: "failed", output: "", error: { code: "prompt_failed", message: "child failed" } });
});

test("validates before creating a session", async () => {
	const fake = fixture();
	const kernel = createForegroundKernel({ factory: fake.factory });
	const result = await kernel.launch({ agent, task: " " });
	assert.equal(result.status, "failed");
	assert.equal(result.error?.code, "invalid_request");
	assert.equal(fake.launches.length, 0);
});

test("timeout and caller abort are distinct and clean once", async () => {
	const pending = () => new Promise<void>(() => {});
	const timed = fixture({ prompt: pending });
	const timedResult = await createForegroundKernel({ factory: timed.factory }).launch({ agent, task: "wait", timeoutMs: 5 });
	assert.equal(timedResult.status, "timed_out");
	assert.deepEqual(timed.counts(), { prompts: 1, aborts: 1, disposals: 1 });
	const aborted = fixture({ prompt: pending });
	const controller = new AbortController();
	const resultPromise = createForegroundKernel({ factory: aborted.factory }).launch({ agent, task: "wait", signal: controller.signal });
	controller.abort();
	const abortedResult = await resultPromise;
	assert.equal(abortedResult.status, "aborted");
	assert.deepEqual(aborted.counts(), { prompts: 0, aborts: 1, disposals: 1 });
});

test("timeout waits for a late-created child to be cleaned without prompting", async () => {
	let resolveCreate!: (session: ChildSession) => void;
	let prompts = 0; let aborts = 0; let disposals = 0;
	const session: ChildSession = { prompt: async () => { prompts++; }, abort: async () => { aborts++; }, dispose: async () => { disposals++; }, hardDispose: () => {}, messages: [] };
	const factory: ChildSessionFactory = { create: () => new Promise((resolve) => { resolveCreate = resolve; }), dispose: async () => {} };
	const resultPromise = createForegroundKernel({ factory, cleanupTimeoutMs: 20 }).launch({ agent, task: "wait", timeoutMs: 2 });
	await new Promise((resolve) => setTimeout(resolve, 5));
	let settled = false; void resultPromise.then(() => { settled = true; }); await Promise.resolve(); assert.equal(settled, false);
	resolveCreate(session);
	const result = await resultPromise;
	assert.equal(result.status, "timed_out");
	assert.deepEqual({ prompts, aborts, disposals }, { prompts: 0, aborts: 1, disposals: 1 });
});

test("startup waiting and session cleanup share one absolute deadline", { timeout: 500 }, async () => {
	let resolveCreate!: (session: ChildSession) => void;
	let hardDisposals = 0;
	let createdAt = 0;
	let hardDisposedAt = 0;
	const session: ChildSession = { prompt: async () => {}, abort: async () => {}, dispose: () => new Promise(() => {}), hardDispose: () => { hardDisposals++; hardDisposedAt = Date.now(); }, messages: [] };
	const factory: ChildSessionFactory = { create: () => new Promise((resolve) => { resolveCreate = resolve; }), dispose: async () => {} };
	const resultPromise = createForegroundKernel({ factory, cleanupTimeoutMs: 100 }).launch({ agent, task: "wait", timeoutMs: 2 });
	setTimeout(() => { createdAt = Date.now(); resolveCreate(session); }, 60);
	assert.equal((await resultPromise).status, "timed_out");
	assert.ok(hardDisposedAt - createdAt < 75, "startup wait and cleanup must not receive separate 100ms budgets");
	assert.equal(hardDisposals, 1);
});

test("never-settling startup is bounded and factory ownership is explicit", async () => {
	let factoryDisposals = 0;
	const factory: ChildSessionFactory = { create: async () => new Promise<ChildSession>(() => {}), dispose: async () => { factoryDisposals++; } };
	const kernel = createForegroundKernel({ factory, cleanupTimeoutMs: 5 });
	assert.equal((await kernel.launch({ agent, task: "wait", timeoutMs: 2 })).status, "timed_out");
	await kernel.dispose();
	assert.equal(factoryDisposals, 0);
	const owned = createForegroundKernel({ factory, ownFactory: true });
	await Promise.all([owned.dispose(), owned.dispose()]);
	assert.equal(factoryDisposals, 1);
});

test("configured skill paths are exact and ambient discovery is disabled", async () => {
	const fake = fixture();
	await createForegroundKernel({ factory: fake.factory }).launch({ agent: { ...agent, skills: ["/one/SKILL.md", "/two/SKILL.md"] }, task: "work" });
	assert.deepEqual(fake.launches[0]!.skillPaths, ["/one/SKILL.md", "/two/SKILL.md"]);
});

test("terminal latch preserves timeout across late prompt rejection and bounds hard cleanup", async () => {
	let rejectPrompt!: (error: Error) => void; let hardDisposals = 0;
	const session: ChildSession = { prompt: () => new Promise((_, reject) => { rejectPrompt = reject; }), abort: async () => {}, dispose: async () => new Promise<void>(() => {}), hardDispose: () => { hardDisposals++; }, messages: [], sessionFile: undefined, sessionId: "stuck", modelId: undefined };
	const factory: ChildSessionFactory = { create: async () => session, dispose: async () => {} };
	const resultPromise = createForegroundKernel({ factory, cleanupTimeoutMs: 2 }).launch({ agent, task: "wait", timeoutMs: 2 });
	await new Promise((resolve) => setTimeout(resolve, 3));
	rejectPrompt(new Error("late rejection"));
	const result = await resultPromise;
	assert.equal(result.status, "timed_out");
	assert.equal(result.error?.code, "timed_out");
	assert.equal(hardDisposals, 1);
});

test("never-settling hard disposal cannot extend the cleanup deadline", { timeout: 500 }, async () => {
	const session: ChildSession = { prompt: () => new Promise(() => {}),
		abort: async () => {}, dispose: () => new Promise(() => {}), hardDispose: () => new Promise(() => {}),
		messages: [], sessionFile: undefined, sessionId: "never-hard-dispose", modelId: undefined,
	};
	const factory: ChildSessionFactory = { create: async () => session, dispose: async () => {} };
	const result = await createForegroundKernel({ factory, cleanupTimeoutMs: 2 }).launch({ agent, task: "wait", timeoutMs: 2 });
	assert.equal(result.status, "timed_out");
});

test("normalizes synchronous create and prompt throws without leaking active launches", async () => {
	const createError = new Error("sync create");
	const throwingFactory: ChildSessionFactory = { create: (() => { throw createError; }) as ChildSessionFactory["create"], dispose: async () => {} };
	const startup = await createForegroundKernel({ factory: throwingFactory }).launch({ agent, task: "work" });
	assert.deepEqual(startup.error, { code: "startup_failed", message: "sync create" });

	let disposed = 0;
	const session: ChildSession = { prompt: (() => { throw new Error("sync prompt"); }) as ChildSession["prompt"],
		abort: async () => {}, dispose: async () => { disposed++; }, hardDispose: () => {}, messages: [], sessionFile: undefined, sessionId: "sync-prompt", modelId: undefined,
	};
	const prompt = await createForegroundKernel({ factory: { create: async () => session, dispose: async () => {} } }).launch({ agent, task: "work" });
	assert.deepEqual(prompt.error, { code: "prompt_failed", message: "sync prompt" });
	assert.equal(disposed, 1);
});

test("cleanup consumes asynchronous hard-dispose and owned factory rejection", async () => {
	const session: ChildSession = { prompt: () => new Promise(() => {}),
		abort: async () => {}, dispose: () => new Promise(() => {}), hardDispose: async () => { throw new Error("hard dispose failed"); },
		messages: [], sessionFile: undefined, sessionId: "rejecting-cleanup", modelId: undefined,
	};
	const factory: ChildSessionFactory = { create: async () => session, dispose: async () => { throw new Error("factory dispose failed"); } };
	const kernel = createForegroundKernel({ factory, ownFactory: true, cleanupTimeoutMs: 2 });
	assert.equal((await kernel.launch({ agent, task: "wait", timeoutMs: 2 })).status, "timed_out");
	await assert.doesNotReject(Promise.all([kernel.dispose(), kernel.dispose()]));
});

test("disposal aborts an active child and remains idempotent", async () => {
	const fake = fixture({ prompt: () => new Promise<void>(() => {}) });
	const kernel = createForegroundKernel({ factory: fake.factory });
	const resultPromise = kernel.launch({ agent, task: "wait" });
	await new Promise((resolve) => setImmediate(resolve));
	await Promise.all([kernel.dispose(), kernel.dispose()]);
	assert.equal((await resultPromise).status, "aborted");
	assert.deepEqual(fake.counts(), { prompts: 1, aborts: 1, disposals: 1 });
});

test("bounds Unicode output and errors and projects only reported usage", async () => {
	const fake = fixture({ messages: [{ role: "assistant", content: [{ type: "text", text: "🙂".repeat(40_000) }], usage: { input: 2, output: 3, cacheRead: 4, cost: { total: 0.25 } } }] });
	const result = await createForegroundKernel({ factory: fake.factory }).launch({ agent, task: "work" });
	assert.ok(Buffer.byteLength(result.output) <= FOREGROUND_OUTPUT_MAX_BYTES);
	assert.ok(result.output.endsWith(FOREGROUND_TRUNCATION_MARKER));
	assert.equal(result.output.includes("�"), false);
	assert.deepEqual(result.usage, { inputTokens: 2, outputTokens: 3, cacheReadTokens: 4, costUsd: 0.25 });
	const failedFactory: ChildSessionFactory = { create: async () => { throw new Error("🙂".repeat(20_000)); }, dispose: async () => {} };
	const failed = await createForegroundKernel({ factory: failedFactory }).launch({ agent, task: "work" });
	assert.ok(Buffer.byteLength(failed.error!.message) <= FOREGROUND_ERROR_MAX_BYTES);
	assert.ok(failed.error!.message.endsWith(FOREGROUND_TRUNCATION_MARKER));
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import register from "../../src/extension/index.ts";
import { FOREGROUND_ERROR_MAX_BYTES } from "../../src/runs/foreground/kernel.ts";

function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
function harness(result: any = { status: "completed", output: "done" }) {
 const tools: any[] = [], handlers = new Map<string, Function[]>(), creations: any[] = [], launches: any[] = [], disposals: Promise<void>[] = []; const gates: ReturnType<typeof deferred>[] = [];
 const pi: any = { registerTool: (tool: any) => tools.push(tool), on: (name: string, fn: Function) => handlers.set(name, [...(handlers.get(name) ?? []), fn]), events: {} };
 const root = fs.mkdtempSync(path.join(os.tmpdir(), "public-extension-")), agents = path.join(root, "agents"); fs.mkdirSync(agents); fs.writeFileSync(path.join(agents, "worker.md"), "---\nname: worker\ndescription: Works\n---\nBe useful.\n");
 register(pi, { resolveSources: (_cwd, runtime) => ({ projectDir: agents, runtime }), createKernel: ((options: any) => { creations.push(options); const gate = deferred(); gates.push(gate); return { launch: async (input: any) => { launches.push(input); return result; }, dispose: () => { disposals.push(gate.promise); return gate.promise; } }; }) as any });
 const manager = { getSessionFile: () => "session.jsonl", getLeafId: () => "leaf", createBranchedSession: (id: string) => `branch:${id}` };
 const ctx: any = { cwd: root, sessionManager: manager };
 return { pi, tools, handlers, root, ctx, manager, creations, launches, disposals, gates, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("direct child extension entry registers nothing", { concurrency: false }, () => {
 const previous = process.env.PI_SUBAGENT_CHILD; process.env.PI_SUBAGENT_CHILD = "1";
 try { const tools: unknown[] = []; register({ registerTool: (tool: unknown) => tools.push(tool), on() {} } as any); assert.deepEqual(tools, []); }
 finally { if (previous === undefined) delete process.env.PI_SUBAGENT_CHILD; else process.env.PI_SUBAGENT_CHILD = previous; }
});

test("list is side-effect-free and creates no kernels", async () => { const h = harness(); try {
 assert.deepEqual(h.tools.map(t => t.name), ["subagent"]); assert.deepEqual([...h.handlers.keys()], ["session_shutdown"]); const before = JSON.stringify(h.ctx);
 const listed = await h.tools[0].execute("1", { action: "list" }, new AbortController().signal, undefined, h.ctx);
 assert.equal(h.creations.length, 0); assert.equal(JSON.stringify(h.ctx), before); assert.deepEqual(listed.details, { agents: [{ name: "worker", description: "Works", source: "project" }], diagnostics: [] });
 } finally { h.cleanup(); } });

test("launch propagates overrides, exact signal, and fork-source closures", async () => { const h = harness(); try {
 const signal = new AbortController().signal; await h.tools[0].execute("2", { agent: "worker", task: "work", cwd: "/override", context: "fork", model: "vendor/model", thinking: "high", timeoutMs: 1234 }, signal, undefined, h.ctx);
 assert.equal(h.creations.length, 1); const { agent, ...launch } = h.launches[0]; assert.equal(agent.name, "worker"); assert.deepEqual(launch, { task: "work", cwd: "/override", context: "fork", model: "vendor/model", thinking: "high", timeoutMs: 1234, signal });
 const source = h.creations[0].forkSource; assert.equal(source.getSessionFile(), "session.jsonl"); assert.equal(source.getLeafId(), "leaf"); assert.equal(source.createBranchedSession("exact"), "branch:exact");
 } finally { h.cleanup(); } });

test("kernel identity is manager plus cwd", async () => { const h = harness(); try {
 const launch = (ctx: any) => h.tools[0].execute("x", { agent: "worker", task: "x" }, undefined, undefined, ctx);
 await launch(h.ctx); await launch(h.ctx); await launch({ ...h.ctx, cwd: path.join(h.root, "other") }); await launch({ ...h.ctx, sessionManager: { ...h.manager } }); assert.equal(h.creations.length, 3);
 } finally { h.cleanup(); } });

test("shutdown awaits every disposal, is idempotent, and prevents later creation", async () => { const h = harness(); try {
 await h.tools[0].execute("x", { agent: "worker", task: "x" }, undefined, undefined, h.ctx); await h.tools[0].execute("x", { agent: "worker", task: "x" }, undefined, undefined, { ...h.ctx, cwd: `${h.root}-2` });
 let settled = false; const shutdown = h.handlers.get("session_shutdown")![0]!().then(() => { settled = true; }); await Promise.resolve(); assert.equal(settled, false); assert.equal(h.disposals.length, 2); h.gates.forEach(g => g.resolve()); await shutdown; await h.handlers.get("session_shutdown")![0]!(); assert.equal(h.disposals.length, 2);
 await assert.rejects(h.tools[0].execute("x", { agent: "worker", task: "x" }, undefined, undefined, { ...h.ctx, cwd: `${h.root}-3` }), /shutting down/); assert.equal(h.creations.length, 2);
 } finally { h.cleanup(); } });

test("failed normalized result preserves fields and emits model-visible failure without isError", async () => { const failure = { status: "failed", output: "partial", error: { code: "boom", message: "bad" }, usage: { input: 2 } }; const h = harness(failure); try {
 const value = await h.tools[0].execute("x", { agent: "worker", task: "x" }, undefined, undefined, h.ctx); assert.deepEqual(value.details, failure); assert.match(value.content[0].text, /Subagent launch failed \(failed\): bad/); assert.equal(Object.hasOwn(value, "isError"), false);
 } finally { h.cleanup(); } });

test("oversized multibyte missing-agent model text is byte bounded", async () => { const h = harness(); try {
 const value = await h.tools[0].execute("x", { agent: "界".repeat(100_000), task: "x" }, undefined, undefined, h.ctx); assert.equal(value.details.status, "failed"); assert.ok(Buffer.byteLength(value.content[0].text, "utf8") <= FOREGROUND_ERROR_MAX_BYTES);
 } finally { h.cleanup(); } });

test("empty object, action launch, and removed shapes reject before kernel creation", async () => { const h = harness(); try {
 for (const value of [{}, { action: "status" }, { action: "list", async: true }, { agent: "worker", task: "x", workflowScript: "x" }]) await assert.rejects(h.tools[0].execute("x", value, undefined, undefined, h.ctx), /agent must|unknown field|unknown field or action/); assert.equal(h.creations.length, 0);
 } finally { h.cleanup(); } });

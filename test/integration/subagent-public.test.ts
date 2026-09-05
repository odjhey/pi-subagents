import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import register from "../../src/extension/index.ts";
import { createForegroundKernel } from "../../src/runs/foreground/kernel.ts";

test("invariants 1, 2, 5, and 8: public list and fresh launch use one isolated foreground child without persistence", async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-public-")); const dir = path.join(root, "agents"); fs.mkdirSync(dir);
	fs.writeFileSync(path.join(dir, "worker.md"), "---\nname: worker\ndescription: worker\n---\nprompt\n");
	const repositoryState = () => fs.readdirSync(root, { recursive: true }).map(String).sort();
	const before = repositoryState();
	let creates = 0, aborts = 0, disposes = 0; const messages: any[] = []; const session: any = { messages, prompt: async () => { messages.push({ role: "assistant", content: [{ type: "text", text: "child output" }] }); }, abort: async () => { aborts++; }, dispose: async () => { disposes++; }, hardDispose: () => {}, subscribe: () => () => {} };
	const factory: any = { create: async () => { creates++; return session; }, dispose: async () => {} };
	const tools: any[] = []; const handlers = new Map<string, Function>(); const pi: any = { events: {}, registerTool: (tool: any) => tools.push(tool), on: (name: string, fn: Function) => handlers.set(name, fn) };
	register(pi, { resolveSources: () => ({ projectDir: dir }), createKernel: ((options: any) => createForegroundKernel({ ...options, factory })) as any });
	const ctx: any = { cwd: root, sessionManager: { getSessionFile: () => undefined, getLeafId: () => null, createBranchedSession: () => undefined } };
	const listed = await tools[0].execute("list", { action: "list" }, new AbortController().signal, undefined, ctx);
	assert.deepEqual(listed.details.agents.map((agent: any) => agent.name), ["worker"]); assert.equal(creates, 0); assert.deepEqual(repositoryState(), before);
	const answer = await tools[0].execute("x", { agent: "worker", task: "run" }, new AbortController().signal, undefined, ctx);
	assert.equal(creates, 1); assert.deepEqual(answer.details, { status: "completed", output: "child output" }); assert.equal(disposes, 1); assert.equal(aborts, 0); assert.deepEqual(repositoryState(), before);
	await handlers.get("session_shutdown")!();
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

function run(script: string): string[] {
	return JSON.parse(execFileSync(process.execPath, ["--experimental-strip-types", "--import", "./test/support/isolated-temp-root.mjs", "--input-type=module", "--eval", script], { cwd: path.resolve("."), encoding: "utf8" }));
}
const pi = `const names=[]; const pi={events:{},registerTool:t=>names.push(t.name),on(){}};`;

test("child-first cache order suppresses the child and later registers exactly one parent tool", () => {
	assert.deepEqual(run(`${pi} process.env.PI_SUBAGENT_CHILD='1'; const {default:register}=await import('./index.ts'); register(pi); delete process.env.PI_SUBAGENT_CHILD; register(pi); console.log(JSON.stringify(names));`), ["subagent"]);
});

test("parent-first cache order registers once and suppresses the later child invocation", () => {
	assert.deepEqual(run(`${pi} delete process.env.PI_SUBAGENT_CHILD; const {default:register}=await import('./index.ts'); register(pi); process.env.PI_SUBAGENT_CHILD='1'; register(pi); console.log(JSON.stringify(names));`), ["subagent"]);
});

test("root child invocation alone registers nothing", () => {
	assert.deepEqual(run(`${pi} process.env.PI_SUBAGENT_CHILD='1'; const {default:register}=await import('./index.ts'); register(pi); console.log(JSON.stringify(names));`), []);
});

import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import { SubagentParams } from "../../src/extension/schemas.ts";

const valid = (value: unknown) => Value.Check(SubagentParams, value);

test("subagent schema is provider-safe and non-recursive", () => {
	const json = JSON.stringify(SubagentParams);
	for (const forbidden of ["anyOf", "oneOf", "const"]) assert.equal(json.includes(`\"${forbidden}\"`), false);
	assert.equal(SubagentParams.type, "object");
	assert.equal(SubagentParams.additionalProperties, false);
	assert.deepEqual(Object.keys(SubagentParams.properties), ["action", "agent", "task", "cwd", "context", "model", "thinking", "timeoutMs"]);
});

test("schema admits list and actionless launch projections", () => {
	assert.equal(valid({ action: "list" }), true);
	assert.equal(valid({ agent: "worker", task: "work", context: "fresh", thinking: "high" }), true);
});

test("runtime discrimination rejects empty and removed public shapes", async () => {
	// The flat provider schema deliberately admits {}, then extension runtime
	// discrimination requires either exact list or an actionless launch.
	assert.equal(valid({}), true);
	assert.equal(valid({ action: "status" }), false);
	for (const removed of [{ action: "launch", agent: "a", task: "t" }, { action: "list", async: true }, { agent: "a", task: "t", workflow: [] }, { id: "run" }]) assert.equal(valid(removed), false);
});

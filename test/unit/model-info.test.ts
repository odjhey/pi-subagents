import assert from "node:assert/strict";
import test from "node:test";
import { THINKING_LEVELS, type ThinkingLevel } from "../../src/shared/model-info.ts";

test("thinking levels are the exact public validation enum", () => {
	assert.deepEqual(THINKING_LEVELS, ["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
	const accepts = (value: string): value is ThinkingLevel => (THINKING_LEVELS as readonly string[]).includes(value);
	for (const value of THINKING_LEVELS) assert.equal(accepts(value), true);
	for (const value of ["", "none", "ultra", "HIGH"]) assert.equal(accepts(value), false);
});

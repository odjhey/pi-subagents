import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { FOREGROUND_TIMEOUT_MAX_MS } from "../runs/foreground/kernel.ts";
import { THINKING_LEVELS } from "../shared/model-info.ts";

/** Provider-safe shape. Exact list-vs-launch discrimination is enforced at runtime. */
export const SubagentParams = Type.Object({
	action: Type.Optional(StringEnum(["list"] as const)),
	agent: Type.Optional(Type.String({ minLength: 1 })),
	task: Type.Optional(Type.String({ minLength: 1 })),
	cwd: Type.Optional(Type.String({ minLength: 1 })),
	context: Type.Optional(StringEnum(["fresh", "fork"] as const)),
	model: Type.Optional(Type.String({ minLength: 1 })),
	thinking: Type.Optional(StringEnum(THINKING_LEVELS)),
	timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: FOREGROUND_TIMEOUT_MAX_MS })),
}, { additionalProperties: false });
export function createSubagentParamsSchema(): typeof SubagentParams { return SubagentParams; }

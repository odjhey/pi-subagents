import {
	registerAgentViaEvents,
	type RegisterRuntimeAgentViaEventsInput,
} from "../agents/runtime-agent-events.ts";
import type {
	RuntimeAgentDefinition,
	RuntimeAgentRegistration,
} from "../agents/configured-runtime-registry.ts";

export type RegisterAgentInput = RegisterRuntimeAgentViaEventsInput;
export type { RuntimeAgentDefinition, RuntimeAgentRegistration };

/** Register one process-local configured agent through the owning pi-subagents extension. */
export function registerAgent(input: RegisterAgentInput): RuntimeAgentRegistration {
	return registerAgentViaEvents(input);
}

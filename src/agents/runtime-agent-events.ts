import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerRuntimeAgent, validateRuntimeAgentRegistration, type RuntimeAgentDefinition, type RuntimeAgentRegistration } from "./configured-runtime-registry.ts";

export const RUNTIME_AGENT_REGISTER_EVENT = "pi-subagents:runtime-agent-register:v1";
export const RUNTIME_AGENT_REGISTER_VERSION = 1;
export const RUNTIME_AGENT_OWNER_READY_EVENT = "pi-subagents:runtime-agent-owner-ready:v1";
export const RUNTIME_AGENT_OWNER_READY_VERSION = 1;

export type RuntimeAgentRegistrationResult =
	| { ok: true; registration: RuntimeAgentRegistration }
	| { ok: false; error: Error };

export interface RuntimeAgentRegistrationRequest {
	version: 1;
	name: string;
	definition: RuntimeAgentDefinition;
	result?: RuntimeAgentRegistrationResult;
}

export interface RuntimeAgentOwnerReadyPayload {
	version: 1;
	errors: Error[];
}

export interface RegisterRuntimeAgentViaEventsInput {
	pi: Pick<ExtensionAPI, "events">;
	name: string;
	definition: RuntimeAgentDefinition;
}

function errorFrom(value: unknown): Error {
	return value instanceof Error ? value : new Error(String(value));
}

function resultRegistration(request: RuntimeAgentRegistrationRequest): RuntimeAgentRegistration | undefined {
	const result = request.result as unknown;
	if (result === undefined) return undefined;
	if (result && typeof result === "object" && !Array.isArray(result)) {
		const candidate = result as Record<string, unknown>;
		if (candidate.ok === true && candidate.registration && typeof candidate.registration === "object" && typeof (candidate.registration as { dispose?: unknown }).dispose === "function") return candidate.registration as RuntimeAgentRegistration;
		if (candidate.ok === false && candidate.error instanceof Error) throw candidate.error;
	}
	throw new Error("pi-subagents returned a malformed runtime agent registration result.");
}

/** Register through the installed pi-subagents owner in this Pi process. */
export function registerAgentViaEvents(input: RegisterRuntimeAgentViaEventsInput): RuntimeAgentRegistration {
	// Validate before touching the bus so a missing owner never defers input errors.
	const validated = validateRuntimeAgentRegistration(input as Parameters<typeof validateRuntimeAgentRegistration>[0]);
	const { name: _normalizedName, ...definition } = validated.definition;
	const request: RuntimeAgentRegistrationRequest = { version: RUNTIME_AGENT_REGISTER_VERSION, name: validated.name, definition };
	let ownerRegistration: RuntimeAgentRegistration | undefined;
	let live = true;
	let stopReady = input.pi.events.on(RUNTIME_AGENT_OWNER_READY_EVENT, (raw) => {
		if (!live || ownerRegistration || !raw || typeof raw !== "object") return;
		const ready = raw as Partial<RuntimeAgentOwnerReadyPayload>;
		if (ready.version !== RUNTIME_AGENT_OWNER_READY_VERSION || !Array.isArray(ready.errors)) return;
		try {
			request.result = undefined;
			input.pi.events.emit(RUNTIME_AGENT_REGISTER_EVENT, request);
			ownerRegistration = resultRegistration(request);
			if (ownerRegistration) stopReady();
		} catch (error) {
			// Pi's event bus swallows listener failures asynchronously, so report the
			// failure through the synchronously mutable ready payload instead.
			stopReady();
			ready.errors.push(errorFrom(error));
		}
	});
	input.pi.events.emit(RUNTIME_AGENT_REGISTER_EVENT, request);
	try {
		ownerRegistration = resultRegistration(request);
		if (ownerRegistration) stopReady();
	} catch (error) {
		stopReady();
		throw error;
	}
	return { dispose() { if (!live) return; live = false; stopReady(); ownerRegistration?.dispose(); } };
}

/** Install the process-local registration listener for the owning pi-subagents runtime. */
export function registerRuntimeAgentEventListener(pi: ExtensionAPI): () => void {
	if (!pi.events || typeof pi.events.on !== "function") return () => {};
	const adoptedDuringReady: RuntimeAgentRegistration[] = [];
	let replaying = false;
	const stop = pi.events.on(RUNTIME_AGENT_REGISTER_EVENT, (rawRequest) => {
		if (!rawRequest || typeof rawRequest !== "object" || Array.isArray(rawRequest)) return;
		const request = rawRequest as Record<string, unknown>;
		if (request.result !== undefined) return;
		try {
			if (request.version !== RUNTIME_AGENT_REGISTER_VERSION) throw new Error(`Unsupported runtime agent registration event version '${String(request.version)}'.`);
			const registration = registerRuntimeAgent({ pi, name: request.name as string, definition: request.definition as RuntimeAgentDefinition });
			if (replaying) adoptedDuringReady.push(registration);
			request.result = { ok: true, registration } satisfies RuntimeAgentRegistrationResult;
		} catch (error) {
			request.result = { ok: false, error: errorFrom(error) } satisfies RuntimeAgentRegistrationResult;
		}
	});
	const ready: RuntimeAgentOwnerReadyPayload = { version: RUNTIME_AGENT_OWNER_READY_VERSION, errors: [] };
	replaying = true;
	pi.events.emit(RUNTIME_AGENT_OWNER_READY_EVENT, ready);
	replaying = false;
	if (ready.errors.length > 0) {
		stop();
		for (const registration of adoptedDuringReady) registration.dispose();
		throw new Error(`Failed to set up runtime agent owner: ${ready.errors.map((error) => error.message).join("; ")}`);
	}
	return stop;
}

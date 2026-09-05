import assert from "node:assert/strict";
import test from "node:test";
import { clearRuntimeAgents, listRuntimeAgents, registerRuntimeAgent } from "../../src/agents/configured-runtime-registry.ts";
import { discoverConfiguredAgents } from "../../src/agents/discovery.ts";
import { registerRuntimeAgentEventListener } from "../../src/agents/runtime-agent-events.ts";
import { registerAgent } from "../../src/api/agents.ts";

function bus() {
	const listeners = new Map<string, Set<(value: unknown) => void>>();
	return { emit(name: string, value: unknown) { for (const listener of listeners.get(name) ?? []) listener(value); }, on(name: string, listener: (value: unknown) => void) { const set = listeners.get(name) ?? new Set(); set.add(listener); listeners.set(name, set); return () => set.delete(listener); } };
}

function piRealisticBus() {
	const listeners = new Map<string, Set<(value: unknown) => Promise<void>>>();
	return {
		emit(name: string, value: unknown) { for (const listener of listeners.get(name) ?? []) void listener(value); },
		on(name: string, listener: (value: unknown) => void | Promise<void>) {
			const safeListener = async (value: unknown) => { try { await listener(value); } catch { /* Pi logs and swallows listener failures. */ } };
			const set = listeners.get(name) ?? new Set(); set.add(safeListener); listeners.set(name, set);
			return () => set.delete(safeListener);
		},
		listenerCount(name: string) { return listeners.get(name)?.size ?? 0; },
	};
}
test("direct and production-event registrations participate in discovery and dispose/clear", () => {
	const pi = { events: bus() } as any;
	const direct = registerRuntimeAgent({ pi, name: "direct", definition: { description: "direct" } });
	const stop = registerRuntimeAgentEventListener(pi);
	const event = registerAgent({ pi, name: "event", definition: { description: "event" } });
	assert.deepEqual(discoverConfiguredAgents({ runtime: listRuntimeAgents(pi) }).agents.map((agent) => agent.name), ["direct", "event"]);
	assert.throws(() => registerRuntimeAgent({ pi, name: "direct", definition: { description: "duplicate" } }), /already registered/);
	event.dispose(); direct.dispose(); assert.deepEqual(listRuntimeAgents(pi), []);
	registerRuntimeAgent({ pi, name: "clear", definition: { description: "clear" } }); clearRuntimeAgents(pi); assert.deepEqual(listRuntimeAgents(pi), []); stop();
});
test("public registration routes from a distinct consumer to the event-bus owner", () => {
	const events = bus(); const owner = { events } as any; const consumer = { events } as any;
	const stop = registerRuntimeAgentEventListener(owner);
	const registration = registerAgent({ pi: consumer, name: "public", definition: { description: "public" } });
	assert.deepEqual(listRuntimeAgents(owner).map((item) => item.name), ["public"]);
	assert.deepEqual(listRuntimeAgents(consumer), []);
	assert.throws(() => registerAgent({ pi: consumer, name: "public", definition: { description: "duplicate" } }), /already registered/);
	registration.dispose(); assert.deepEqual(listRuntimeAgents(owner), []); stop();
});

test("consumer-before-owner replays, and disposal works before and after adoption", () => {
	const events = bus(); const owner = { events } as any; const consumer = { events } as any;
	const adopted = registerAgent({ pi: consumer, name: "early", definition: { description: "early" } });
	const cancelled = registerAgent({ pi: consumer, name: "cancelled", definition: { description: "cancelled" } });
	cancelled.dispose();
	const stop = registerRuntimeAgentEventListener(owner);
	assert.deepEqual(listRuntimeAgents(owner).map((item) => item.name), ["early"]);
	adopted.dispose(); assert.deepEqual(listRuntimeAgents(owner), []); stop();
});

test("registration buses are isolated and listener disposal leaves registrations staged", () => {
	const firstBus = bus(); const secondBus = bus();
	const consumer = { events: firstBus } as any; const unrelatedOwner = { events: secondBus } as any;
	const registration = registerAgent({ pi: consumer, name: "isolated", definition: { description: "isolated" } });
	const stopUnrelated = registerRuntimeAgentEventListener(unrelatedOwner);
	assert.deepEqual(listRuntimeAgents(unrelatedOwner), []);
	const owner = { events: firstBus } as any; const stop = registerRuntimeAgentEventListener(owner); stop();
	const later = registerAgent({ pi: consumer, name: "later", definition: { description: "later" } });
	assert.deepEqual(listRuntimeAgents(owner).map((item) => item.name), ["isolated"]);
	registration.dispose(); later.dispose(); stopUnrelated();
});

test("Pi-safe event handlers report duplicate replay failures synchronously and owner setup rolls back", () => {
	const events = piRealisticBus();
	const consumer = { events } as any;
	registerAgent({ pi: consumer, name: "duplicate", definition: { description: "first" } });
	registerAgent({ pi: consumer, name: "duplicate", definition: { description: "second" } });
	const owner = { events } as any;
	assert.throws(
		() => registerRuntimeAgentEventListener(owner),
		/Failed to set up runtime agent owner: Runtime agent 'duplicate' is already registered/,
	);
	assert.deepEqual(listRuntimeAgents(owner), []);
	assert.equal(events.listenerCount("pi-subagents:runtime-agent-owner-ready:v1"), 0);
	assert.equal(events.listenerCount("pi-subagents:runtime-agent-register:v1"), 0);
});

test("public validation and exact-name duplicates reject synchronously", () => {
	const events = bus(); const consumer = { events } as any;
	assert.throws(() => registerAgent({ pi: consumer, name: " bad", definition: { description: "bad" } }), /name/);
	assert.throws(() => registerAgent({ pi: consumer, name: "bad", definition: { description: "bad", tools: [undefined] } as any }), /tools\[0\]/);
	const owner = { events } as any; const stop = registerRuntimeAgentEventListener(owner);
	const first = registerAgent({ pi: consumer, name: "same", definition: { description: "first" } });
	assert.throws(() => registerAgent({ pi: consumer, name: "same", definition: { description: "second" } }), /already registered/);
	first.dispose(); stop();
});

test("minimal registry rejects legacy fields, malformed arrays, and invalid thinking", () => {
	const pi = {} as any;
	for (const field of ["runner", "aliases", "defaultAsync"]) assert.throws(() => registerRuntimeAgent({ pi, name: `bad-${field}`, definition: { description: "bad", [field]: true } as any }), /unsupported fields/);
	const sparse = ["read"]; sparse.length = 2;
	for (const tools of [["read", undefined], sparse]) assert.throws(() => registerRuntimeAgent({ pi, name: "bad-tools", definition: { description: "bad", tools } as any }), /tools\[1\]/);
	assert.throws(() => registerRuntimeAgent({ pi, name: "bad-thinking", definition: { description: "bad", thinking: "maximum" } }), /must be one of/);
});

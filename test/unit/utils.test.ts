import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getAgentDir, resolveConfigDirName } from "../../src/shared/utils.ts";

test("config directory resolves module, package metadata, then default", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "config-dir-"));
	try {
		fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", piConfig: { configDir: ".custom" } }));
		const entry = path.join(root, "bin.js"); fs.writeFileSync(entry, "");
		assert.equal(resolveConfigDirName({ CONFIG_DIR_NAME: ".module" }, entry, root), ".module");
		assert.equal(resolveConfigDirName(undefined, entry, undefined), ".custom");
		assert.equal(resolveConfigDirName(undefined, undefined, undefined), ".pi");
	} finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("agent directory supports custom paths, tilde, and default", () => {
	const previous = { dir: process.env.PI_CODING_AGENT_DIR, home: process.env.HOME };
	try {
		process.env.HOME = "/home/tester";
		process.env.PI_CODING_AGENT_DIR = "/custom/agent"; assert.equal(getAgentDir(), "/custom/agent");
		process.env.PI_CODING_AGENT_DIR = "~/agent-two"; assert.equal(getAgentDir(), path.join("/home/tester", "agent-two"));
		delete process.env.PI_CODING_AGENT_DIR; assert.equal(getAgentDir(), path.join("/home/tester", ".pi", "agent"));
	} finally {
		if (previous.dir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous.dir;
		if (previous.home === undefined) delete process.env.HOME; else process.env.HOME = previous.home;
	}
});

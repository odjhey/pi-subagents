import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isSubagentChildContext } from "./src/runs/shared/child-session.ts";

const registerParentExtension = (await import("./src/extension/index.ts")).default;

export default function registerSubagentExtension(pi: ExtensionAPI): void {
	// Check at invocation as well as evaluation: this entry module may already be
	// cached from a parent load when an in-process child loads its extensions.
	if (isSubagentChildContext()) return;
	registerParentExtension?.(pi);
}

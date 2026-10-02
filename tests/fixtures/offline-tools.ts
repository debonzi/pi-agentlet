import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/** File-backed callable tools for the pi 0.99 offline smoke; no model or network calls. */
export default function offlineTools(pi: ExtensionAPI): void {
  // The verifier consumes its environment marker during extension loading.
  const child = process.argv.some(arg => arg.endsWith("/src/verify-child.ts"));
  const mismatch = child && process.argv.includes("mismatch");
  for (const exposure of ["codemode", "deferred"] as const) {
    const tool = {
      name: `fixture_${exposure}`, label: "Offline callable fixture", description: "Return a deterministic local fixture value.",
      parameters: Type.Object({}), exposure, namespace: { name: "fixture", description: "Offline fixtures" },
      annotations: { readOnlyHint: !mismatch, destructiveHint: false, openWorldHint: false },
      async execute() {
        return { content: [{ type: "text" as const, text: `FIXTURE_${exposure.toUpperCase()}_OK` }], details: undefined,
          usage: { input: 2, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 3,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      },
    };
    pi.registerTool(tool);
  }
}

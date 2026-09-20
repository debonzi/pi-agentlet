import { readFileSync, writeSync } from "node:fs";
import type { BuildSystemPromptOptions, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { digest, mismatch } from "./resources.ts";
import type { Expectation } from "./types.ts";

/** Private startup check. It never removes tools or prevents subdelegation. */
export default function verifyChild(pi: ExtensionAPI): void {
  if (process.env.PI_AGENTLET_VERIFY !== "1") return;
  delete process.env.PI_AGENTLET_VERIFY;
  const expected = JSON.parse(readFileSync(3, "utf8")) as Expectation;
  const fail = (reason: string): never => {
    writeSync(4, JSON.stringify({ error: `Resource incompatibility: ${reason}. No fallback was used.` }) + "\n");
    process.exit(78);
  };
  if (VERSION !== expected.version) fail("pi version");
  let options: BuildSystemPromptOptions | undefined;
  let verified = false;
  pi.on("before_agent_start", event => { options = event.systemPromptOptions; });
  pi.on("agent_start", (_event, ctx) => {
    if (!verified) {
      if (!options) fail("missing structured prompt configuration");
      const reason = mismatch(expected, pi, ctx, options!);
      if (reason) fail(reason);
      writeSync(4, '{"ready":true}\n');
      verified = true;
    }
  });
  pi.on("before_provider_request", (_event, ctx) => {
    if (ctx.model?.provider !== expected.provider || ctx.model?.id !== expected.model || digest(ctx.model) !== expected.modelHash) {
      fail("model changed during delegated execution");
    }
  });
}

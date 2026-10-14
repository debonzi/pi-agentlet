import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** A router to the same fake provider, used only by the virtual-model rejection smoke. */
export default function offlineVirtual(pi: ExtensionAPI): void {
  pi.registerVirtualModel({
    provider: "agentlet-fixture", id: "virtual-fixture", name: "Offline virtual fixture",
    route(_request, ctx) { return { model: ctx.modelRegistry.find("agentlet-fixture", "fixture")!, thinkingLevel: "off" }; },
  });
}

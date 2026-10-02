import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** A router to the same fake provider, used only by the pi 0.99 rejection smoke. */
export default function offlineVirtual(pi: ExtensionAPI): void {
  // Keep this opt-in fixture type-checkable against the legacy host declarations too.
  const modern = pi as ExtensionAPI & { registerVirtualModel(definition: {
    provider: string; id: string; name: string;
    route(request: unknown, ctx: ExtensionContext): { model: NonNullable<ExtensionContext["model"]>; thinkingLevel: "off" };
  }): void };
  modern.registerVirtualModel({
    provider: "agentlet-fixture", id: "virtual-fixture", name: "Offline virtual fixture",
    route(_request, ctx) { return { model: ctx.modelRegistry.find("agentlet-fixture", "fixture")!, thinkingLevel: "off" }; },
  });
}

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, getCurrentTools, type AssistantMessage } from "@earendil-works/pi-ai";

/** Deterministic, in-process provider for opt-in real-pi integration. Never uses the network. */
export default function offlineProvider(pi: ExtensionAPI): void {
  pi.registerProvider("agentlet-fixture", {
    baseUrl: "https://unused.invalid", apiKey: "not-a-credential", api: "agentlet-fixture",
    models: [{ id: "fixture", name: "Offline fixture", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 }],
    streamSimple(model, context) {
      const stream = createAssistantMessageEventStream();
      const users = context.messages.filter(message => message.role === "user");
      const delegated = JSON.stringify(users).includes("You are carrying out a delegated task");
      const result = context.messages.findLast(message => message.role === "toolResult" && message.toolName === "subagents");
      let content: AssistantMessage["content"];
      if (delegated) {
        if (users.length !== 1 || JSON.stringify(users).includes("PARENT_PRIVATE_MARKER")) throw new Error("Conversation leaked into child.");
        if (!getCurrentTools(context.messages).some(tool => tool.name === "subagents")) throw new Error("Child subagents tool was removed.");
        content = [{ type: "text", text: "No findings." }, { type: "thinking", thinking: "CHILD_PRIVATE_THINKING" }];
      } else if (result) {
        const value = JSON.stringify(result.content);
        if ((value.match(/— completed/g) ?? []).length !== 3 || value.includes("CHILD_PRIVATE_THINKING")) {
          content = [{ type: "text", text: `SMOKE_FAILED: ${value}` }];
        } else content = [{ type: "text", text: "SMOKE_OK" }];
      } else {
        content = [{ type: "toolCall", id: "fixture-delegate", name: "subagents", arguments: {
          tasks: ["Review bugs", "Review tests", "Review errors"].map(title => ({ title, task: "Analyze the supplied fixture only. Do not modify files.", output: "State whether there are findings." })),
        } }];
      }
      const message: AssistantMessage = {
        role: "assistant", provider: model.provider, model: model.id, api: model.api, content,
        stopReason: content[0]?.type === "toolCall" ? "toolUse" : "stop", timestamp: Date.now(),
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      stream.push({ type: "start", partial: message });
      stream.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message });
      stream.end();
      return stream;
    },
  });
}

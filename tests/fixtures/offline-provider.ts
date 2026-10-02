import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, getCurrentTools, type AssistantMessage } from "@earendil-works/pi-ai";

/** Deterministic, in-process provider for opt-in real-pi integration. Never uses the network. */
export default function offlineProvider(pi: ExtensionAPI): void {
  if (process.env.PI_AGENTLET_SMOKE_PI_PIDS) {
    writeFileSync(join(process.env.PI_AGENTLET_SMOKE_PI_PIDS, String(process.pid)), "", { mode: 0o600 });
  }
  pi.registerFlag("agentlet-smoke-profile", { type: "string", default: "basic", description: "Deterministic offline integration profile" });
  pi.registerProvider("agentlet-fixture", {
    baseUrl: "https://unused.invalid", apiKey: "not-a-credential", api: "agentlet-fixture",
    models: [{ id: "fixture", name: "Offline fixture", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 }],
    streamSimple(model, context, options) {
      const stream = createAssistantMessageEventStream();
      const profile = pi.getFlag("agentlet-smoke-profile");
      const users = context.messages.filter(message => message.role === "user");
      const delegated = JSON.stringify(users).includes("You are carrying out a delegated task");
      const result = context.messages.findLast(message => message.role === "toolResult" && message.toolName === "subagents");
      let content: AssistantMessage["content"];
      if (delegated) {
        if (users.length !== 1 || JSON.stringify(users).includes("PARENT_PRIVATE_MARKER")) throw new Error("Conversation leaked into child.");
        if (!getCurrentTools(context.messages).some(tool => tool.name === "subagents")) throw new Error("Child subagents tool was removed.");
        const nested = context.messages.findLast(message => message.role === "toolResult" && message.toolName === "codemode");
        if (profile === "cancel" || (profile === "timeout" && JSON.stringify(users).includes("WAIT_FOR_TIMEOUT"))) {
          const message: AssistantMessage = { role: "assistant", provider: model.provider, model: model.id, api: model.api,
            content: [], stopReason: "pending", timestamp: Date.now(),
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
          stream.push({ type: "start", partial: message });
          const keepAlive = setInterval(() => {}, 1000);
          const abort = () => {
            clearInterval(keepAlive);
            message.stopReason = "aborted";
            stream.push({ type: "error", reason: "aborted", error: message }); stream.end();
          };
          if (options?.signal?.aborted) abort();
          else options?.signal?.addEventListener("abort", abort, { once: true });
          return stream;
        }
        if ((profile === "codemode" || profile === "mcp") && !nested) {
          const toolNames = profile === "mcp" ? ["mcp__offline__echo"] : ["fixture_codemode", "fixture_deferred"];
          if (toolNames.some(name => pi.getActiveTools().includes(name))) throw new Error("Callable fixture unexpectedly declared.");
          content = [{ type: "toolCall", id: "fixture-nested", name: "codemode", arguments: {
            code: `text(await Promise.all([${toolNames.map(name => `tools[${JSON.stringify(name)}]({})`).join(",")}]))`,
          } }];
        } else {
          if ((nested?.role === "toolResult" && nested.isError) || (nested && !JSON.stringify(nested.content).includes(profile === "mcp" ? "MCP_FIXTURE_OK" : "FIXTURE_DEFERRED_OK"))) {
            throw new Error("Nested offline tools failed.");
          }
          content = [{ type: "text", text: "No findings." }, { type: "thinking", thinking: "CHILD_PRIVATE_THINKING" }];
        }
      } else if (result) {
        const value = JSON.stringify(result.content);
        const completed = (value.match(/— completed/g) ?? []).length;
        const valid = profile === "virtual" ? completed === 0 && value.includes("does not support virtual models")
          : profile === "mismatch" ? completed === 0 && (value.match(/Resource incompatibility/g) ?? []).length === 3
          : profile === "timeout" ? completed === 2 && value.includes("— timed_out") : completed === 3;
        if (!valid || value.includes("CHILD_PRIVATE_THINKING")) {
          content = [{ type: "text", text: `SMOKE_FAILED: ${value}` }];
        } else content = [{ type: "text", text: "SMOKE_OK" }];
      } else {
        content = [{ type: "toolCall", id: "fixture-delegate", name: "subagents", arguments: {
          tasks: (profile === "cancel" ? Array.from({ length: 6 }, (_, i) => `Waiting task ${i}`) : ["Review bugs", "Review tests", "Review errors"])
            .map((title, i) => ({ title, task: profile === "timeout" && i === 0 ? "WAIT_FOR_TIMEOUT. Do not modify files." : "Analyze the supplied fixture only. Do not modify files.",
              output: "State whether there are findings.", ...(profile === "timeout" && i === 0 ? { timeoutSeconds: 1 } : {}) })),
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

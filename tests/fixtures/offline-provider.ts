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
  pi.registerCommand("agentlet-smoke-custom", {
    description: "Start an offline run from a custom message",
    async handler(_args, ctx) {
      pi.sendMessage({ customType: "agentlet-smoke", content: "PARENT_PRIVATE_MARKER: offline custom run", display: false }, { triggerTurn: true });
      await ctx.waitForIdle();
    },
  });
  let delegatedRun = false;
  pi.on("before_agent_start", event => {
    delegatedRun = event.messageType === "user" && event.prompt.includes("You are carrying out a delegated task");
  });
  pi.on("agent_before_settle", (_event, ctx) => {
    if (delegatedRun && pi.getFlag("agentlet-smoke-profile") === "settled-abort") ctx.abort();
  });
  // Colliding authenticated providers and a literal id with provider/thinking syntax
  // exercise CLI resolution without ever invoking a real provider or allowing fallback.
  const literalModelId = "agentlet-decoy/fixture:high";
  const modelConfig = { name: "Offline fixture", reasoning: false, input: ["text"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 };
  pi.registerProvider("agentlet-decoy", {
    baseUrl: "https://unused.invalid", apiKey: "not-a-credential", api: "agentlet-decoy",
    models: [{ ...modelConfig, id: "fixture" }, { ...modelConfig, id: literalModelId, reasoning: true }],
    streamSimple() { throw new Error("Explicit provider selection was lost; no fallback is allowed."); },
  });
  pi.registerProvider("agentlet-fixture", {
    baseUrl: "https://unused.invalid", apiKey: "not-a-credential", api: "agentlet-fixture",
    models: [{ ...modelConfig, id: "fixture" }, { ...modelConfig, id: literalModelId, reasoning: true }],
    streamSimple(model, context, options) {
      const stream = createAssistantMessageEventStream();
      const profile = pi.getFlag("agentlet-smoke-profile");
      if (profile === "model-selection" && (model.provider !== "agentlet-fixture" || model.id !== literalModelId || pi.getThinkingLevel() !== "high")) {
        throw new Error("Explicit physical model or effective thinking level was lost.");
      }
      const users = context.messages.filter(message => message.role === "user");
      const delegated = JSON.stringify(users).includes("You are carrying out a delegated task");
      const result = context.messages.findLast(message => message.role === "toolResult" && message.toolName === "subagents");
      let content: AssistantMessage["content"];
      if (delegated) {
        if (users.length !== 1 || JSON.stringify(context.messages).includes("PARENT_PRIVATE_MARKER")) throw new Error("Conversation leaked into child.");
        if (!getCurrentTools(context.messages).some(tool => tool.name === "subagents")) throw new Error("Child subagents tool was removed.");
        if (!JSON.stringify(users).includes("do not use the subagents tool")) throw new Error("Child delegation prohibition was omitted.");
        if (pi.getActiveTools().some(name => ["write", "edit", "bash"].includes(name))) throw new Error("Inherited CLI tool exclusions were lost.");
        if (profile === "tool-deltas" && (!pi.getActiveTools().includes("tool_search") || pi.getActiveTools().includes("read"))) {
          throw new Error("Inherited additive CLI tool selection was lost.");
        }
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
        if ((profile === "codemode" || profile === "tool-differences" || profile === "mcp") && !nested) {
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
          : profile === "timeout" ? completed === 2 && value.includes("— timed_out")
          : profile === "length" ? completed === 0 && (value.match(/completion: length/g) ?? []).length === 3
          : profile === "settled-abort" ? completed === 0 && (value.match(/aborted run at settlement/g) ?? []).length === 3
          : completed === 3;
        if (!valid || value.includes("CHILD_PRIVATE_THINKING")) {
          content = [{ type: "text", text: `SMOKE_FAILED: ${value}` }];
        } else content = [{ type: "text", text: "SMOKE_OK" }];
      } else if ((profile === "mcp" || profile === "cancel") && !context.messages.some(message => message.role === "toolResult" && message.toolName === "codemode")) {
        // Warm the parent's MCP catalog through normal tool use before creating fresh children.
        // Children must be free to begin while their own delayed MCP connections are pending.
        content = [{ type: "toolCall", id: "fixture-warm-mcp", name: "codemode", arguments: {
          code: 'text(await tools.mcp__offline__echo({}))',
        } }];
      } else {
        content = [{ type: "toolCall", id: "fixture-delegate", name: "subagents", arguments: {
          tasks: (profile === "cancel" ? Array.from({ length: 6 }, (_, i) => `Waiting task ${i}`) : ["Review bugs", "Review tests", "Review errors"])
            .map((title, i) => ({ title, task: profile === "timeout" && i === 0 ? "WAIT_FOR_TIMEOUT. Do not modify files." : "Analyze the supplied fixture only. Do not modify files.",
              output: "State whether there are findings.", ...(profile === "timeout" && i === 0 ? { timeoutSeconds: 1 } : {}) })),
        } }];
      }
      const message: AssistantMessage = {
        role: "assistant", provider: model.provider, model: model.id, api: model.api, content,
        stopReason: content[0]?.type === "toolCall" ? "toolUse" : delegated && profile === "length" ? "length" : "stop", timestamp: Date.now(),
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      stream.push({ type: "start", partial: message });
      stream.push({ type: "done", reason: message.stopReason as "stop" | "toolUse" | "length", message });
      stream.end();
      return stream;
    },
  });
}

import { spawn } from "node:child_process";
import { readFileSync, writeSync } from "node:fs";

const [mode = "success", delay = "0"] = process.argv.slice(2);
const config = JSON.parse(readFileSync(3, "utf8"));
let prompt = "";
for await (const data of process.stdin) prompt += data;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const usage = { input: 3, output: 2, cacheRead: 1, cacheWrite: 0, totalTokens: 6, cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 } };
const assistant = (text, stopReason = "stop", extra = []) => ({ role: "assistant", content: [{ type: "text", text }, ...extra], stopReason, usage });
const event = value => process.stdout.write(JSON.stringify(value) + "\n");
const end = message => { event({ type: "message_end", message }); event({ type: "turn_end", message }); event({ type: "agent_end", messages: [message] }); };
if (mode !== "unverified") writeSync(4, '{"ready":true}\n');
if (mode === "mismatch") { writeSync(4, '{"error":"Resource mismatch"}\n'); setInterval(() => {}, 1000); }
else if (mode === "invalid") process.stdout.write("not json; secret api-key\n");
else if (mode === "bad-utf8") process.stdout.write(Buffer.from([0xff, 10]));
else if (mode === "oversized") process.stdout.write("x".repeat(20000));
else if (mode === "empty") event({ type: "session" });
else if (mode === "ignore" || mode === "tree") {
  process.on("SIGTERM", () => {});
  if (mode === "tree") {
    const child = spawn(process.execPath, ["-e", 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], { detached: true, stdio: "ignore" });
    event({ type: "tool_execution_start", toolName: "descendant", args: { path: String(child.pid) } });
  }
  event({ type: "tool_execution_start", toolName: "ready", args: {} });
  setInterval(() => {}, 1000);
} else {
  event({ type: "session", cwd: process.cwd() });
  event({ type: "agent_start" });
  event({ type: "message_end", message: assistant("INTERMEDIATE_PRIVATE", "toolUse", [{ type: "thinking", thinking: "THINKING_PRIVATE" }, { type: "toolCall", name: "read", arguments: {} }]) });
  event({ type: "tool_execution_start", toolName: "read", args: { path: "source.ts", secret: "SECRET_ARGS" } });
  event({ type: "message_end", message: { role: "toolResult", content: [{ type: "text", text: "TOOL_PRIVATE" }] } });
  await wait(Number(delay));
  if (mode === "signal") process.kill(process.pid, "SIGKILL");
  else if (mode === "provider-error") end(assistant("partial", "error"));
  else if (mode === "length") end(assistant("partial", "length"));
  else if (mode === "aborted") end(assistant("partial", "aborted"));
  else if (mode === "partial-error") {
    end(assistant("old valid answer"));
    event({ type: "message_start", message: { role: "assistant" } });
    end(assistant("partial", "error"));
  } else if (mode === "tool-only") end(assistant("Comment, not final", "toolUse", [{ type: "toolCall", name: "read", arguments: {} }]));
  else {
    const text = mode === "echo" ? prompt : mode === "config" ? JSON.stringify({ config, cwd: process.cwd(), agentDir: process.env.PI_CODING_AGENT_DIR })
      : mode === "large" ? "😀".repeat(6000) : "Final café 😀";
    const message = assistant(text, "stop", [{ type: "thinking", thinking: "FINAL_THINKING_PRIVATE" }, { type: "text", text: "Second text block" }]);
    if (mode === "chunked") {
      const bytes = Buffer.from(JSON.stringify({ type: "message_end", message }) + "\n" + JSON.stringify({ type: "agent_end", messages: [message] }));
      for (const byte of bytes) { process.stdout.write(Buffer.from([byte])); await wait(1); }
    } else end(message);
    if (mode === "nonzero") process.exitCode = 7;
  }
}

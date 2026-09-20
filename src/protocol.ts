import { LIMITS } from "./limits.ts";
import { oneLine } from "./text.ts";
import { addUsage } from "./usage.ts";
import type { Usage } from "./types.ts";

/** LF-only JSONL framing; fatal incremental UTF-8 decoding catches malformed output. */
export class JsonLines {
  private decoder = new TextDecoder("utf-8", { fatal: true });
  private pending = "";
  private bytes = 0;
  private consume: (value: unknown) => void;
  private maximum: number;
  constructor(consume: (value: unknown) => void, maximum = LIMITS.recordBytes) {
    this.consume = consume;
    this.maximum = maximum;
  }
  push(chunk: Uint8Array): void {
    // Bound each record before decoding/allocating its complete string.
    let from = 0;
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] !== 10) continue;
      this.append(chunk.subarray(from, i));
      this.finishRecord();
      from = i + 1;
    }
    this.append(chunk.subarray(from));
  }
  private append(bytes: Uint8Array): void {
    this.bytes += bytes.length;
    if (this.bytes > this.maximum) throw new Error("JSONL record exceeds the safety limit.");
    this.pending += this.decoder.decode(bytes, { stream: true });
  }
  private finishRecord(): void {
    this.pending += this.decoder.decode();
    if (this.pending.trim()) this.consume(JSON.parse(this.pending));
    this.pending = "";
    this.bytes = 0;
  }
  end(): void { this.finishRecord(); }
}

function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid event object.");
  return value as Record<string, any>;
}

export class Transcript {
  answer?: string;
  diagnostic?: string;
  usage?: Usage;
  ended = false;
  private activity: (text: string) => void;
  constructor(activity: (text: string) => void) { this.activity = activity; }
  accept(value: unknown): void {
    const event = object(value);
    if (typeof event.type !== "string") throw new Error("Missing event type.");
    if (["agent_start", "auto_retry_start", "compaction_start"].includes(event.type)) {
      this.answer = undefined;
      this.ended = false;
    }
    if (event.type === "agent_end") this.ended = event.willRetry !== true;
    // Non-conversation usage is persisted separately by this pi version. Do not
    // count the duplicate compaction_end result or message entry_appended events.
    if (event.type === "entry_appended" && ["usage", "compaction", "branch_summary"].includes(event.entry?.type)) {
      this.usage = addUsage(this.usage, event.entry.usage);
    }
    if (event.type === "message_start" && event.message?.role === "assistant") {
      this.answer = undefined;
      this.ended = false;
    }
    if (event.type === "message_update" && event.assistantMessageEvent?.type === "error") {
      this.answer = undefined;
      this.diagnostic = "The provider reported an interrupted or failed response.";
    }
    if (event.type === "tool_execution_start") {
      this.answer = undefined;
      const name = typeof event.toolName === "string" ? event.toolName : "tool";
      const path = typeof event.args?.path === "string" ? ` ${event.args.path}` : "";
      this.activity(oneLine(name + path, LIMITS.activityChars));
    }
    if (event.type === "message_end") {
      const message = object(event.message);
      if (message.role === "toolResult") this.usage = addUsage(this.usage, message.usage);
      if (message.role !== "assistant") return;
      this.usage = addUsage(this.usage, message.usage);
      this.answer = undefined;
      if (!Array.isArray(message.content)) throw new Error("Invalid assistant content.");
      const hasTools = message.content.some((part: unknown) => object(part).type === "toolCall");
      if (message.stopReason === "stop" && !hasTools) {
        const text = message.content.filter((part: any) => part.type === "text").map((part: any) => {
          if (typeof part.text !== "string") throw new Error("Invalid text block.");
          return part.text;
        }).join("\n");
        if (text.trim()) { this.answer = text; this.diagnostic = undefined; }
        else this.diagnostic = "No non-empty final assistant response.";
      } else {
        const reason = ["length", "error", "aborted", "toolUse", "deferred", "pending"].includes(message.stopReason) ? message.stopReason : "invalid stop reason";
        // Never echo provider error bodies: they may contain credentials or request payloads.
        this.diagnostic = reason === "error" ? "The provider failed; no valid final answer. Check provider availability, credentials, or quota."
          : `No valid final answer (completion: ${reason}).`;
      }
    }
    if (event.type === "error" || event.type === "aborted" || (event.type === "auto_retry_end" && event.success === false)) {
      this.answer = undefined;
      this.diagnostic = "The child reported a failed or aborted run.";
    }
  }
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { JsonLines, Transcript } from "../src/protocol.ts";
import { utf8Head, safeText } from "../src/text.ts";

const usage = { input: 1, output: 2, totalTokens: 3 };
const assistant = (text: string, stopReason = "stop") => ({ role: "assistant", content: [{ type: "text", text }], stopReason, usage });

test("JSONL handles all UTF-8 splits, multiple records, Unicode separators and final record without LF", () => {
  const expected = [{ text: "A😀café\u2028B\u2029C" }, { text: "last" }];
  const bytes = Buffer.from(expected.map(x => JSON.stringify(x)).join("\n"));
  for (let split = 0; split <= bytes.length; split++) {
    const records: unknown[] = [];
    const parser = new JsonLines(record => records.push(record));
    parser.push(bytes.subarray(0, split)); parser.push(bytes.subarray(split)); parser.end();
    assert.deepEqual(records, expected);
  }
});
test("invalid UTF-8, JSON and oversized records fail with bounded storage", () => {
  assert.throws(() => new JsonLines(() => {}, 4).push(Buffer.from("12345")));
  assert.throws(() => new JsonLines(() => {}).push(Buffer.from([255, 10])));
  assert.throws(() => new JsonLines(() => {}).push(Buffer.from("oops\n")));
  assert.throws(() => new Transcript(() => {}).accept({}));
});
test("only finalized last assistant text is authoritative; usage is counted once", () => {
  const transcript = new Transcript(() => {});
  const old = assistant("INTERMEDIATE", "toolUse");
  transcript.accept({ type: "message_end", message: old });
  transcript.accept({ type: "turn_end", message: old });
  transcript.accept({ type: "message_update", usage, assistantMessageEvent: { type: "text_delta", delta: "PRIVATE" } });
  const final = assistant("first");
  final.content.push({ type: "text", text: "second" });
  (final.content as unknown[]).push({ type: "thinking", thinking: "SECRET" });
  transcript.accept({ type: "message_end", message: final });
  transcript.accept({ type: "agent_end", messages: [old, final] });
  assert.equal(transcript.answer, "first\nsecond");
  assert.equal(transcript.usage?.totalTokens, 6);
  transcript.accept({ type: "message_start", message: { role: "assistant" } });
  assert.equal(transcript.answer, undefined);
  transcript.accept({ type: "message_end", message: assistant("partial", "error") });
  assert.equal(transcript.answer, undefined);
});
test("no final answer for tool comments, length, abort, deferred, empty, or provider errors", () => {
  for (const reason of ["toolUse", "length", "aborted", "deferred", "error", "pending", "unknown"]) {
    const t = new Transcript(() => {});
    t.accept({ type: "message_end", message: assistant("not final", reason) });
    assert.equal(t.answer, undefined);
  }
  const t = new Transcript(() => {});
  t.accept({ type: "message_end", message: assistant("  ") });
  assert.equal(t.answer, undefined);
});
test("tool-result nested usage is included without counting tool_execution_end duplicates", () => {
  const t = new Transcript(() => {});
  t.accept({ type: "tool_execution_end", result: { usage } });
  t.accept({ type: "message_end", message: { role: "toolResult", usage } });
  assert.equal(t.usage?.totalTokens, 3);
});
test("ancillary reported usage is counted once, not through duplicate completion snapshots", () => {
  const t = new Transcript(() => {});
  for (const type of ["usage", "compaction", "branch_summary"]) {
    t.accept({ type: "entry_appended", entry: { type, usage } });
  }
  t.accept({ type: "compaction_end", result: { usage } });
  t.accept({ type: "entry_appended", entry: { type: "message", message: assistant("duplicate") } });
  assert.equal(t.usage?.totalTokens, 9);
  t.accept({ type: "message_end", message: assistant("old") });
  t.accept({ type: "agent_end", willRetry: true });
  assert.equal(t.ended, false);
  t.accept({ type: "auto_retry_start" });
  assert.equal(t.answer, undefined);
});
test("UTF-8 truncation never splits code points; terminal text cannot inject controls", () => {
  for (let bytes = 0; bytes < 30; bytes++) {
    const result = utf8Head("😀éab".repeat(20), bytes);
    assert.ok(Buffer.byteLength(result) <= bytes);
    assert.ok(!result.includes("�"));
  }
  assert.equal(safeText("\x1b[31mred\x1b[0m\x1b]52;c;secret\x07\u202e"), "red");
});

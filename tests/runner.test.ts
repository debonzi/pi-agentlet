import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runChild } from "../src/runner.ts";
import { LIMITS } from "../src/limits.ts";
import { fixture, task, wait, eventually } from "./helpers.ts";
import type { Expectation } from "../src/types.ts";

const limits = { timeoutMs: 5000, graceMs: 60, recordBytes: 1024 * 1024 };
const run = (mode: string) => runChild(fixture(mode), task, new AbortController().signal, () => {}, limits);

test("real fixture process extracts all final text blocks, excluding transcript and thinking", async () => {
  const result = await run("success");
  assert.equal(result.state, "completed");
  assert.equal(result.answer, "Final café 😀\nSecond text block");
  assert.equal(result.usage?.totalTokens, 12);
  assert.equal(result.usage?.cost.total, 0.06);
  assert.ok(!JSON.stringify(result).includes("PRIVATE"));
});
test("chunked Unicode and no trailing newline work through subprocess pipes", async () => {
  assert.equal((await run("chunked")).answer, "Final café 😀\nSecond text block");
});
test("child prompt is fresh, self-contained and explicitly prohibits subdelegation", async () => {
  const result = await run("echo");
  assert.match(result.answer!, /Do not delegate work/);
  assert.match(result.answer!, /do not use the subagents tool/);
  assert.match(result.answer!, /Analyze local source/);
  assert.match(result.answer!, /Only concrete findings/);
  assert.doesNotMatch(result.answer!, /PARENT_CONVERSATION|session file|parentSession/);
});
test("process, provider and protocol failures cannot be masked by text", async t => {
  for (const mode of ["invalid", "bad-utf8", "empty", "provider-error", "length", "aborted", "partial-error", "tool-only", "nonzero", "signal"]) {
    await t.test(mode, async () => {
      const result = await run(mode);
      assert.equal(result.state, "failed");
      assert.equal(result.answer, undefined);
      assert.ok(result.diagnostic);
      assert.doesNotMatch(result.diagnostic!, /secret|api-key|PRIVATE/);
    });
  }
});
test("spawn errors settle once without uncaught stream errors", async () => {
  const invocation = fixture(); invocation.command = "/nonexistent/pi-agentlet-test";
  assert.equal((await runChild(invocation, task, new AbortController().signal, () => {}, limits)).state, "failed");
});
test("oversized record terminates the child", async () => {
  const result = await runChild(fixture("oversized"), task, new AbortController().signal, () => {}, { ...limits, recordBytes: 1000 });
  assert.equal(result.state, "failed");
});
test("pre-cancelled invocation does not spawn", async () => {
  const controller = new AbortController(); controller.abort();
  const invocation = fixture(); invocation.command = "/nonexistent";
  assert.equal((await runChild(invocation, task, controller.signal, () => {}, limits)).state, "cancelled");
});
test("runner schedules 20 minutes by default and converts per-task seconds without timer overflow", async t => {
  const timer = t.mock.method(globalThis, "setTimeout");
  for (const timeoutSeconds of [undefined, 1, 1800, LIMITS.maxTimeoutSeconds]) {
    timer.mock.resetCalls();
    const result = await runChild(fixture(), { ...task, timeoutSeconds }, new AbortController().signal, () => {});
    assert.equal(result.state, "completed");
    assert.equal(timer.mock.calls.length, 1);
    assert.equal(timer.mock.calls[0]!.arguments[1], timeoutSeconds === undefined ? 1_200_000 : timeoutSeconds * 1000);
  }
});
test("timeout escalates for a process ignoring SIGTERM", async () => {
  const start = Date.now();
  const result = await runChild(fixture("ignore"), task, new AbortController().signal, () => {}, { ...limits, timeoutMs: 250 });
  assert.equal(result.state, "timed_out");
  assert.ok(Date.now() - start < 3000);
});
test("cancellation kills detached tool descendants as well as the pi process", async () => {
  const controller = new AbortController();
  let pid: number | undefined;
  const work = runChild(fixture("tree"), task, controller.signal, activity => {
    if (activity.startsWith("descendant ")) pid = Number(activity.split(" ")[1]);
  }, limits);
  await eventually(() => pid !== undefined);
  await wait(50); controller.abort();
  assert.equal((await work).state, "cancelled");
  await eventually(() => {
    try { return readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]!.startsWith("Z"); }
    catch { return true; }
  });
});
test("resource verification is required and incompatibilities fail explicitly", async () => {
  for (const mode of ["unverified", "mismatch"]) {
    const invocation = fixture(mode); invocation.expectation = {} as Expectation;
    const result = await runChild(invocation, task, new AbortController().signal, () => {}, limits);
    assert.equal(result.state, "failed");
    assert.match(result.diagnostic!, /resource|configuration/i);
  }
});
test("abort/completion races always settle once", async () => {
  await Promise.all(Array.from({ length: 8 }, async (_, i) => {
    const controller = new AbortController();
    const work = runChild(fixture("success", 20), task, controller.signal, () => {}, limits);
    const timer = setTimeout(() => controller.abort(), i * 10);
    const result = await work; clearTimeout(timer);
    assert.ok(["completed", "cancelled"].includes(result.state));
  }));
});

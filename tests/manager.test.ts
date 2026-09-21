import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { Manager, validateInput } from "../src/manager.ts";
import { runChild } from "../src/runner.ts";
import { LIMITS } from "../src/limits.ts";
import { fixture, task, eventually, wait } from "./helpers.ts";
import type { Details, Runner, RunOutcome } from "../src/types.ts";

function controlled() {
  const starts: string[] = [];
  const release = new Map<string, (outcome: RunOutcome) => void>();
  let active = 0, peak = 0;
  const runner: Runner = async (_invocation, task, signal, activity) => {
    starts.push(task.title); active++; peak = Math.max(peak, active); activity("read private.ts");
    try {
      return await new Promise<RunOutcome>(resolve => {
        const done = (outcome: RunOutcome) => { signal.removeEventListener("abort", abort); resolve(outcome); };
        const abort = () => done({ state: "cancelled", diagnostic: "Cancelled." });
        release.set(task.title, done);
        signal.addEventListener("abort", abort, { once: true });
      });
    } finally { active--; }
  };
  return { runner, starts, release, get peak() { return peak; } };
}
const tasks = (...titles: string[]) => ({ tasks: titles.map(title => ({ ...task, title })) });
const success: RunOutcome = { state: "completed", answer: "Final answer" };

test("all invalid arguments are rejected before any child starts", async () => {
  let starts = 0;
  const manager = new Manager({ runner: async () => { starts++; return success; } });
  for (const input of [null, [], {}, { tasks: [] }, { tasks: [task, { ...task, output: " " }] },
    { tasks: Array(9).fill(task) }, tasks("x".repeat(121)), { ...tasks("one"), mode: "single" },
    { tasks: [{ ...task, task: "x".repeat(LIMITS.inputBytes) }] }, { tasks: [{ ...task, cwd: "/" }] }]) {
    await assert.rejects(manager.execute(input, fixture()));
  }
  assert.equal(starts, 0);
  assert.equal(validateInput(tasks("😀".repeat(120))).length, 1);
});
test("invalid task timeouts reject the entire call before startup", async () => {
  let starts = 0;
  const manager = new Manager({ runner: async () => { starts++; return success; } });
  for (const timeoutSeconds of [0, -1, 1.5, NaN, Infinity, -Infinity, "1200", true, null, {}, [], LIMITS.maxTimeoutSeconds + 1]) {
    await assert.rejects(manager.execute({ tasks: [task, { ...task, timeoutSeconds }] }, fixture()), /timeoutSeconds/);
  }
  assert.equal(starts, 0);
  assert.equal(LIMITS.timeoutMs, 20 * 60 * 1000);
  assert.ok(LIMITS.maxTimeoutSeconds * 1000 <= 2_147_483_647);
  assert.ok((LIMITS.maxTimeoutSeconds + 1) * 1000 > 2_147_483_647);
});
test("per-task timeout overrides survive validation and remain isolated across calls and the queue", async () => {
  const received: (number | undefined)[] = [];
  const manager = new Manager({ concurrency: 1, runner: async (_invocation, task) => {
    received.push(task.timeoutSeconds);
    return success;
  } });
  await Promise.all([
    manager.execute({ tasks: [task, ...[1, 1800, LIMITS.maxTimeoutSeconds].map(timeoutSeconds => ({ ...task, timeoutSeconds }))] }, fixture()),
    manager.execute({ tasks: [task] }, fixture()),
  ]);
  assert.deepEqual(received, [undefined, 1, 1800, LIMITS.maxTimeoutSeconds, undefined]);
});
test("one task completes normally", async () => {
  const manager = new Manager({ runner: async () => success });
  const result = await manager.execute(tasks("one"), fixture());
  assert.equal(result.details.tasks[0]!.state, "completed");
  assert.match(result.content[0]!.text, /Final answer/);
});
test("shared concurrency, FIFO queue, stable result order, and blocking across simultaneous calls", async () => {
  const control = controlled();
  const manager = new Manager({ runner: control.runner });
  let settled = false;
  const first = manager.execute(tasks("a", "b", "c", "d"), fixture()).then(result => { settled = true; return result; });
  const second = manager.execute(tasks("e", "f", "g"), fixture());
  assert.deepEqual(control.starts, ["a", "b", "c", "d", "e"]);
  control.release.get("b")!(success);
  await eventually(() => control.starts.length === 6);
  assert.deepEqual(control.starts, ["a", "b", "c", "d", "e", "f"]);
  assert.equal(settled, false);
  control.release.get("c")!(success);
  await eventually(() => control.starts.length === 7);
  assert.deepEqual(control.starts, ["a", "b", "c", "d", "e", "f", "g"]);
  control.release.get("g")!(success);
  control.release.get("f")!(success);
  control.release.get("e")!(success);
  const secondResult = await second;
  assert.equal(settled, false);
  control.release.get("d")!(success);
  control.release.get("a")!(success);
  const firstResult = await first;
  assert.equal(control.peak, 5);
  assert.deepEqual(firstResult.details.tasks.map(t => t.title), ["a", "b", "c", "d"]);
  assert.deepEqual(secondResult.details.tasks.map(t => t.title), ["e", "f", "g"]);
  assert.equal(new Set([...firstResult.details.tasks, ...secondResult.details.tasks].map(t => t.id)).size, 7);
});
test("progress publishes only changed bounded metadata; final content never contains activity", async () => {
  const control = controlled(); const updates: { content: []; details: Details }[] = [];
  const manager = new Manager({ runner: control.runner });
  const work = manager.execute(tasks("a"), fixture(), undefined, update => updates.push(update));
  await eventually(() => updates.some(u => u.details.tasks[0]?.state === "running" && u.details.tasks[0].activity));
  assert.ok(updates.every(u => u.content.length === 0));
  assert.ok(updates.every(u => u.details.tasks.every(t => t.answer === undefined && t.diagnostic === undefined)));
  assert.ok(updates.some(u => u.details.tasks[0]?.activity === "read private.ts"));
  const count = updates.length; await wait(300); assert.equal(updates.length, count);
  control.release.get("a")!(success);
  const result = await work;
  assert.doesNotMatch(result.content[0]!.text, /private.ts|read|PRIVATE/);
  const settled = updates.length; await wait(300); assert.equal(updates.length, settled);
});
test("cancel before startup, during execution, and in another call's queue", async () => {
  const control = controlled(); const manager = new Manager({ runner: control.runner, concurrency: 1 });
  const pre = new AbortController(); pre.abort();
  const cancelled = await manager.execute(tasks("pre"), fixture(), pre.signal);
  assert.equal(cancelled.details.tasks[0]!.state, "cancelled");
  assert.equal(control.starts.length, 0);
  const running = new AbortController();
  const first = manager.execute(tasks("active", "queued"), fixture(), running.signal);
  const queued = new AbortController();
  const second = manager.execute(tasks("other"), fixture(), queued.signal);
  queued.abort();
  assert.equal((await second).details.tasks[0]!.state, "cancelled");
  running.abort();
  assert.ok((await first).details.tasks.every(t => t.state === "cancelled"));
  assert.deepEqual(control.starts, ["active"]);
});
test("shutdown/reload cleanup is idempotent and stops progress immediately", async () => {
  const control = controlled(); const manager = new Manager({ runner: control.runner });
  let updates = 0;
  const work = manager.execute(tasks("a", "b", "c"), fixture(), undefined, () => { updates++; });
  await manager.shutdown(); await manager.shutdown();
  assert.ok((await work).details.tasks.every(t => t.state === "cancelled"));
  const count = updates; await wait(300); assert.equal(updates, count);
  await assert.rejects(manager.execute(tasks("later"), fixture()), /shut down/);
});
test("individual timeout/failure preserves siblings and includes failed reported usage", async () => {
  const manager = new Manager({ runner: (invocation, task, signal, activity) => runChild(
    { ...invocation, args: [...fixture(task.title).args] }, task, signal, activity,
    { timeoutMs: 5000, graceMs: 30, recordBytes: 1024 * 1024 },
  ) });
  const result = await manager.execute({ tasks: [
    { ...task, title: "ignore", timeoutSeconds: 1 },
    { ...task, title: "provider-error" },
    { ...task, title: "success", timeoutSeconds: 2 },
  ] }, fixture());
  assert.deepEqual(result.details.tasks.map(t => t.state), ["timed_out", "failed", "completed"]);
  assert.equal(result.usage?.totalTokens, 24);
  assert.match(result.content[0]!.text, /Final café/);
  assert.doesNotMatch(result.content[0]!.text, /PRIVATE/);
});
test("8 KiB UTF-8 cap includes visible notice; private artifact preserves only complete final answer", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agentlet-test-"));
  try {
    const full = "😀é".repeat(5000);
    const manager = new Manager({ artifactRoot: root, runner: async () => ({ state: "completed", answer: full }) });
    const result = await manager.execute(tasks("large"), fixture());
    const row = result.details.tasks[0]!;
    assert.equal(row.truncated, true);
    assert.ok(Buffer.byteLength(row.answer!) <= LIMITS.answerBytes);
    assert.ok(!row.answer!.includes("�"));
    assert.match(row.answer!, /Truncated/);
    assert.match(row.artifact!, /\/pi-agentlet-result-[^/]+\/answer\.txt$/);
    assert.equal(await readFile(row.artifact!, "utf8"), full);
    assert.equal((await stat(row.artifact!)).mode & 0o777, 0o600);
    assert.equal((await stat(dirname(row.artifact!))).mode & 0o777, 0o700);
    await manager.shutdown();
    assert.equal(await readFile(row.artifact!, "utf8"), full);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("queue time does not consume the next child's execution timeout", async () => {
  const manager = new Manager({ concurrency: 1, runner: (_invocation, task, signal, activity) => runChild(
    fixture("success", task.title === "first" ? 1200 : 0), task, signal, activity,
    { timeoutMs: 3000, graceMs: 30, recordBytes: 1024 * 1024 },
  ) });
  const result = await manager.execute({ tasks: [
    { ...task, title: "first", timeoutSeconds: 3 },
    { ...task, title: "second", timeoutSeconds: 1 },
  ] }, fixture());
  assert.ok(result.details.tasks.every(t => t.state === "completed"));
  assert.ok(result.details.tasks[1]!.startedAt! >= result.details.tasks[0]!.endedAt!);
});
test("broken progress observers cannot abandon children or queues", async () => {
  const manager = new Manager({ runner: async () => success });
  const result = await manager.execute(tasks("one", "two", "three"), fixture(), undefined, () => { throw new Error("Detached renderer"); });
  assert.ok(result.details.tasks.every(t => t.state === "completed"));
  await manager.shutdown();
});
test("artifact paths cannot escape the outside-repository check through symlinks or a nested cwd", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agentlet-artifact-boundary-"));
  try {
    const repo = join(root, "repo"), cwd = join(repo, "src"), storage = join(repo, "storage"), alias = join(root, "alias");
    await mkdir(join(repo, ".git"), { recursive: true });
    await mkdir(cwd); await mkdir(storage); await symlink(storage, alias);
    for (const artifactRoot of [storage, alias]) {
      const manager = new Manager({ artifactRoot, runner: async () => ({ state: "completed", answer: "x".repeat(9000) }) });
      const result = await manager.execute(tasks("large"), { ...fixture(), cwd });
      assert.equal(result.details.tasks[0]!.state, "failed");
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("artifact failures are explicit and do not leak an oversized answer", async () => {
  const manager = new Manager({ artifactRoot: "/nonexistent/pi-agentlet", runner: async () => ({ state: "completed", answer: "x".repeat(9000) }) });
  const result = await manager.execute(tasks("large"), fixture());
  assert.equal(result.details.tasks[0]!.state, "failed");
  assert.ok(result.content[0]!.text.length < 1000);
});

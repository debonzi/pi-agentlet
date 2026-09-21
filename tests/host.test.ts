import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { getEventListeners } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Details, TaskState } from "../src/types.ts";
import { task } from "./helpers.ts";

const mocked = new URL("./fixtures/host.mjs", import.meta.url).href;
registerHooks({ resolve(specifier, context, next) {
  if (["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui", "typebox"].includes(specifier)
    || (specifier === "./runner.ts" && context.parentURL?.endsWith("/src/manager.ts"))) {
    return { url: mocked, shortCircuit: true };
  }
  return next(specifier, context);
} });
const { default: extension } = await import("../index.ts");
const { callView, resultView, RunningAnimation } = await import("../src/ui.ts");
const theme = { fg: (_color: string, text: string) => text } as Theme;

test("pi-agentlet package includes minimalist branding, the root entry point, and maintained documentation", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.name, "pi-agentlet");
  assert.match(manifest.description, /Minimalist subagents for pi/);
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /^# pi-agentlet\n/);
  assert.ok(readme.includes(manifest.description));
  assert.deepEqual(manifest.pi.extensions, ["./index.ts"]);
  assert.ok(manifest.files.includes("index.ts"));
  assert.ok(manifest.files.includes("src"));
  assert.ok(manifest.files.includes("docs"));
  for (const document of ["functional-spec.md", "architecture.md", "compatibility.md", "development.md"]) {
    assert.match(await readFile(new URL(`../docs/${document}`, import.meta.url), "utf8"), /^# /);
  }
  const { default: implementation } = await import("../src/index.ts");
  assert.equal(extension, implementation);
});

test("renderers handle narrow terminals, every state, terminal injection, and expansion", () => {
  const states: TaskState[] = ["queued", "running", "completed", "failed", "cancelled", "timed_out"];
  const details: Details = { tasks: states.map((state, i) => ({
    id: `s${i}`, title: "Review\x1b]52;c;secret\x07", state,
    answer: state === "completed" ? "No findings." : undefined,
    activity: "read file.ts\x1b[31m", startedAt: 1, endedAt: 1000,
  })) };
  for (const width of [0, 1, 2, 10, 30, 80]) {
    for (const view of [callView([task], theme), resultView(details, "", false, theme), resultView(details, "", true, theme, [task])]) {
      const lines = view.render(width);
      assert.ok(lines.every(line => [...line].length <= width));
      assert.ok(lines.every(line => !line.includes("\x1b")));
      view.invalidate();
    }
  }
  const text = resultView(details, "", true, theme).render(200).join("\n");
  for (const state of states) assert.ok(text.includes(state));
  assert.match(text, /No findings/);
  assert.doesNotThrow(() => callView(undefined, theme).render(10));
  assert.doesNotThrow(() => resultView(undefined, "Error", true, theme).render(10));
});
test("Working animation uses 80ms frames, pauses without running tasks, and disposes on abort", t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const controller = new AbortController();
  const animation = new RunningAnimation(controller.signal);
  let redraws = 0;
  const invalidate = () => { redraws++; };
  assert.equal(animation.frame(false, invalidate), undefined);
  t.mock.timers.tick(800);
  assert.equal(redraws, 0);
  assert.equal(animation.frame(true, invalidate), "⠋");
  t.mock.timers.tick(79);
  assert.equal(redraws, 0);
  t.mock.timers.tick(1);
  assert.equal(animation.frame(true, invalidate), "⠙");
  for (const frame of ["⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏", "⠋"]) {
    t.mock.timers.tick(80);
    assert.equal(animation.frame(true, invalidate), frame);
  }
  assert.equal(redraws, 10); // Repeated renders must not create additional timers.
  animation.frame(false, invalidate);
  t.mock.timers.tick(800);
  assert.equal(redraws, 10);
  animation.frame(true, invalidate);
  assert.equal(getEventListeners(controller.signal, "abort").length, 1);
  controller.abort();
  animation.stop();
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  assert.equal(animation.frame(true, invalidate), undefined);
  t.mock.timers.tick(800);
  assert.equal(redraws, 10);
  const cancelled = new RunningAnimation(controller.signal);
  assert.equal(cancelled.frame(true, invalidate), undefined);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("animation cleanup isolates concurrent calls and detached renderers", t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const first = new RunningAnimation();
  const second = new RunningAnimation();
  let firstRedraws = 0, secondRedraws = 0;
  first.frame(true, () => { firstRedraws++; });
  second.frame(true, () => { secondRedraws++; });
  t.mock.timers.tick(80);
  first.stop();
  t.mock.timers.tick(80);
  assert.equal(firstRedraws, 1);
  assert.equal(secondRedraws, 2);
  second.frame(true, () => { throw new Error("Detached renderer"); });
  assert.doesNotThrow(() => t.mock.timers.tick(80));
  assert.equal(second.frame(true, () => { secondRedraws++; }), undefined);
  t.mock.timers.tick(800);
  assert.equal(secondRedraws, 2);
  second.stop();
});

test("animated icons affect only running tasks in compact and expanded views", () => {
  const states: TaskState[] = ["queued", "running", "completed", "failed", "cancelled", "timed_out"];
  const details: Details = { tasks: states.map((state, i) => ({ id: `s${i}`, title: "Review", state })) };
  for (const expanded of [false, true]) {
    const view = resultView(details, "", expanded, theme, [task], "⠙");
    assert.deepEqual(view.render(200).filter(line => / s\d /.test(line)).map(line => line.split(" ")[0]),
      ["·", "⠙", "✓", "✗", "⊘", "⌛"]);
    for (const width of [0, 1, 2, 10, 30, 80]) assert.ok(view.render(width).every(line => [...line].length <= width));
  }
});

test("host registration, headless execution, compact updates, errors and lifecycle work without TUI or direct stdout", async t => {
  const handlers = new Map<string, (...args: any[]) => any>();
  let tool: ToolDefinition<any, Details> | undefined;
  let starts = 0;
  const pi = {
    on: (name: string, handler: (...args: any[]) => any) => { handlers.set(name, handler); },
    registerTool: (definition: typeof tool) => { tool = definition; starts++; },
    getActiveTools: () => ["subagents"],
    getAllTools: () => [{ name: "subagents", description: "delegate", parameters: {}, sourceInfo: { source: "local" } }],
    getThinkingLevel: () => "high",
  } as unknown as ExtensionAPI;
  extension(pi);
  assert.equal(starts, 1);
  assert.equal(tool!.name, "subagents");
  assert.ok(tool!.promptGuidelines!.every(line => line.includes("subagents")));
  assert.deepEqual([...handlers.keys()].sort(), ["before_agent_start", "session_shutdown", "session_start"]);
  const ctx = { cwd: process.cwd(), model: { provider: "mock", id: "mock" }, thinkingLevel: "high", isProjectTrusted: () => true,
    modelRegistry: { getRegisteredProviderConfig: () => undefined, getRegisteredNativeProvider: () => undefined },
    mode: "json", hasUI: false, ui: new Proxy({}, { get() { throw new Error("TUI must not be accessed"); } }) } as any;
  await assert.rejects(tool!.execute("bad", { tasks: [] }, undefined, undefined, ctx), /tasks/);
  await assert.rejects(tool!.execute("early", { tasks: [task] }, undefined, undefined, ctx), /configuration/);
  const root = await mkdtemp(join(tmpdir(), "pi-agentlet-host-"));
  const originalScript = process.argv[1];
  try {
    await mkdir(join(root, "dist/bundle"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({
      name: "@earendil-works/pi-coding-agent", bin: { pi: "dist/bundle/cli.js" },
    }));
    const script = join(root, "dist/bundle/cli.js"); await writeFile(script, "");
    process.argv[1] = script;
    await handlers.get("session_start")!({ reason: "startup" }, ctx);
    await handlers.get("before_agent_start")!({ systemPromptOptions: {} }, ctx);
    const updates: any[] = [];
    let writes = 0;
    const originalWrite = process.stdout.write;
    process.stdout.write = (() => { writes++; return true; }) as typeof process.stdout.write;
    let result;
    try { result = await tool!.execute("valid", { tasks: [task] }, undefined, update => updates.push(update), ctx); }
    finally { process.stdout.write = originalWrite; }
    assert.equal(writes, 0);
    assert.ok(updates.length > 1);
    assert.ok(updates.every(u => u.content.length === 0));
    assert.match(JSON.stringify(result.content), /No findings/);
    assert.doesNotMatch(JSON.stringify(result.content), /fixture.ts/);
    t.mock.timers.enable({ apis: ["setInterval"] });
    ctx.mode = "tui";
    const row = (id: string) => {
      let latest: any, text = "", redraws = 0, updates = 0;
      const context = { toolCallId: id, args: { tasks: [task] }, invalidate: () => { redraws++; render(); } } as any;
      const render = (isPartial = true) => {
        text = tool!.renderResult!(latest, { expanded: false, isPartial }, theme, context).render(200).join("\n");
      };
      return {
        update: (result: any) => { updates++; latest = result; render(); },
        render, text: () => text, redraws: () => redraws, updates: () => updates,
      };
    };
    const completed = row("animated");
    const completeSignal = new AbortController();
    const pendingComplete = tool!.execute("animated", { tasks: [task] }, completeSignal.signal, completed.update, ctx);
    t.mock.timers.tick(250); // First running metadata update starts the UI-only clock.
    assert.match(completed.text(), /⠋ .*running/);
    assert.equal(completed.updates(), 2);
    t.mock.timers.tick(80);
    assert.equal(completed.redraws(), 1);
    assert.equal(completed.updates(), 2); // Animation ticks never publish tool progress.
    assert.match(completed.text(), /⠙ .*running/);
    const final = await pendingComplete;
    assert.equal(getEventListeners(completeSignal.signal, "abort").length, 0);
    t.mock.timers.tick(800);
    assert.equal(completed.redraws(), 1);
    completed.update(final);
    assert.match(completed.text(), /✓ .*completed/);

    const first = row("first"), second = row("second");
    const controller = new AbortController();
    const pendingFirst = tool!.execute("first", { tasks: [task] }, controller.signal, first.update, ctx);
    const pendingSecond = tool!.execute("second", { tasks: [task] }, undefined, second.update, ctx);
    t.mock.timers.tick(250);
    controller.abort();
    t.mock.timers.tick(80);
    assert.equal(first.redraws(), 0);
    assert.equal(second.redraws(), 1);
    first.render(); // A stale partial result must not restart a cancelled animation.
    assert.doesNotMatch(first.text(), /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
    await Promise.all([pendingFirst, pendingSecond]);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);

    // Restored rows, finalized results, and headless calls cannot create UI clocks.
    const running = { content: [], details: { tasks: [{ id: "s1", title: "Review", state: "running" }] } };
    const restored = row("restored");
    restored.update(running);
    assert.match(restored.text(), /◌ .*running/);
    const finalRow = row("final-row");
    const pendingFinalRow = tool!.execute("final-row", { tasks: [task] }, undefined, undefined, ctx);
    finalRow.update(running);
    finalRow.render(false);
    t.mock.timers.tick(80);
    assert.equal(finalRow.redraws(), 0);
    await pendingFinalRow;
    for (const mode of ["json", "print", "rpc"]) {
      ctx.mode = mode;
      const headless = row(mode);
      const pending = tool!.execute(mode, { tasks: [task] }, undefined, headless.update, ctx);
      t.mock.timers.tick(330);
      assert.match(headless.text(), /◌ .*running/);
      assert.equal(headless.redraws(), 0);
      await pending;
    }
    ctx.mode = "tui";
    for (const reason of ["quit", "reload", "new", "resume", "fork"]) {
      const active = row(reason);
      const pending = tool!.execute(reason, { tasks: [task, task, task] }, undefined, active.update, ctx);
      t.mock.timers.tick(250);
      t.mock.timers.tick(80);
      assert.equal(active.redraws(), 1);
      const shutdown = handlers.get("session_shutdown")!({ reason }, ctx);
      t.mock.timers.tick(800);
      assert.equal(active.redraws(), 1);
      active.render(); // Teardown must also prevent stale renderers from restarting timers.
      assert.doesNotMatch(active.text(), /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
      await shutdown;
      assert.ok((await pending).details.tasks.every(t => t.state === "cancelled"));
      await handlers.get("before_agent_start")!({ systemPromptOptions: {} }, ctx);
      const closedSignal = new AbortController();
      await assert.rejects(tool!.execute("closed", { tasks: [task] }, closedSignal.signal, undefined, ctx), /shut down/);
      assert.equal(getEventListeners(closedSignal.signal, "abort").length, 0);
      await handlers.get("session_start")!({ reason }, ctx);
      await handlers.get("before_agent_start")!({ systemPromptOptions: {} }, ctx);
    }
  } finally {
    process.argv[1] = originalScript;
    await rm(root, { recursive: true, force: true });
  }
});

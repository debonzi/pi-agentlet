import { randomUUID } from "node:crypto";
import { LIMITS } from "./limits.ts";
import { capAnswer, toolResult } from "./results.ts";
import { runChild } from "./runner.ts";
import { oneLine } from "./text.ts";
import type { Details, Invocation, Runner, Task, TaskResult } from "./types.ts";

export function validateInput(input: unknown): Task[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("subagents expects an object with tasks.");
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => key !== "tasks")) throw new Error("subagents accepts only the tasks field.");
  if (!Array.isArray(value.tasks) || value.tasks.length === 0 || value.tasks.length > LIMITS.tasks) {
    throw new Error(`subagents requires 1–${LIMITS.tasks} tasks.`);
  }
  const tasks = value.tasks.map((value: unknown, i) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Task ${i + 1} must be an object.`);
    const task = value as Record<string, unknown>;
    if (Object.keys(task).some(key => !["title", "task", "output", "timeoutSeconds"].includes(key))) throw new Error(`Task ${i + 1} has unsupported fields.`);
    for (const key of ["title", "task", "output"]) {
      if (typeof task[key] !== "string" || !task[key].trim()) throw new Error(`Task ${i + 1}: ${key} must be a non-empty string.`);
    }
    if ([...(task.title as string)].length > LIMITS.titleChars) throw new Error(`Task ${i + 1}: title exceeds ${LIMITS.titleChars} characters.`);
    const timeoutSeconds = task.timeoutSeconds;
    if (timeoutSeconds !== undefined && (typeof timeoutSeconds !== "number" || !Number.isInteger(timeoutSeconds)
      || timeoutSeconds < 1 || timeoutSeconds > LIMITS.maxTimeoutSeconds)) {
      throw new Error(`Task ${i + 1}: timeoutSeconds must be an integer between 1 and ${LIMITS.maxTimeoutSeconds}.`);
    }
    return { title: task.title as string, task: task.task as string, output: task.output as string,
      ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }) };
  });
  if (Buffer.byteLength(JSON.stringify(tasks)) > LIMITS.inputBytes) throw new Error("Delegation input exceeds 256 KiB.");
  return tasks;
}

interface Job {
  result: TaskResult;
  task: Task;
  invocation: Invocation;
  controller: AbortController;
  finish: () => void;
}
interface Call { controller: AbortController; done: Promise<void> }
export class Manager {
  private queue: Job[] = [];
  private calls = new Set<Call>();
  private active = 0;
  private closed = false;
  private runner: Runner;
  private concurrency: number;
  private artifactRoot?: string;
  constructor(options: { runner?: Runner; concurrency?: number; artifactRoot?: string } = {}) {
    this.runner = options.runner ?? runChild;
    this.concurrency = options.concurrency ?? LIMITS.concurrency;
    if (!Number.isInteger(this.concurrency) || this.concurrency < 1) throw new Error("Invalid concurrency.");
    this.artifactRoot = options.artifactRoot;
  }
  async execute(input: unknown, invocation: Invocation, signal?: AbortSignal,
    update?: (result: { content: []; details: Details }) => void) {
    const tasks = validateInput(input); // All arguments are validated before queueing anything.
    if (this.closed) throw new Error("subagents runtime has shut down.");
    const controller = new AbortController();
    const prefix = randomUUID().slice(0, 8);
    const results: TaskResult[] = tasks.map((t, i) => ({ id: `${prefix}-s${i + 1}`, title: t.title, state: "queued" }));
    let stoppedUpdates = false;
    let lastProgress = "";
    const publish = () => {
      if (!update || stoppedUpdates || this.closed || controller.signal.aborted) return;
      // Publish only bounded presentation metadata. Child answers and diagnostics stay private.
      const details: Details = { tasks: results.map(({ id, title, state, startedAt, endedAt, activity }) =>
        ({ id, title, state, startedAt, endedAt, activity })) };
      const progress = JSON.stringify(details);
      if (progress === lastProgress) return;
      lastProgress = progress;
      try { update({ content: [], details }); }
      catch { /* A detached UI observer must not interrupt process cleanup. */ }
    };
    const cancel = () => {
      controller.abort();
      const pending = this.queue.filter(job => job.controller === controller);
      this.queue = this.queue.filter(job => job.controller !== controller);
      for (const job of pending) {
        Object.assign(job.result, { state: "cancelled", endedAt: Date.now(), diagnostic: "Cancelled while queued." });
        job.finish();
      }
    };
    const promises = tasks.map((task, i) => new Promise<void>(finish => {
      this.queue.push({ task, result: results[i]!, invocation, controller, finish });
    }));
    const done = Promise.all(promises).then(() => {});
    const call = { controller, done };
    this.calls.add(call);
    signal?.addEventListener("abort", cancel, { once: true });
    controller.signal.addEventListener("abort", cancelQueued, { once: true });
    function cancelQueued() { cancel(); }
    let timer: NodeJS.Timeout | undefined;
    try {
      if (signal?.aborted) cancel();
      publish();
      if (update && !controller.signal.aborted) timer = setInterval(publish, LIMITS.updateMs);
      this.drain();
      await done;
      return toolResult(results);
    } finally {
      stoppedUpdates = true;
      clearInterval(timer);
      signal?.removeEventListener("abort", cancel);
      controller.signal.removeEventListener("abort", cancelQueued);
      this.calls.delete(call);
    }
  }
  private drain(): void {
    while (!this.closed && this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift()!;
      if (job.controller.signal.aborted) {
        Object.assign(job.result, { state: "cancelled", endedAt: Date.now(), diagnostic: "Cancelled before startup." });
        job.finish();
        continue;
      }
      this.active++;
      job.result.state = "running";
      job.result.startedAt = Date.now();
      void this.run(job);
    }
  }
  private async run(job: Job): Promise<void> {
    try {
      const outcome = await this.runner(job.invocation, job.task, job.controller.signal, text => {
        if (!this.closed && !job.controller.signal.aborted) job.result.activity = oneLine(text, LIMITS.activityChars);
      });
      Object.assign(job.result, outcome, { endedAt: Date.now() });
      try { await capAnswer(job.result, job.invocation.cwd, this.artifactRoot); }
      catch {
        job.result.state = "failed";
        job.result.answer = undefined;
        job.result.diagnostic = "Could not preserve the complete final answer in a private artifact; result withheld.";
      }
    } catch {
      job.result.state = job.controller.signal.aborted ? "cancelled" : "failed";
      job.result.diagnostic = "Child runner failed; no valid final answer.";
      job.result.endedAt = Date.now();
    } finally {
      this.active--;
      job.finish();
      this.drain();
    }
  }
  async shutdown(): Promise<void> {
    this.closed = true;
    for (const call of this.calls) call.controller.abort();
    await Promise.all([...this.calls].map(call => call.done));
  }
}

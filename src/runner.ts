import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { LIMITS } from "./limits.ts";
import { childPrompt } from "./prompt.ts";
import { JsonLines, Transcript } from "./protocol.ts";
import { ProcessTree } from "./process-tree.ts";
import type { Invocation, RunOutcome, Task } from "./types.ts";

export interface RunnerLimits { timeoutMs: number; graceMs: number; recordBytes: number }
export function runChild(invocation: Invocation, task: Task, signal: AbortSignal,
  activity: (text: string) => void, limits: RunnerLimits = LIMITS): Promise<RunOutcome> {
  if (signal.aborted) return Promise.resolve({ state: "cancelled", diagnostic: "Cancelled before startup." });
  if (process.platform !== "linux") return Promise.resolve({ state: "failed", diagnostic: "Process-tree cleanup currently requires Linux." });
  return new Promise(resolve => {
    const transcript = new Transcript(activity);
    let state: RunOutcome["state"] | undefined;
    let diagnostic: string | undefined;
    let settled = false;
    let closed = false;
    let code: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let timeout: NodeJS.Timeout | undefined;
    let force: NodeJS.Timeout | undefined;
    let monitor: NodeJS.Timeout | undefined;
    let tree: ProcessTree | undefined;
    let verified = !invocation.expectation;
    let badProtocol = false;
    const proc = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd, env: invocation.env, shell: false, detached: true,
      stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
    });
    const config = proc.stdio[3] as Writable;
    const verification = proc.stdio[4] as Readable;
    const finish = () => {
      if (settled || !closed || force) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(monitor);
      signal.removeEventListener("abort", cancel);
      // Even successful children must not leave tool descendants behind.
      tree?.signal("SIGKILL");
      proc.stdin!.destroy();
      proc.stdout!.destroy();
      proc.stderr!.destroy();
      config.destroy();
      verification.destroy();
      if (!state) {
        if (exitSignal) { state = "failed"; diagnostic = `Child terminated by ${exitSignal}.`; }
        else if (code !== 0) { state = "failed"; diagnostic ??= `Child exited with code ${code ?? "unknown"}; no valid final answer.`; }
        else if (!verified) { state = "failed"; diagnostic = "Child did not verify resource equivalence; no provider result accepted."; }
        else if (!transcript.ended || !transcript.answer) { state = "failed"; diagnostic = transcript.diagnostic ?? "Child exited without a valid final assistant response."; }
        else state = "completed";
      }
      resolve({ state, diagnostic, answer: state === "completed" ? transcript.answer : undefined, usage: transcript.usage });
    };
    const stop = (reason: RunOutcome["state"], message: string) => {
      if (settled || state) return;
      state = reason;
      diagnostic = message;
      clearTimeout(timeout);
      if (proc.pid) {
        tree ??= new ProcessTree(proc.pid);
        tree.signal("SIGTERM");
        force = setTimeout(() => {
          tree?.signal("SIGKILL");
          force = undefined;
          finish();
        }, limits.graceMs);
      }
    };
    const cancel = () => stop("cancelled", "Cancelled by the parent session.");
    const parser = new JsonLines(value => transcript.accept(value), limits.recordBytes);
    const checks = new JsonLines(value => {
      if (!value || typeof value !== "object") throw new Error("Invalid verification.");
      const check = value as { ready?: boolean; error?: string };
      if (check.ready === true) verified = true;
      if (typeof check.error === "string") {
        // Only our fixed-category diagnostic, never arbitrary child payloads.
        stop("failed", "Resource incompatibility: child configuration differs from the parent. No fallback was used.");
      }
    }, 4096);
    proc.on("spawn", () => {
      if (proc.pid) tree ??= new ProcessTree(proc.pid);
      monitor = setInterval(() => tree?.refresh(), LIMITS.updateMs);
      if (!signal.aborted && !state) activity("starting pi");
    });
    proc.stdout!.on("data", (data: Buffer) => {
      if (badProtocol) return;
      try { parser.push(data); }
      catch { badProtocol = true; stop("failed", "Invalid JSONL/UTF-8 output or event record safety limit exceeded."); }
    });
    proc.stdout!.on("error", () => stop("failed", "Child output pipe failed."));
    // Drain, but do not retain or expose potentially sensitive provider/extension logs.
    proc.stderr!.on("data", () => {});
    proc.stderr!.on("error", () => stop("failed", "Child diagnostic pipe failed."));
    verification.on("data", (data: Buffer) => {
      try { checks.push(data); }
      catch { stop("failed", "Invalid child resource-verification protocol."); }
    });
    proc.on("error", () => stop("failed", "Could not start the pi child process."));
    // EPIPE is common when startup fails. close/error is authoritative, not a write callback.
    proc.stdin!.on("error", () => {});
    config.on("error", () => {});
    verification.on("error", () => stop("failed", "Child verification pipe failed."));
    proc.on("close", (exitCode, terminatedBy) => {
      closed = true;
      code = exitCode;
      exitSignal = terminatedBy;
      clearTimeout(timeout);
      clearInterval(monitor);
      if (!badProtocol) {
        try { parser.end(); checks.end(); }
        catch { stop("failed", "Invalid or incomplete JSONL output at child exit."); }
      }
      finish();
    });
    signal.addEventListener("abort", cancel, { once: true });
    timeout = setTimeout(() => stop("timed_out", "Child execution exceeded its time limit."),
      task.timeoutSeconds === undefined ? limits.timeoutMs : task.timeoutSeconds * 1000);
    if (signal.aborted) cancel();
    config.end(JSON.stringify(invocation.expectation ?? {}));
    proc.stdin!.end(childPrompt(task));
  });
}

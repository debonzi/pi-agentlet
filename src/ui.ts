import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Details, Task, TaskResult } from "./types.ts";
import { oneLine, safeText } from "./text.ts";
import { LIMITS } from "./limits.ts";

// Match pi 0.86.1's Working Loader without requiring its private TUI instance.
const workingFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export class RunningAnimation {
  private timer?: NodeJS.Timeout;
  private invalidate?: () => void;
  private index = 0;
  private stopped = false;
  private signal?: AbortSignal;
  constructor(signal?: AbortSignal) {
    this.signal = signal;
    if (signal?.aborted) this.stop();
    else signal?.addEventListener("abort", this.stop, { once: true });
  }
  frame(active: boolean, invalidate: () => void): string | undefined {
    if (this.stopped) return undefined;
    if (!active) {
      clearInterval(this.timer);
      this.timer = undefined;
      this.invalidate = undefined;
      return undefined;
    }
    this.invalidate = invalidate;
    if (!this.timer) {
      this.timer = setInterval(() => {
        if (this.stopped) return;
        this.index = (this.index + 1) % workingFrames.length;
        try { this.invalidate?.(); }
        catch { this.stop(); } // A detached renderer must not affect execution or cleanup.
      }, LIMITS.animationMs);
      this.timer.unref();
    }
    return workingFrames[this.index];
  }
  stop = (): void => {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = undefined;
    this.invalidate = undefined;
    this.signal?.removeEventListener("abort", this.stop);
    this.signal = undefined;
  };
}

const icons = { queued: "·", running: "◌", completed: "✓", failed: "✗", cancelled: "⊘", timed_out: "⌛" };
function color(task: TaskResult) {
  return task.state === "completed" ? "success" : task.state === "failed" ? "error"
    : task.state === "queued" ? "dim" : "warning";
}
export function callView(tasks: Partial<Task>[] | undefined, theme: Theme): Component {
  return {
    invalidate() {},
    render(width) {
      if (width <= 0) return [];
      return [theme.fg("toolTitle", `subagents · ${tasks?.length ?? "…"} tasks`),
        ...(tasks ?? []).map(t => theme.fg("muted", oneLine(t?.title ?? "…", 120)))].map(line => truncateToWidth(line, width));
    },
  };
}
export function resultView(details: Details | undefined, fallback: string, expanded: boolean, theme: Theme,
  tasks?: Partial<Task>[], runningIcon?: string): Component {
  return {
    invalidate() {},
    render(width) {
      if (width <= 0) return [];
      if (!details?.tasks) return wrapTextWithAnsi(safeText(fallback), width).map(line => truncateToWidth(line, width));
      const terminal = details.tasks.filter(t => t.state !== "queued" && t.state !== "running").length;
      const lines = [theme.fg("muted", `subagents · ${terminal}/${details.tasks.length} finished`)];
      for (const [i, task] of details.tasks.entries()) {
        const elapsed = task.startedAt ? ` ${Math.max(0, Math.round(((task.endedAt ?? Date.now()) - task.startedAt) / 1000))}s` : "";
        lines.push(theme.fg(color(task), `${task.state === "running" ? runningIcon ?? icons.running : icons[task.state]} ${task.id} ${oneLine(task.title, 120)} — ${task.state}${elapsed}`));
        if (task.state === "running" && task.activity) lines.push(theme.fg("dim", `  ${oneLine(task.activity, 160)}`));
        if (task.state === "completed" && task.answer && !expanded) lines.push(theme.fg("muted", `  ${oneLine(task.answer, 120)}`));
        if (expanded) {
          const content = [tasks?.[i]?.task, tasks?.[i]?.output && `Expected output: ${tasks[i]!.output}`,
            task.answer, task.diagnostic,
            task.usage && `Reported usage: ${task.usage.totalTokens} tokens; reported cost: $${task.usage.cost.total.toFixed(6)}`,
          ].filter((s): s is string => typeof s === "string");
          for (const text of content) lines.push(...wrapTextWithAnsi(safeText(text), width).map(line => theme.fg("toolOutput", line)));
        }
      }
      return lines.map(line => truncateToWidth(line, width));
    },
  };
}

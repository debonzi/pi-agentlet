import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Details, Task, TaskResult } from "./types.ts";
import { oneLine, safeText } from "./text.ts";

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
  tasks?: Partial<Task>[]): Component {
  return {
    invalidate() {},
    render(width) {
      if (width <= 0) return [];
      if (!details?.tasks) return wrapTextWithAnsi(safeText(fallback), width).map(line => truncateToWidth(line, width));
      const terminal = details.tasks.filter(t => t.state !== "queued" && t.state !== "running").length;
      const lines = [theme.fg("muted", `subagents · ${terminal}/${details.tasks.length} finished`)];
      for (const [i, task] of details.tasks.entries()) {
        const elapsed = task.startedAt ? ` ${Math.max(0, Math.round(((task.endedAt ?? Date.now()) - task.startedAt) / 1000))}s` : "";
        lines.push(theme.fg(color(task), `${icons[task.state]} ${task.id} ${oneLine(task.title, 120)} — ${task.state}${elapsed}`));
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

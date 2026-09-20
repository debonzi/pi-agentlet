import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, join, relative, isAbsolute } from "node:path";
import { LIMITS } from "./limits.ts";
import { oneLine, utf8Head } from "./text.ts";
import { addUsage } from "./usage.ts";
import type { TaskResult } from "./types.ts";

export async function capAnswer(result: TaskResult, cwd: string, root?: string): Promise<void> {
  if (result.answer === undefined || Buffer.byteLength(result.answer) <= LIMITS.answerBytes) return;
  let boundary = await realpath(cwd);
  for (let dir = boundary; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) { boundary = dir; break; }
    if (dirname(dir) === dir) break;
  }
  let base: string | undefined;
  for (const candidate of root ? [root] : [tmpdir(), homedir()]) {
    const canonical = await realpath(candidate);
    const rel = relative(boundary, canonical);
    if (rel.startsWith("../") || isAbsolute(rel)) { base = canonical; break; }
  }
  if (!base) throw new Error("No artifact location outside the repository/working directory is available.");
  const dir = await mkdtemp(join(base, "pi-agentlet-result-"));
  const path = join(dir, "answer.txt");
  try {
    await chmod(dir, 0o700);
    await writeFile(path, result.answer, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
  result.artifact = path;
  result.truncated = true;
  const notice = `\n\n[Truncated to 8 KiB. Full final answer: ${path}]`;
  result.answer = utf8Head(result.answer, LIMITS.answerBytes - Buffer.byteLength(notice)) + notice;
}

export function toolResult(tasks: TaskResult[]) {
  const usage = tasks.reduce((total, task) => addUsage(total, task.usage), undefined as TaskResult["usage"]);
  return {
    content: [{ type: "text" as const, text: tasks.map(t =>
      `## ${t.id} — ${oneLine(t.title, LIMITS.titleChars)} — ${t.state}\n\n${t.answer ?? t.diagnostic ?? "No final answer."}`,
    ).join("\n\n") }],
    details: { tasks: tasks.map(t => ({ ...t, activity: undefined })) },
    ...(usage ? { usage } : {}),
  };
}

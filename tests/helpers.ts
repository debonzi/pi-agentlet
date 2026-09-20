import { fileURLToPath } from "node:url";
import type { Invocation, Task } from "../src/types.ts";

export const task: Task = { title: "Review", task: "Analyze local source. Do not modify files.", output: "Only concrete findings." };
export const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
export function fixture(mode = "success", delay = 0): Invocation {
  return {
    command: process.execPath, args: [fileURLToPath(new URL("./fixtures/child.mjs", import.meta.url)), mode, String(delay)],
    cwd: process.cwd(), env: { PATH: process.env.PATH },
  };
}
export async function eventually(predicate: () => boolean, timeout = 3000): Promise<void> {
  const end = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > end) throw new Error("Condition did not become true.");
    await wait(10);
  }
}

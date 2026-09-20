import type { Usage } from "@earendil-works/pi-ai";

export type { Usage };
export interface Task { title: string; task: string; output: string }
export type TaskState = "queued" | "running" | "completed" | "failed" | "cancelled" | "timed_out";
export interface TaskResult {
  id: string;
  title: string;
  state: TaskState;
  startedAt?: number;
  endedAt?: number;
  activity?: string;
  answer?: string;
  diagnostic?: string;
  artifact?: string;
  truncated?: boolean;
  usage?: Usage;
}
export interface Details { tasks: TaskResult[] }
export interface Invocation {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  expectation?: Expectation;
}
export interface Expectation {
  version: string;
  provider: string;
  model: string;
  thinking: string;
  trusted: boolean;
  cwd: string;
  modelHash: string;
  providerHash: string;
  toolsHash: string;
  resourcesHash: string;
}
export interface RunOutcome {
  state: "completed" | "failed" | "cancelled" | "timed_out";
  answer?: string;
  diagnostic?: string;
  usage?: Usage;
}
export type Runner = (invocation: Invocation, task: Task, signal: AbortSignal,
  activity: (text: string) => void) => Promise<RunOutcome>;

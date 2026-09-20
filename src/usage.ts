import type { Usage } from "./types.ts";

export function addUsage(total: Usage | undefined, value: unknown): Usage | undefined {
  if (!value || typeof value !== "object") return total;
  const data = value as Partial<Usage>;
  if (typeof data.totalTokens !== "number") return total;
  const number = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0;
  const sum = (a: unknown, b: unknown) => number(a) + number(b);
  const result: Usage = {
    input: sum(total?.input, data.input), output: sum(total?.output, data.output),
    cacheRead: sum(total?.cacheRead, data.cacheRead), cacheWrite: sum(total?.cacheWrite, data.cacheWrite),
    totalTokens: sum(total?.totalTokens, data.totalTokens),
    cost: {
      input: sum(total?.cost.input, data.cost?.input), output: sum(total?.cost.output, data.cost?.output),
      cacheRead: sum(total?.cost.cacheRead, data.cost?.cacheRead), cacheWrite: sum(total?.cost.cacheWrite, data.cost?.cacheWrite),
      total: sum(total?.cost.total, data.cost?.total),
    },
  };
  if (data.reasoning !== undefined || total?.reasoning !== undefined) result.reasoning = sum(total?.reasoning, data.reasoning);
  if (data.cacheWrite1h !== undefined || total?.cacheWrite1h !== undefined) result.cacheWrite1h = sum(total?.cacheWrite1h, data.cacheWrite1h);
  return result;
}

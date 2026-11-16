import { test } from "node:test";
import assert from "node:assert/strict";
import { addUsage } from "../src/usage.ts";
import { toolResult } from "../src/results.ts";
import type { Usage } from "../src/types.ts";

const usage = (totalFromProvider?: boolean, total = 0.25): Usage => ({
  input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total,
    ...(totalFromProvider === undefined ? {} : { totalFromProvider }) },
});

test("usage preserves provider-reported totals only when every contribution is billed", () => {
  const billed = usage(true);
  assert.equal(addUsage(undefined, billed)?.cost.totalFromProvider, true);
  assert.equal(addUsage(billed, billed)?.cost.totalFromProvider, true);
  assert.equal(addUsage(billed, billed)?.cost.total, 0.5);
  assert.equal(addUsage(undefined, usage(true, 0))?.cost.totalFromProvider, true);
  assert.notEqual(addUsage(undefined, usage())?.cost.totalFromProvider, true);
  for (const estimated of [usage(false), usage()]) {
    assert.equal(addUsage(billed, estimated)?.cost.totalFromProvider, false);
    assert.equal(addUsage(estimated, billed)?.cost.totalFromProvider, false);
    assert.equal(addUsage(addUsage(billed, estimated), billed)?.cost.totalFromProvider, false);
  }
  for (const invalid of [undefined, null, {}, { cost: { totalFromProvider: true } }]) {
    assert.equal(addUsage(billed, invalid), billed);
  }
});

test("tool result aggregation retains billed provenance across tasks, including failures", () => {
  const tasks = ["completed", "failed"].map((state, i) => ({
    id: `s${i}`, title: "Review", state: state as "completed" | "failed", usage: usage(true),
  }));
  const billed = toolResult(tasks);
  assert.equal(billed.usage?.totalTokens, 6);
  assert.equal(billed.usage?.cost.total, 0.5);
  assert.equal(billed.usage?.cost.totalFromProvider, true);
  assert.ok(billed.details.tasks.every(task => task.usage?.cost.totalFromProvider === true));
  assert.equal(toolResult([...tasks, { id: "s2", title: "Estimated", state: "completed", usage: usage() }]).usage?.cost.totalFromProvider, false);
});

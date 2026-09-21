import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Args, BuildSystemPromptOptions, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildInvocation, digest, executable, expectation, mismatch, supportsPiVersion } from "../src/resources.ts";

const SUPPORTED_VERSION = "0.87.0";

function host() {
  const pi = {
    getAllTools: () => [{ name: "subagents", description: "delegate", parameters: {}, sourceInfo: { source: "local" } }],
    getActiveTools: () => ["subagents"], getThinkingLevel: () => "high",
  } as unknown as ExtensionAPI;
  const ctx = {
    cwd: "/work", model: { provider: "custom", id: "precise-model", baseUrl: "https://example.invalid" },
    thinkingLevel: "high", isProjectTrusted: () => true,
    modelRegistry: { getRegisteredProviderConfig: () => ({ apiKey: "$KEY" }), getRegisteredNativeProvider: () => undefined },
  } as unknown as ExtensionContext;
  const options = { skills: [{ name: "review", filePath: "/skills/review.md" }], contextFiles: [{ path: "/work/AGENTS.md", content: "Instructions" }] } as BuildSystemPromptOptions;
  return { pi, ctx, options };
}
function parsed(overrides: Partial<Args> = {}): Args {
  return { messages: ["PRIVATE PARENT PROMPT"], fileArgs: ["parent.txt"], unknownFlags: new Map(), diagnostics: [], ...overrides };
}

test("CLI reconstruction preserves effective model/thinking/trust, cwd, resources, exclusions and environment", () => {
  const { pi, ctx, options } = host();
  const expected = expectation(pi, ctx, options, SUPPORTED_VERSION);
  const invocation = buildInvocation({
    parsed: parsed({
      extensions: ["extra.ts", "npm:existing-package"], skills: ["./skill"], noSkills: true,
      noExtensions: true, noContextFiles: true, promptTemplates: ["prompts"], themes: ["theme"],
      tools: ["read", "subagents"], excludeTools: ["write"], noBuiltinTools: true,
      continue: true, session: "parent.jsonl", fork: "parent", mode: "rpc",
      unknownFlags: new Map([["extension-option", "selected"]]),
    }), expected, agentDir: "/config", startupCwd: "/launch", exec: { command: "/node", prefix: ["/pi/cli.js"] },
    env: { PROVIDER_KEY: "never-in-argv", PI_SESSION_FILE: "/private-parent", PI_SESSION_ID: "parent" },
  });
  assert.equal(invocation.cwd, "/work");
  assert.equal(invocation.env.PROVIDER_KEY, "never-in-argv");
  assert.equal(invocation.env.PI_SESSION_FILE, undefined);
  assert.equal(invocation.env.PI_CODING_AGENT_DIR, "/config");
  assert.equal(invocation.env.PI_OFFLINE, "1");
  assert.equal(invocation.env.PI_AGENTLET_VERIFY, "1");
  for (const item of ["--approve", "--provider", "custom", "precise-model", "high", "/launch/extra.ts", "npm:existing-package",
    "/launch/skill", "--no-skills", "--no-extensions", "--no-context-files", "read,subagents", "--exclude-tools", "write", "--extension-option", "selected"]) {
    assert.ok(invocation.args.includes(item), item);
  }
  assert.doesNotMatch(JSON.stringify(invocation.args), /PRIVATE|parent.jsonl|parent.txt|never-in-argv|--fork|--continue/);
  const untrusted = buildInvocation({ parsed: parsed(), expected: { ...expected, trusted: false }, agentDir: "/config", startupCwd: "/launch", exec: { command: "/pi", prefix: [] } });
  assert.ok(untrusted.args.includes("--no-approve"));
  assert.ok(!untrusted.args.includes("--no-extensions"));
  assert.ok(!untrusted.args.includes("--no-skills"));
});
test("verification detects non-reproducible configuration without any fallback", () => {
  const { pi, ctx, options } = host();
  const expected = expectation(pi, ctx, options, SUPPORTED_VERSION);
  assert.equal(mismatch(expected, pi, ctx, options), undefined);
  assert.match(mismatch({ ...expected, model: "other" }, pi, ctx, options)!, /model/);
  assert.match(mismatch({ ...expected, thinking: "off" }, pi, ctx, options)!, /thinking/);
  assert.match(mismatch({ ...expected, providerHash: "runtime-only-registration" }, pi, ctx, options)!, /provider registration/);
  assert.match(mismatch({ ...expected, trusted: false }, pi, ctx, options)!, /trust/);
  assert.match(mismatch({ ...expected, toolsHash: "changed" }, pi, ctx, options)!, /tools/);
  assert.match(mismatch({ ...expected, resourcesHash: "changed" }, pi, ctx, options)!, /skills/);
  assert.throws(() => expectation(pi, ctx, options, "0.1.0"), /supports pi >=0\.86\.0 <0\.88\.0/);
  assert.throws(() => expectation(pi, { ...ctx, model: undefined }, options, SUPPORTED_VERSION), /model/);
  assert.throws(() => expectation(pi, ctx, { ...options, forceSystemPrompt: "private parent state" }, SUPPORTED_VERSION), /in-memory/);
  assert.throws(() => buildInvocation({ parsed: parsed({ apiKey: "secret" }), expected, agentDir: "/config", startupCwd: "/launch", exec: { command: "/pi", prefix: [] } }), /--api-key/);
});
test("pi compatibility accepts stable releases in the supported range only", () => {
  for (const version of ["0.86.0", "0.86.2", "0.87.0", "0.87.999", "0.87.0+build.1"]) {
    assert.equal(supportsPiVersion(version), true, version);
  }
  for (const version of ["0.85.999", "0.88.0", "1.0.0", "0.87.0-beta.1", "0.087.0", "invalid"]) {
    assert.equal(supportsPiVersion(version), false, version);
  }
});
test("stable configuration hashes do not depend on object property order", () => {
  assert.equal(digest({ b: 2, a: 1 }), digest({ a: 1, b: 2 }));
});
test("executor reuses both reviewed CLI layouts and resolves launcher symlinks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-agentlet-executable-"));
  try {
    await mkdir(join(dir, "dist/bundle"), { recursive: true });
    await writeFile(join(dir, "package.json"), JSON.stringify({
      name: "@earendil-works/pi-coding-agent", bin: { pi: "dist/bundle/cli.js" },
    }));
    for (const entry of ["dist/cli.js", "dist/bundle/cli.js"]) {
      const script = join(dir, entry); await writeFile(script, "");
      const launcher = join(dir, entry.includes("bundle") ? "pi-bundled" : "pi-unbundled");
      await symlink(entry, launcher);
      for (const input of [script, launcher]) {
        assert.deepEqual(executable(process.execPath, input), { command: process.execPath, prefix: [script] });
      }
    }
    assert.deepEqual(executable("/installed/pi"), { command: "/installed/pi", prefix: [] });
    assert.throws(() => executable(process.execPath, import.meta.filename), /Unsupported/);
    assert.throws(() => executable("/some/wrapper"), /Unsupported/);
    assert.throws(() => executable(process.execPath), /Unsupported/);
    assert.throws(() => executable(process.execPath, join(dir, "missing.js")), /Unsupported/);
    assert.throws(() => executable(process.execPath, "/$bunfs/root/cli.js"), /Unsupported/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("executor rejects unrecognized layouts, packages and bundled bin declarations without fallback", async (t) => {
  const name = "@earendil-works/pi-coding-agent";
  const cases = [
    { title: "SDK entry inside pi", entry: "dist/index.js", pkg: { name } },
    { title: "wrapper named cli.js", entry: "scripts/cli.js", pkg: { name, bin: { pi: "scripts/cli.js" } } },
    { title: "unreviewed nested layout", entry: "dist/other/cli.js", pkg: { name, bin: { pi: "dist/other/cli.js" } } },
    { title: "unbundled wrong package", entry: "dist/cli.js", pkg: { name: "other" } },
    { title: "bundled wrong package", pkg: { name: "other", bin: { pi: "dist/bundle/cli.js" } } },
    { title: "missing manifest", pkg: undefined },
    { title: "malformed manifest", raw: "{" },
    { title: "null manifest", raw: "null" },
    { title: "missing bin", pkg: { name } },
    { title: "invalid bin", pkg: { name, bin: { pi: 42 } } },
    { title: "different bin", pkg: { name, bin: { pi: "dist/cli.js" } } },
  ];
  for (const item of cases) await t.test(item.title, async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-agentlet-executable-reject-"));
    try {
      const entry = item.entry ?? "dist/bundle/cli.js";
      const script = join(dir, entry);
      await mkdir(join(script, ".."), { recursive: true });
      await writeFile(script, "");
      const manifest = item.raw ?? JSON.stringify(item.pkg);
      if (manifest !== undefined) await writeFile(join(dir, "package.json"), manifest);
      assert.throws(() => executable(process.execPath, script), /Unsupported SDK\/wrapper host/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

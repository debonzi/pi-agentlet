import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

// Explicit opt-in: a real local pi CLI, isolated configuration, and an in-process fake provider.
const cli = process.env.PI_AGENTLET_CLI;
if (!cli) throw new Error("Set PI_AGENTLET_CLI to the installed pi dist/bundle/cli.js or dist/cli.js (Node installation).");
const root = await mkdtemp(join(tmpdir(), "pi-agentlet-smoke-"));
const repo = fileURLToPath(new URL("../", import.meta.url));
try {
  const cwd = join(root, "project"), config = join(root, "config"), skill = join(root, "skill");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await mkdir(config); await mkdir(skill);
  await writeFile(join(config, "settings.json"), JSON.stringify({ enableInstallTelemetry: false, cacheWarming: "off" }));
  await writeFile(join(cwd, "AGENTS.md"), "Do not modify project files.\n");
  await writeFile(join(cwd, ".pi/settings.json"), JSON.stringify({ defaultTools: ["read"] }));
  await writeFile(join(skill, "SKILL.md"), "---\nname: smoke-review\ndescription: Review local fixtures\n---\nOnly inspect supplied fixtures.\n");
  const child = spawn(process.execPath, [resolve(cli), "--offline", "--mode", "json", "--print", "--no-session", "--approve",
    "--no-extensions", "-e", join(repo, "tests/fixtures/offline-provider.ts"), "-e", repo,
    "--no-skills", "--skill", skill, "--exclude-tools", "write,edit,bash",
    "--provider", "agentlet-fixture", "--model", "fixture", "--thinking", "off"], {
    cwd, env: { PATH: process.env.PATH, HOME: root, PI_CODING_AGENT_DIR: config, PI_OFFLINE: "1", PI_TELEMETRY: "0" },
    stdio: ["pipe", "pipe", "pipe"], shell: false,
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  child.stdin.end("PARENT_PRIVATE_MARKER: run the offline delegation fixture.");
  const timer = setTimeout(() => child.kill("SIGTERM"), 30000);
  try {
    const code = await new Promise((resolve, reject) => { child.on("close", resolve); child.on("error", reject); });
    assert.equal(code, 0, stderr);
    const events = stdout.trim().split("\n").map(line => JSON.parse(line));
    const finals = events.filter(event => event.type === "message_end" && event.message.role === "assistant");
    assert.equal(finals.at(-1)?.message.content[0]?.text, "SMOKE_OK", JSON.stringify(finals.at(-1)) + "\n" + stderr);
    assert.ok(!stdout.includes("CHILD_PRIVATE_THINKING"));
    console.log("Real pi offline smoke passed: three children, private contexts, resource verification, and valid JSON output.");
  } finally { clearTimeout(timer); }
} finally { await rm(root, { recursive: true, force: true }); }

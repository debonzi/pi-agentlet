import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

// Explicit opt-in: a real local pi CLI, isolated configuration, and deterministic offline fixtures.
const cli = process.env.PI_AGENTLET_CLI;
if (!cli) throw new Error("Set PI_AGENTLET_CLI to the installed pi dist/bundle/cli.js or dist/cli.js (Node installation).");
const root = await mkdtemp(join(tmpdir(), "pi-agentlet-smoke-"));
const repo = fileURLToPath(new URL("../", import.meta.url));
const fixture = name => join(repo, "tests/fixtures", name);
try {
  const cwd = join(root, "project"), config = join(root, "config"), skill = join(root, "skill");
  const pids = join(root, "mcp-pids"), piPids = join(root, "pi-pids");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await mkdir(config); await mkdir(skill); await mkdir(pids); await mkdir(piPids);
  await writeFile(join(config, "settings.json"), JSON.stringify({ enableInstallTelemetry: false, cacheWarming: "off" }));
  await writeFile(join(cwd, "AGENTS.md"), "Do not modify project files.\n");
  await writeFile(join(skill, "SKILL.md"), "---\nname: smoke-review\ndescription: Review local fixtures\n---\nOnly inspect supplied fixtures.\n");
  const hostRoot = dirname(cli).endsWith("/bundle") ? resolve(dirname(cli), "../..") : resolve(dirname(cli), "..");
  const { version } = JSON.parse(await readFile(join(hostRoot, "package.json"), "utf8"));
  const modern = /^0\.99\./.test(version);
  const run = async (profile, { tools = false, mcp = false } = {}) => {
    await writeFile(join(cwd, ".pi/settings.json"), JSON.stringify({ defaultTools: ["read", ...(tools ? ["codemode"] : [])] }));
    await writeFile(join(config, "mcp.json"), JSON.stringify({ mcpServers: mcp ? {
      offline: { command: process.execPath, args: [fixture("offline-mcp.mjs")], exposure: "codemode" },
    } : {} }));
    const args = [resolve(cli), "--offline", "--mode", "json", "--print", "--no-session", "--approve",
      "--no-extensions", "-e", fixture("offline-provider.ts"), "-e", repo,
      "--no-skills", "--skill", skill, "--exclude-tools", "write,edit,bash",
      "--provider", "agentlet-fixture", "--model", profile === "virtual" ? "virtual-fixture" : "fixture", "--thinking", "off", "--agentlet-smoke-profile", profile];
    if (tools) args.push("-e", "builtin:codemode", "-e", "builtin:tool-search", "-e", fixture("offline-tools.ts"));
    if (mcp) args.push("-e", "builtin:mcp");
    if (profile === "virtual") args.push("-e", fixture("offline-virtual.ts"));
    const child = spawn(process.execPath, args, {
      cwd, env: { PATH: process.env.PATH, HOME: root, PI_CODING_AGENT_DIR: config, PI_OFFLINE: "1", PI_TELEMETRY: "0",
        PI_AGENTLET_SMOKE_MCP_PIDS: pids, PI_AGENTLET_SMOKE_PI_PIDS: piPids }, stdio: ["pipe", "pipe", "pipe"], shell: false,
    });
    let stdout = "", stderr = "", cancelled = false;
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.stdin.end("PARENT_PRIVATE_MARKER: run the offline delegation fixture.");
    let force;
    const stop = () => {
      child.kill("SIGTERM");
      force ??= setTimeout(() => child.kill("SIGKILL"), 5000);
    };
    const timer = setTimeout(stop, 60000);
    const poll = profile === "cancel" ? setInterval(() => {
      // Parent plus five active child MCP servers; the sixth delegated task is still queued.
      if (!cancelled && readdirSync(pids).length >= 6 && stdout.includes('"state":"queued"')) { cancelled = true; stop(); }
    }, 100) : undefined;
    try {
      const code = await new Promise((resolve, reject) => { child.on("close", resolve); child.on("error", reject); });
      assert.equal(code, profile === "cancel" ? 143 : 0, stderr);
      const events = stdout.trim().split("\n").map(line => JSON.parse(line));
      assert.ok(!stdout.includes("CHILD_PRIVATE_THINKING"));
      if (profile === "cancel") assert.ok(cancelled, "Cancellation must occur with live children and a queued task.");
      else {
        const finals = events.filter(event => event.type === "message_end" && event.message.role === "assistant");
        assert.equal(finals.at(-1)?.message.content[0]?.text, "SMOKE_OK", JSON.stringify(finals.at(-1)) + "\n" + stderr);
        if (profile === "codemode") {
          const result = events.find(event => event.type === "message_end" && event.message.role === "toolResult" && event.message.toolName === "subagents");
          assert.equal(result.message.usage.totalTokens, 30); // Three children: two responses (4) plus nested tools (6).
        }
      }
      const servers = await readdir(pids), sessions = await readdir(piPids);
      if (mcp) assert.equal(servers.length, profile === "cancel" ? 6 : 4);
      assert.equal(sessions.length, profile === "virtual" ? 1 : profile === "cancel" ? 6 : 4);
      for (const pid of [...servers, ...sessions]) {
        await assert.rejects(readFile(`/proc/${pid}/cmdline`), { code: "ENOENT" }, `Fixture process ${pid} survived teardown.`);
      }
      console.log(`Real pi ${version} offline smoke passed: ${profile}.`);
    } finally {
      clearTimeout(timer); clearTimeout(force); clearInterval(poll);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await new Promise(resolve => child.once("close", resolve));
      }
      // On assertion failures, clean up only the identifiable fixture processes from this run.
      for (const [directory, script] of [[pids, "offline-mcp.mjs"], [piPids, "offline-provider.ts"]]) {
        for (const pid of await readdir(directory)) {
          try {
            const command = await readFile(`/proc/${pid}/cmdline`, "utf8");
            if (command.split("\0").includes(fixture(script))) process.kill(Number(pid), "SIGKILL");
          } catch { /* Already reaped. */ }
          await rm(join(directory, pid));
        }
      }
    }
  };
  await run("basic");
  await run("timeout");
  if (modern) {
    await run("codemode", { tools: true });
    await run("mismatch", { tools: true });
    await run("virtual");
    await run("mcp", { tools: true, mcp: true });
    await run("cancel", { tools: true, mcp: true });
  }
} finally { await rm(root, { recursive: true, force: true }); }

#!/usr/bin/env python3
"""Opt-in Linux PTY check using only the local deterministic smoke fixtures."""
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import shutil
import signal
import struct
import subprocess
import tempfile
import termios
import time

cli = Path(os.environ["PI_AGENTLET_CLI"]).resolve()
repo = Path(__file__).resolve().parent.parent
node = shutil.which("node")
assert node, "An existing Node.js toolchain is required."
# Use the allowed version range; admission does not imply prior host validation.
subprocess.run([node, "--input-type=module", "-e", """
import { readFileSync } from 'node:fs';
import { executable, supportsPiVersion } from './src/resources.ts';
const cli = process.env.PI_AGENTLET_CLI;
const root = cli.endsWith('/dist/bundle/cli.js') ? cli.slice(0, -19) : cli.slice(0, -12);
if (!supportsPiVersion(JSON.parse(readFileSync(root + '/package.json')).version)) throw Error('Unsupported host');
executable(process.execPath, cli);
"""], cwd=repo, env={**os.environ, "PI_AGENTLET_CLI": str(cli)}, check=True)
ansi = re.compile(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))")


def run(mode, profile):
    with tempfile.TemporaryDirectory(prefix="pi-agentlet-pty-") as directory:
        root = Path(directory)
        cwd, config = root / "project", root / "config"
        pids, mcp_pids = root / "pi-pids", root / "mcp-pids"
        for path in (cwd / ".pi", config, pids, mcp_pids):
            path.mkdir(parents=True)
        (cwd / "AGENTS.md").write_text("Do not modify project files.\n")
        (config / "settings.json").write_text(json.dumps({
            "enableInstallTelemetry": False, "cacheWarming": "off", "theme": "dark",
        }))
        (cwd / ".pi/settings.json").write_text(json.dumps({"defaultTools": ["read", "codemode"]}))
        fixture = repo / "tests/fixtures"
        (config / "mcp.json").write_text(json.dumps({"mcpServers": {
            "offline": {"command": node, "args": [str(fixture / "offline-mcp.mjs"), "--delay-ms", "300"], "exposure": "codemode"},
        } if profile == "cancel" else {}}))
        # Record only lifecycle metadata, never prompts, answers, or tool payloads.
        marker = root / "lifecycle.ts"
        events = root / "lifecycle.jsonl"
        marker.write_text("""
import { appendFileSync } from 'node:fs';
export default function(pi) {
  for (const type of ['session_start', 'session_shutdown', 'agent_settled']) pi.on(type, event => {
    appendFileSync(process.env.PI_AGENTLET_PTY_EVENTS, JSON.stringify({pid: process.pid, type, reason: event.reason, aborted: event.aborted}) + '\\n', {mode: 0o600});
  });
}
""")
        args = [node, str(cli), "--offline", "--no-session", "--approve", "--tui-mode", mode,
                "--no-extensions", "-e", str(fixture / "offline-provider.ts"), "-e", str(repo), "-e", str(marker),
                "--no-skills", "--exclude-tools", "write,edit,bash", "--provider", "agentlet-fixture",
                "--model", "fixture", "--thinking", "off", "--agentlet-smoke-profile", profile]
        if profile == "cancel":
            args += ["-e", "builtin:codemode", "-e", "builtin:mcp"]
        env = {"PATH": os.environ["PATH"], "HOME": str(root), "TERM": "xterm-256color",
               "PI_CODING_AGENT_DIR": str(config), "PI_OFFLINE": "1", "PI_TELEMETRY": "0",
               "PI_PROGRAM_STATUS": "0", "PI_IMAGE_PROTOCOL": "none",
               "PI_AGENTLET_SMOKE_PI_PIDS": str(pids), "PI_AGENTLET_SMOKE_MCP_PIDS": str(mcp_pids),
               "PI_AGENTLET_PTY_EVENTS": str(events)}
        master, slave = pty.openpty()
        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 32, 100, 0, 0))
        proc = subprocess.Popen(args, cwd=cwd, env=env, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        os.close(slave)
        output = bytearray()

        def pump():
            if select.select([master], [], [], 0.05)[0]:
                try:
                    output.extend(os.read(master, 65536))
                    del output[:-1048576]
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise

        def wait_for(predicate, label, timeout=20):
            end = time.monotonic() + timeout
            while time.monotonic() < end:
                pump()
                if predicate():
                    return
                assert proc.poll() is None, f"Pi exited before {label}: {proc.returncode}"
            states = {pid: Path(f"/proc/{pid}/stat").read_text().rsplit(") ", 1)[1].split()[0]
                      for pid in live_children()}
            raise AssertionError(f"Timed out waiting for {label} ({mode}, {profile}); fixture states: {states}.")

        def plain():
            return ansi.sub("", output.decode("utf-8", errors="replace"))

        def records():
            return [json.loads(line) for line in events.read_text().splitlines()] if events.exists() else []

        def lifecycle(kind, reason, count):
            return sum(row["pid"] == proc.pid and row["type"] == kind and row["reason"] == reason for row in records()) >= count

        def live_children():
            return [path.name for folder in (pids, mcp_pids) for path in folder.iterdir()
                    if int(path.name) != proc.pid and Path(f"/proc/{path.name}/cmdline").exists()]

        try:
            wait_for(lambda: lifecycle("session_start", "startup", 1), "startup")
            time.sleep(0.3)
            os.write(master, b"PARENT_PRIVATE_MARKER: run the offline fixture.\r")
            parent_servers = set()
            if profile == "basic":
                wait_for(lambda: "SMOKE_OK" in plain(), "final answer")
                assert len(list(pids.iterdir())) == 4
            else:
                wait_for(lambda: len(list(pids.iterdir())) == 6 and len(list(mcp_pids.iterdir())) == 6
                         and "queued" in plain(), "five active children plus one queued task")
                parent_servers = {path.name for path in mcp_pids.iterdir()
                                  if Path(f"/proc/{path.name}/stat").read_text().rsplit(") ", 1)[1].split()[1] == str(proc.pid)}
                assert len(parent_servers) == 1, "The live parent must own exactly one local MCP fixture."
                os.write(master, b"\x0f")  # Ctrl+O: expand normal tool output.
                wait_for(lambda: "Expected output:" in plain(), "expanded task instructions")
                output.clear()
                fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 10, 48, 0, 0))
                os.kill(proc.pid, signal.SIGWINCH)
                wait_for(lambda: "5 running" in plain() and "1 queued" in plain(), "narrow aggregate tail")
                os.write(master, b"\x1b")
            # The parent's own MCP connection correctly stays alive until reload/quit.
            wait_for(lambda: set(live_children()) == parent_servers, "delegated child cleanup")
            wait_for(lambda: any(row["pid"] == proc.pid and row["type"] == "agent_settled"
                                 and row["aborted"] == (profile == "cancel") for row in records()), "parent settlement")
            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 32, 100, 0, 0))
            os.kill(proc.pid, signal.SIGWINCH)
            os.write(master, b"\x15/reload\r")  # Clear any input restored by Escape first.
            wait_for(lambda: lifecycle("session_shutdown", "reload", 1), "reload teardown")
            wait_for(lambda: lifecycle("session_start", "reload", 1), "reload startup")
            os.write(master, b"/new\r")
            wait_for(lambda: lifecycle("session_shutdown", "new", 1), "new-session teardown")
            wait_for(lambda: lifecycle("session_start", "new", 1), "new-session startup")
            os.write(master, b"\x04")  # Ctrl+D with an empty editor: orderly quit.
            end = time.monotonic() + 20
            while proc.poll() is None and time.monotonic() < end:
                pump()
            assert proc.poll() == 0, "Orderly PTY shutdown failed."
            assert lifecycle("session_shutdown", "quit", 1)
            assert not live_children(), "Fixture descendants survived PTY shutdown."
            print(f"Offline PTY passed: {mode}, {profile}, {cli}.")
        finally:
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(proc.pid, signal.SIGKILL)
                    proc.wait()
            for folder in (pids, mcp_pids):
                for path in folder.iterdir():
                    try:
                        command = Path(f"/proc/{path.name}/cmdline").read_bytes().split(b"\0")
                        if any(str(fixture / name).encode() in command for name in ("offline-provider.ts", "offline-mcp.mjs")):
                            os.kill(int(path.name), signal.SIGKILL)
                    except (FileNotFoundError, ProcessLookupError):
                        pass
            os.close(master)


for tui_mode in ("regular", "fullscreen"):
    for smoke_profile in ("basic", "cancel"):
        run(tui_mode, smoke_profile)

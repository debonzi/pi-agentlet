import { writeFileSync } from "node:fs";
import { join } from "node:path";

// Tiny deterministic stdio MCP server. No network, credentials, downloads, or SDK dependency.
if (process.env.PI_AGENTLET_SMOKE_MCP_PIDS) {
  writeFileSync(join(process.env.PI_AGENTLET_SMOKE_MCP_PIDS, String(process.pid)), "", { mode: 0o600 });
}
let pending = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  pending += chunk;
  let end;
  while ((end = pending.indexOf("\n")) >= 0) {
    const line = pending.slice(0, end); pending = pending.slice(end + 1);
    if (!line.trim()) continue;
    const request = JSON.parse(line);
    if (request.id === undefined) continue;
    let result;
    switch (request.method) {
      case "initialize":
        result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} },
          serverInfo: { name: "offline-agentlet-fixture", version: "1" } };
        break;
      case "tools/list":
        result = { tools: [{ name: "echo", description: "Return the offline fixture marker.",
          inputSchema: { type: "object", properties: {} },
          annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }] };
        break;
      case "tools/call": result = { content: [{ type: "text", text: "MCP_FIXTURE_OK" }] }; break;
      case "ping": result = {}; break;
      default:
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Unknown fixture method" } }) + "\n");
        continue;
    }
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
  }
});
process.stdin.on("end", () => process.exit(0));

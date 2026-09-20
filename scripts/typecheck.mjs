import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Optional paths reuse an existing local toolchain; never install dependencies.
const require = createRequire(import.meta.url);
try {
  const compiler = process.env.PI_AGENTLET_TYPESCRIPT ?? require.resolve("typescript");
  const ts = (await import(pathToFileURL(resolve(compiler)).href)).default;
  const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
  if (process.env.PI_AGENTLET_HOST) {
    const host = resolve(process.env.PI_AGENTLET_HOST);
    parsed.options.paths = Object.fromEntries([
      "@earendil-works/pi-coding-agent", "@earendil-works/pi-ai", "@earendil-works/pi-tui", "typebox",
    ].map(name => {
      const root = name === "@earendil-works/pi-coding-agent" ? host : resolve(host, "node_modules", name);
      const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
      return [name, [resolve(root, pkg.types)]];
    }));
    parsed.options.typeRoots = [resolve("node_modules/@types"), resolve(host, "node_modules/@types"), resolve(dirname(host), "../@types")];
  }
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length) {
    console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: f => f, getCurrentDirectory: ts.sys.getCurrentDirectory, getNewLine: () => "\n",
    }));
    process.exitCode = 1;
  } else console.log("TypeScript checks passed.");
} catch (error) {
  console.error("Type checking requires existing TypeScript and pi peer dependencies. Use local dependencies, or set PI_AGENTLET_TYPESCRIPT to typescript/lib/typescript.js and PI_AGENTLET_HOST to the pi package directory.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

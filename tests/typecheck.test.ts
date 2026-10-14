import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

test("external host typecheck resolves nested and hoisted peers without package.json exports", async t => {
  for (const layout of ["nested", "hoisted"]) await t.test(layout, async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-agentlet-typecheck-"));
    try {
      const host = join(root, "node_modules/@earendil-works/pi-coding-agent");
      const dependencies = layout === "nested" ? join(host, "node_modules") : join(root, "node_modules");
      const paths: Record<string, string[]> = {};
      for (const name of ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai", "@earendil-works/pi-tui", "typebox", "@types/node"]) {
        const dir = name === "@earendil-works/pi-coding-agent" ? host : join(dependencies, name);
        await mkdir(join(dir, "dist"), { recursive: true });
        await writeFile(join(dir, "package.json"), JSON.stringify({ name, types: "dist/index.d.ts", exports: { ".": "./dist/index.js" } }));
        paths[name] = [join(dir, "dist/index.d.ts")];
      }
      delete paths["@types/node"];
      const compiler = join(root, "compiler.mjs");
      // Probe the validation script's compiler options without real host/compiler dependencies.
      await writeFile(compiler, `import assert from "node:assert/strict";
export default {
  sys: {}, readConfigFile: () => ({ config: {} }),
  parseJsonConfigFileContent: () => ({ options: {}, fileNames: [], errors: [] }),
  createProgram: (_files, options) => options,
  getPreEmitDiagnostics(options) {
    assert.deepEqual(options.paths, ${JSON.stringify(paths)});
    assert.ok(options.typeRoots.includes(${JSON.stringify(join(dependencies, "@types"))}));
    return [];
  },
};\n`);
      const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/typecheck.mjs", import.meta.url))], {
        cwd: dirname(fileURLToPath(new URL("../package.json", import.meta.url))), encoding: "utf8",
        env: { ...process.env, PI_AGENTLET_TYPESCRIPT: compiler, PI_AGENTLET_HOST: host },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /TypeScript checks passed/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

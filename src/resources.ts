import { createHash } from "node:crypto";
import { existsSync, realpathSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Args, BuildSystemPromptOptions, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Expectation, Invocation } from "./types.ts";

export const GUARD_PATH = fileURLToPath(new URL("./verify-child.ts", import.meta.url));
export const SUPPORTED_PI_RANGE = ">=0.86.0 <0.88.0";
const MIN_SUPPORTED_PI_VERSION = [0, 86, 0] as const;
const MAX_SUPPORTED_PI_VERSION = [0, 88, 0] as const;

type VersionTuple = readonly [number, number, number];

function compareVersions(left: VersionTuple, right: VersionTuple): number {
  for (let index = 0; index < left.length; index++) {
    if (left[index]! < right[index]!) return -1;
    if (left[index]! > right[index]!) return 1;
  }
  return 0;
}

export function supportsPiVersion(version: string): boolean {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(version);
  if (!match) return false;
  const parsed: VersionTuple = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (!parsed.every(Number.isSafeInteger)) return false;
  return compareVersions(parsed, MIN_SUPPORTED_PI_VERSION) >= 0
    && compareVersions(parsed, MAX_SUPPORTED_PI_VERSION) < 0;
}

export function digest(value: unknown): string {
  const canonical = (v: unknown): unknown => typeof v === "function" ? v.toString() : Array.isArray(v) ? v.map(canonical)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v;
  return createHash("sha256").update(JSON.stringify(canonical(value)) ?? "null").digest("hex");
}

export function providerHash(ctx: ExtensionContext): string {
  const id = ctx.model!.provider;
  // Public compatibility facade exposes registrations, not closed-over runtime state.
  // Hash locally: literal API keys in legacy registration config never enter logs/argv.
  return digest({
    config: ctx.modelRegistry.getRegisteredProviderConfig(id),
    nativeRegistration: Boolean(ctx.modelRegistry.getRegisteredNativeProvider(id)),
  });
}

export function resourceHash(options: BuildSystemPromptOptions): string {
  return digest({
    customPrompt: options.customPrompt,
    appendSystemPrompt: options.appendSystemPrompt,
    skills: options.skills,
    contextFiles: options.contextFiles,
  });
}
export function toolHash(pi: Pick<ExtensionAPI, "getAllTools" | "getActiveTools">): string {
  const active = new Set(pi.getActiveTools());
  return digest(pi.getAllTools().filter(t => active.has(t.name)).map(t => ({
    name: t.name, description: t.description, parameters: t.parameters, promptGuidelines: t.promptGuidelines,
  })).sort((a, b) => a.name.localeCompare(b.name)));
}

export function expectation(pi: ExtensionAPI, ctx: ExtensionContext, options: BuildSystemPromptOptions, version: string): Expectation {
  if (!supportsPiVersion(version)) throw new Error(`subagents supports pi ${SUPPORTED_PI_RANGE}; installed version is ${version}. Review resource/lifecycle APIs before expanding compatibility.`);
  if (!ctx.model) throw new Error("subagents requires an explicitly resolved parent model.");
  if (options.forceSystemPrompt) throw new Error("subagents cannot reconstruct an in-memory forced system prompt. Put reusable instructions in normal resources.");
  if (!pi.getActiveTools().includes("subagents")) throw new Error("subagents must remain available in the child tool selection.");
  if (pi.getAllTools().some(t => pi.getActiveTools().includes(t.name) && t.sourceInfo.source === "sdk")) {
    throw new Error("subagents cannot reconstruct inline SDK tools. Load them through a file-backed extension.");
  }
  return {
    version, provider: ctx.model.provider, model: ctx.model.id,
    thinking: ctx.thinkingLevel ?? pi.getThinkingLevel(), trusted: ctx.isProjectTrusted(), cwd: ctx.cwd,
    modelHash: digest(ctx.model), providerHash: providerHash(ctx), toolsHash: toolHash(pi), resourcesHash: resourceHash(options),
  };
}

/** Only recognized pi CLI entry points are replayable. No PATH fallback or SDK-script relaunch. */
export function executable(execPath: string, script?: string): { command: string; prefix: string[] } {
  if (!/^(node|bun)(\.exe)?$/i.test(basename(execPath))) {
    if (/^pi(?:\.exe)?$/i.test(basename(execPath))) return { command: execPath, prefix: [] };
    throw new Error("Unsupported binary host: cannot establish the parent pi executable.");
  }
  if (script && !script.startsWith("/$bunfs/")) {
    try {
      const path = realpathSync(script);
      // Check only the two reviewed layouts, never arbitrary ancestor packages.
      for (const root of [resolve(dirname(path), ".."), resolve(dirname(path), "../..")]) {
        const unbundled = path === join(root, "dist/cli.js");
        const bundled = path === join(root, "dist/bundle/cli.js");
        if (!unbundled && !bundled) continue;
        const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
        if (pkg?.name !== "@earendil-works/pi-coding-agent") continue;
        // The shipped unbundled CLI is still supported; the bundle must be the declared pi bin.
        if (unbundled || (typeof pkg.bin?.pi === "string" && resolve(root, pkg.bin.pi) === path)) {
          return { command: execPath, prefix: [path] };
        }
      }
    } catch { /* Missing, unreadable or unrecognized CLI installation. */ }
  }
  throw new Error("Unsupported SDK/wrapper host: launch with the installed pi CLI so resource configuration can be reconstructed.");
}

export function buildInvocation(input: {
  parsed: Args; expected: Expectation; agentDir: string; startupCwd: string;
  exec: { command: string; prefix: string[] }; env?: NodeJS.ProcessEnv;
}): Invocation {
  const { parsed: p, expected: e } = input;
  if (p.apiKey) throw new Error("subagents cannot safely replay --api-key; use the pi credential store or provider environment variables.");
  if (p.diagnostics.some(d => d.type === "error")) throw new Error("Parent CLI configuration contains errors; subagents cannot reproduce it.");
  const args = [...input.exec.prefix, "--mode", "json", "--print", "--no-session", "--offline",
    e.trusted ? "--approve" : "--no-approve", "--provider", e.provider, "--model", e.model, "--thinking", e.thinking];
  const pathArg = (s: string) => /^(?:npm:|git:|https?:|ssh:|git@)/.test(s) ? s
    : s.startsWith("~") || isAbsolute(s) ? s : resolve(input.startupCwd, s);
  for (const [flag, paths] of [
    ["--extension", p.extensions], ["--skill", p.skills], ["--prompt-template", p.promptTemplates], ["--theme", p.themes],
  ] as const) for (const path of paths ?? []) {
    if (resolve(input.startupCwd, path) !== GUARD_PATH) args.push(flag, pathArg(path));
  }
  // These flags reproduce the parent's explicit selection, never simplify the child's resources.
  for (const [flag, enabled] of [
    ["--no-extensions", p.noExtensions], ["--no-skills", p.noSkills], ["--no-prompt-templates", p.noPromptTemplates],
    ["--no-themes", p.noThemes], ["--no-context-files", p.noContextFiles], ["--no-tools", p.noTools],
    ["--no-builtin-tools", p.noBuiltinTools],
  ] as const) if (enabled) args.push(flag);
  if (p.tools) args.push("--tools", p.tools.join(","));
  if (p.excludeTools) args.push("--exclude-tools", p.excludeTools.join(","));
  if (p.models) args.push("--models", p.models.join(","));
  // Preserve CLI prompt inputs, not the effective parent prompt or conversation.
  const promptInput = (text: string) => existsSync(resolve(input.startupCwd, text)) ? resolve(input.startupCwd, text) : text;
  if (p.systemPrompt !== undefined) args.push("--system-prompt", promptInput(p.systemPrompt));
  for (const text of p.appendSystemPrompt ?? []) args.push("--append-system-prompt", promptInput(text));
  for (const [name, value] of p.unknownFlags) {
    args.push(`--${name}`);
    if (typeof value === "string") args.push(value);
    else if (!value) throw new Error("Cannot reconstruct a false-valued extension CLI flag.");
  }
  args.push("--extension", GUARD_PATH);
  const env = { ...input.env, PI_CODING_AGENT_DIR: input.agentDir, PI_OFFLINE: "1", PI_AGENTLET_VERIFY: "1" };
  for (const key of ["PI_SESSION_ID", "PI_SESSION_FILE", "PI_PROVIDER", "PI_MODEL", "PI_REASONING_LEVEL"]) delete (env as NodeJS.ProcessEnv)[key];
  return { command: input.exec.command, args, cwd: e.cwd, env, expectation: e };
}

export function mismatch(e: Expectation, pi: ExtensionAPI, ctx: ExtensionContext, options: BuildSystemPromptOptions): string | undefined {
  if (ctx.cwd !== e.cwd || ctx.isProjectTrusted() !== e.trusted) return "cwd or project trust";
  if (ctx.model?.provider !== e.provider || ctx.model?.id !== e.model || digest(ctx.model) !== e.modelHash) return "model/provider configuration";
  if (providerHash(ctx) !== e.providerHash) return "provider registration configuration";
  if ((ctx.thinkingLevel ?? pi.getThinkingLevel()) !== e.thinking) return "thinking level";
  if (toolHash(pi) !== e.toolsHash) return "active tools (including extension tools)";
  if (resourceHash(options) !== e.resourcesHash) return "skills, context files, or prompt configuration";
  return undefined;
}

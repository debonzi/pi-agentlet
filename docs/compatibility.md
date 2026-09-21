# Integration evidence and compatibility boundaries

This document records host-specific evidence and limitations for the [functional specification](functional-spec.md) and [architecture decisions](architecture.md). See the [README](../README.md) for usage and the [development guide](development.md) for verification commands.

Reviewed installation: `@earendil-works/pi-coding-agent` **0.86.1**; Node **24.16.0** on Linux. Local installation paths are not embedded in production code.

## Public APIs used

- `ExtensionAPI.registerTool`, `promptSnippet`, and named `promptGuidelines`; failures of the tool itself are thrown, not returned as an ineffective `isError` property. Optional per-task `timeoutSeconds` uses a bounded TypeBox integer; the runner owns the timer, with no additional host timeout API needed. Pi normalizes/coerces arguments before execution (including nullable optional fields for strict providers); extension validation checks the resulting values, not the original model payload.
- `before_agent_start.systemPromptOptions` exposes structured skills, context files, and custom/appended prompt inputs. The adapter retains this configuration reference for comparison, not the parent prompt/history.
- `ctx.model`, `ctx.thinkingLevel`, `ctx.isProjectTrusted()`, `pi.getAllTools()`, `pi.getActiveTools()`, `getAgentDir()`, `parseArgs()`, and `VERSION` expose effective configuration and CLI parsing.
- `onUpdate`, `renderCall`, `renderResult`, theme colors, and TUI width helpers implement the tool-local UI. `ToolRenderContext.toolCallId` associates a row with its live execution; `invalidate()` rebuilds the row and requests rendering for UI-only animation. `usage` on the final tool result is supported.
- The reviewed `pi-tui` Loader uses ten Braille frames (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) at 80 ms. Tool renderers do not receive its required TUI instance, so the extension matches these defaults using a call-owned clock and public row invalidation rather than importing host internals. Custom global working-indicator overrides are not mirrored. The host does not dispose tool slot components on replacement; execution/lifecycle hooks own animation cleanup.
- `session_shutdown` covers quit, reload, new/resume, and fork/clone teardown in this version. `session_start` recreates instance state.

The pi README and `docs/extensions.md`, `tui.md`, `json.md`, `packages.md`, `session-format.md`, `sdk.md`, `settings.md`, `environment-variables.md`, and `custom-provider.md`, plus the subagent/tool-rendering examples, were consulted before implementation. The installed `.d.ts` declarations and CLI/print/resource-loader implementations were inspected to confirm behavior.

## Important findings

1. JSON streaming events are delta-only; finalized `message_end` is authoritative. `agent_end` and `turn_end` repeat messages and must not add usage again. JSON mode may exit successfully even if the assistant's final stop reason is an error, so process exit status alone is insufficient.
2. CLI print mode accepts task data on stdin. `--no-session` creates an ephemeral conversation; continuation/fork flags and parent prompts must not be copied.
3. CLI `--approve` and `--no-approve` override trust for one run without writing approvals. `isProjectTrusted()` includes temporary trust, unlike reading `trust.json` alone.
4. Pi's package resolver skips missing sources and temporary git refreshes in offline mode. Children use `--offline` to avoid automatic resource installation/updates. A missing required tool/skill/provider then fails startup or equivalence checks instead of being installed.
5. Pi's shell tools can start detached children, so killing only the pi PID or its process group is insufficient. Linux `/proc` tracking complements group termination and pi's own shutdown cleanup.
6. The extension API does **not** expose the complete live `ResourceLoader`, extension manifest, effective SettingsManager, arbitrary SDK factory options, or provider implementation closures. `getSystemPromptOptions()` is command-only, not available inside tool execute; `before_agent_start` is the public source used here.

## Supported reconstruction

Normal CLI launches with file-backed global/project resources and explicit CLI selections are reconstructed. The child reloads the same settings/filter configuration, startup flags, cwd, and normal context resources. It uses independent extension instances and verifies observable effective configuration before agent work. The verifier runs on `agent_start` so custom providers that do not invoke HTTP payload hooks still work. It does not remove or special-case the subagents tool.

The CLI script is accepted only when its real path is `dist/cli.js` or `dist/bundle/cli.js` under a package named `@earendil-works/pi-coding-agent`. The bundled layout must also match that package's `bin.pi` declaration; it is the npm entry point in the reviewed 0.86.1 installation. Launcher symlinks resolve to the same installed script, not a different CLI. Only these two layouts are checked, with no unrestricted ancestor search. The shipped unbundled CLI remains supported even when `bin.pi` selects the bundle. A native executable named `pi` is recognized without falling back to PATH, but is not integration-tested. Tests may inject a fixture executable directly into the runner; that is not a public per-task capability.

## Explicit limitations

- Inline SDK hosts/tools, unrecognized launchers, `--api-key` startup overrides, and forced in-memory system prompts are rejected. Their state is not silently guessed.
- Resource equivalence checks cover resolved model data, legacy provider registration configuration (including stream function source, never raw credentials in diagnostics), native-provider registration presence, active tool schemas/descriptions/guidelines, thinking, trust, cwd, loaded skills, context-file contents, and custom/appended prompt inputs. They do not prove equality of arbitrary extension closures, provider transports/authentication overrides, or hidden mutable state. Such state must be reconstructible through the original extensions/configuration; serializing it is outside the product contract.
- Standard settings and file-backed resources are re-read, not frozen. Do not edit resource configuration during execution. Per-turn custom prompt sections or conversation-only restrictions that are not recreated by normal resources must be supplied in the delegated task.
- Extension startup failures reported by pi fail child startup. Interactive extension behavior is not emulated, and prompts are never automatically approved. An extension that incorrectly assumes a TUI remains the responsibility of that extension.
- Native binaries and Windows/macOS process cleanup are not tested; runtime execution is restricted to Linux. Deliberate process daemonization that escapes descendant observation is not containment-safe.
- Usage is aggregated from finalized assistant/tool-result messages and non-message `entry_appended` usage, compaction, and branch-summary entries. Repeated turn/agent snapshots and compaction-end results do not add usage again. Provider/extension work not reported by these events cannot be inferred. No additional summarization model is used.

These boundaries do not justify disabling extensions, downgrading models, copying parent conversations, or enlarging user authorization. Revisit the resource adapter when pi adds a public execution-configuration snapshot API.

## Validation

`npm test` exercises fixture subprocesses and host mocks. `scripts/smoke.mjs` additionally launches the installed pi CLI with isolated local configuration and an in-process fake provider: a parent calls `subagents` with three tasks, children retain the tool, private conversation markers do not cross contexts, resource verification succeeds, and the parent's stdout remains valid JSONL. The smoke passes with both the bundled npm entry point and the shipped unbundled CLI. Unit tests cover both layouts, launcher symlinks, invalid manifests/bin declarations, and rejection of SDK scripts or unreviewed layouts. This smoke does not validate paid-provider or interactive-TUI behavior.

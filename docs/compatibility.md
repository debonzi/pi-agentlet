# Integration evidence and compatibility boundaries

This document records host-specific evidence and limitations for the [functional specification](functional-spec.md) and [architecture decisions](architecture.md). See the [README](../README.md) for usage and the [development guide](development.md) for verification commands.

Allowed host range: `@earendil-works/pi-coding-agent` **>=1.2.0 <1.3.0** (stable **1.2.x**, including build metadata); Node **24 or newer** on Linux. By explicit approval, the version gate admits later 1.2.x patches even without validation. **Only 1.2.0 has been reviewed and integration-tested**; admission is not a compatibility guarantee for other patches. Support strictly below 1.2.0 was explicitly removed, trimming all previous windows (`>=0.86.0 <0.88.0 || >=0.99.1 <0.100.0 || >=1.0.2 <1.1.0`) without filling intervening gaps. Releases >=1.3.0 and prereleases remain rejected. Local installation paths are not embedded in production code.

## Public APIs used

- `ExtensionAPI.registerTool`, `promptSnippet`, and named `promptGuidelines`; failures of the tool itself are thrown, not returned as an ineffective `isError` property. Optional per-task `timeoutSeconds` uses a bounded TypeBox integer; the runner owns the timer, with no additional host timeout API needed. Pi normalizes/coerces arguments before execution (including nullable optional fields for strict providers); extension validation checks the resulting values, not the original model payload.
- `before_agent_start.systemPromptOptions` exposes structured skills, context files, and custom/appended prompt inputs for both user and custom-message-triggered runs on 1.2.0. The adapter does not read `event.prompt`, which is absent on the new custom event variant. It retains the configuration reference for comparison, not the parent prompt/history.
- `ctx.model`, `ctx.thinkingLevel`, `ctx.isProjectTrusted()`, `getAgentDir()`, `parseArgs()`, and `VERSION` expose effective non-tool configuration and CLI parsing. Parent CLI tool-selection options are replayed, but `getAllTools()` and `getActiveTools()` are not used to verify or constrain children. Tool discovery, exposure, activation, and readiness remain pi's responsibility.
- `onUpdate`, `renderCall`, `renderResult`, theme colors, and TUI width helpers implement the tool-local UI. `ToolRenderContext.toolCallId` associates a row with its live execution; `invalidate()` rebuilds the row and requests rendering for UI-only animation. `usage` on the final tool result is supported.
- The supported `pi-tui` Loader uses ten Braille frames (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) at 80 ms. Tool renderers do not receive its required TUI instance, so the extension matches these defaults using a call-owned clock and public row invalidation rather than importing host internals. Custom global working-indicator overrides are not mirrored. The host does not dispose tool slot components on replacement; execution/lifecycle hooks own animation cleanup. In regular-screen mode, supported pi versions clear the screen and scrollback when the first changed line is above the tracked viewport. Keeping all live progress in a height-bounded final tail avoids that path when an expanded active block exceeds terminal height. The tail budget uses `process.stdout.rows` because `ToolRenderContext` does not expose available rows or row visibility; the extension cannot guarantee visibility if unrelated later UI pushes the entire block off-screen.
- `session_shutdown` covers quit, reload, new/resume, and fork/clone teardown on 1.2.0. `session_start` recreates instance state. Public `agent_settled.aborted` is required to distinguish normal final completion from cancellation after an otherwise valid assistant answer.

The 1.2.0 review read the shipped README and the complete `docs/extensions.md`, `tui.md`, `json.md`, `cli.md`, `cli-integration.md`, `packages.md`, `session-format.md`, `message-types.md`, `sdk.md`, `settings.md`, `environment-variables.md`, `configuration.md`, `custom-provider.md`, `providers.md`, `models.md`, `mcp.md`, `virtual-models.md`, and `codemode.md`. Relevant linked resource, trust, session, compaction, theme, terminal, and keybinding documentation was also read. Installed public types, subagent/tool-rendering/SDK examples, CLI parsing and entry points, print/JSON output, resource/model loaders, MCP readiness, lifecycle teardown, and pi-tui Loader/render invalidation implementations were inspected. The available 1.0.4 installation supplied the previous implementation baseline; the shipped changelog and official [1.1.0](https://github.com/earendil-works/pi/releases/tag/v1.1.0) and [1.2.0](https://github.com/earendil-works/pi/releases/tag/v1.2.0) release notes cover the intervening release and target. The release notes link to version-tagged documentation. These findings concern 1.2.0 only; the allowed patch window is a policy choice, not broader validation evidence.

### Changes mapped to integration

| Upstream evidence | Repository impact / regression |
|---|---|
| 1.1.0 additive `--tools +name,-name`; `dist/cli/args.js` validation | Replay remains verbatim in `resources.ts`; fixture and real-host `tool-deltas` checks cover addition and removal. |
| 1.0.4 `--no-mcp`, still public in 1.2.0 `Args.noMcp` and `dist/main.js` | Fixed omitted replay in `resources.ts`. Unit coverage and the `no-mcp` smoke configure a local server but require zero connections in parent and children. |
| 1.1.0 `agent_settled.aborted`; 1.2.0 `docs/json.md` and `dist/core/agent-session.js` | `protocol.ts`/`runner.ts` now require final non-aborted settlement after `agent_end`; tests reject missing/malformed/aborted settlement and retry snapshots. A real child is aborted at `agent_before_settle` after producing valid text. |
| 1.2.0 `before_agent_start` discriminated union and busy startup | Existing handlers in `index.ts`/`verify-child.ts` already consume only shared structured options. Host regression and the `custom-start` smoke exercise a custom run without a user prompt. No `sendMessage` delivery was added to the product. |
| 1.2.0 text print mode exits 1 for `length`; JSON mode still exits 0 | Preserve stop-reason checks regardless of exit status; the `length` smoke rejects all partial child answers. |
| 1.2.0 MCP `reachesTools`, namespace aliases, resource discovery changes | Pi/built-in codemode owns readiness; no adapter catalog inspection or readiness barrier added. Existing delayed-local-MCP and child-catalog-difference profiles pass. |
| 1.1.0 renderer `durationMs`/`outputPad`; 1.2.0 terminal fixes | Additive context fields require no renderer change; the default host shell owns padding. Loader frames/cadence and public invalidation remain unchanged; behavioral offline PTY checks pass. |
| Managed installation has hoisted peer dependencies | Fixed `scripts/typecheck.mjs` to follow Node package search order without requiring exported manifests. Independent nested/hoisted regression fixtures check resolution; the real compiler still uses the unchanged strict options. |
| 1.2.0 OpenRouter per-key catalogs, strict themes/config schemas, resource filtering/context fixes | Children reload the same file-backed configuration offline, then verify resolved physical model/resources; no schema/model fallback or normal-user-resource tests were introduced. Arbitrary provider closures remain outside verification. |

## Important findings

1. JSON streaming events are delta-only; finalized `message_end` is authoritative. `agent_end` and `turn_end` repeat messages and must not add usage again. JSON mode may exit successfully even if the assistant's final stop reason is an error, so process exit status alone is insufficient.
2. CLI print mode accepts task data on stdin. `--no-session` creates an ephemeral conversation; continuation/fork flags and parent prompts must not be copied.
3. CLI `--approve` and `--no-approve` override trust for one run without writing approvals. `isProjectTrusted()` includes temporary trust, unlike reading `trust.json` alone.
4. Pi's package resolver skips missing sources and temporary git refreshes in offline mode. Children use `--offline` to avoid automatic resource installation/updates. Required non-tool resource differences fail startup or verification rather than triggering installation; missing tools are left to pi's normal discovery/execution behavior.
5. Pi's shell tools can start detached children, so killing only the pi PID or its process group is insufficient. Linux `/proc` tracking complements group termination and pi's own shutdown cleanup.
6. The extension API does **not** expose the complete live `ResourceLoader`, extension manifest, effective SettingsManager, arbitrary SDK factory options, or provider implementation closures. `getSystemPromptOptions()` is command-only, not available inside tool execute; `before_agent_start` is the public source used here.
7. Since pi 0.99.2, MCP servers without direct tools connect in the background and need not be ready at `agent_start`. A warm parent and a fresh child can have different catalogs with identical configuration. The extension neither compares those catalogs nor introduces its own readiness barrier.

## Supported reconstruction

Normal CLI launches with file-backed global/project resources and explicit CLI selections are reconstructed, including pi 1.2.0 `-e builtin:<name>` selections combined with `--no-extensions` and `--no-mcp`. The child reloads the same settings/filter configuration, startup flags, cwd, and normal context resources. It uses independent extension instances and verifies observable non-tool configuration before agent work. The verifier runs on `agent_start` so custom providers that do not invoke HTTP payload hooks still work.

Tool handling replays `--tools` (plain/pattern or additive entries), `--exclude-tools`, `--no-tools`, and `--no-builtin-tools` exactly as selected by the parent. No extra tool restriction, fallback selection, `subagents` disabling, catalog comparison, or membership enforcement is added. Every child receives the instruction not to use `subagents` or start other sessions to delegate; it is not a technical recursion barrier.

The CLI script is accepted only when its real path is `dist/cli.js` or `dist/bundle/cli.js` under a package named `@earendil-works/pi-coding-agent`. The bundled layout must also match that package's `bin.pi` declaration, the npm entry point throughout the supported range. Launcher symlinks resolve to the same installed script, not a different CLI. Only these two layouts are checked, with no unrestricted ancestor search. The shipped unbundled CLI remains supported even when `bin.pi` selects the bundle. A native executable named `pi` is recognized without falling back to PATH, but is not integration-tested. Tests may inject a fixture executable directly into the runner; that is not a public per-task capability.

## Explicit limitations

- Virtual models (`api: "pi-virtual"`) are rejected before child startup. The selected virtual model and thinking level do not establish a physical dispatch, routing policy, or branch-local router state; no physical-model fallback is used.
- Inline SDK hosts, unrecognized launchers, `--api-key` startup overrides, and forced in-memory system prompts are rejected. Their non-tool state is not silently guessed. Tool origins themselves are not inspected or rejected.
- Non-tool checks cover resolved physical model data, legacy provider registration configuration (including stream function source, never raw credentials in diagnostics), native-provider registration presence, thinking, trust, cwd, loaded skills, context-file contents, and custom/appended prompt inputs. They do not prove equality of arbitrary extension closures, provider transports/authentication overrides, or hidden mutable state. Required non-tool state must be reconstructible through the original extensions/configuration; serializing it is outside the product contract.
- Tool schemas, descriptions, guidelines, declaration state, exposure, namespaces, annotations, loadout projections, and runtime-only tools/activations are neither copied as a snapshot nor verified. Their availability is determined by pi and the child's resources; missing or different tools do not themselves fail configuration verification.
- MCP configuration is reloaded through the normal built-in extension, not copied as live connections. Each child can start its own stdio servers or HTTP connections, following pi's startup/readiness behavior. Offline startup is not an MCP network sandbox; remote MCP targets still require explicit authorization. Runtime-only MCP registrations or exposure changes are not cloned or verified.
- Standard settings and file-backed resources are re-read, not frozen. Do not edit resource configuration during execution. Per-turn custom prompt sections or conversation-only restrictions that are not recreated by normal resources must be supplied in the delegated task.
- Extension startup failures reported by pi fail child startup. Interactive extension behavior is not emulated, and prompts are never automatically approved. An extension that incorrectly assumes a TUI remains the responsibility of that extension.
- Native binaries and Windows/macOS process cleanup are not tested; runtime execution is restricted to Linux. Deliberate process daemonization that escapes descendant observation is not containment-safe.
- Usage is aggregated from finalized assistant/tool-result messages and non-message `entry_appended` usage, compaction, and branch-summary entries. Repeated turn/agent snapshots and compaction-end results do not add usage again. Provider/extension work not reported by these events cannot be inferred. No additional summarization model is used.

These boundaries do not justify disabling extensions, downgrading models, copying parent conversations, or enlarging user authorization. Revisit the resource adapter when pi adds a public execution-configuration snapshot API.

## Validation

`npm test` exercises fixture subprocesses and host mocks, including tool APIs that throw if configuration capture or verification accesses them. It checks inherited CLI tool options without synthesized restrictions and accepts absent, differing, or SDK-origin tool catalogs while retaining non-tool incompatibility failures.

### Target and commands (2026-10-14)

The active session reports pi **1.2.0** through the extension's imported `VERSION` (the initial delegation attempt was rejected by the old gate). Its process inherited `PI_MANAGED_INSTALL_ROOT`, and the managed launcher selected `current-version` 1.2.0 before that process started. The package manifest declares `bin.pi = dist/bundle/cli.js` and its launcher symlink resolves there. This identifies the session's installation rather than substituting a PATH installation.

Validation used these existing local paths (evidence only, not production defaults):

```sh
HOST=/home/debonzi/.pi/agent/install/releases/1.2.0/node_modules/@earendil-works/pi-coding-agent
export PI_AGENTLET_HOST="$HOST"
export PI_AGENTLET_TYPESCRIPT=/home/debonzi/devel/repos/opcode/site/node_modules/typescript/lib/typescript.js
npm test
npm run typecheck
npm run check
PI_AGENTLET_CLI="$HOST/dist/bundle/cli.js" node scripts/smoke.mjs
PI_AGENTLET_CLI="$HOST/dist/cli.js" node scripts/smoke.mjs
PI_AGENTLET_CLI="$HOST/dist/bundle/cli.js" python3 scripts/smoke-pty.py
PI_AGENTLET_CLI="$HOST/dist/cli.js" python3 scripts/smoke-pty.py
```

| Validation | Exact host / toolchain | Outcome |
|---|---|---|
| Fixture suite | Node 24.16.0, Linux | 81 tests passed; no skipped tests. |
| Typecheck / combined check | TypeScript 5.9.3; pi 1.2.0 public declarations; installed Node types 22.19.19 | Passed using the external-toolchain variables above. |
| Headless offline smoke | pi 1.2.0 `dist/bundle/cli.js` and `dist/cli.js` | All 12 profiles passed on both layouts. |
| Offline PTY smoke | pi 1.2.0, both CLI layouts; Python 3.13.0 | Basic and cancellation profiles passed in regular/fullscreen (8 combinations), including expansion, resize, Escape, settlement, reload, new session, and quit. No surviving fixtures; not pixel-perfect or a real-terminal protocol certification. |

`scripts/smoke.mjs` uses isolated local configuration and an in-process fake provider. All profiles passed on the validated 1.2.0 release: basic delegation, timeout isolation, codemode/nested usage, child-only tool/catalog differences, virtual-model rejection, delayed local MCP, shutdown cancellation, `--no-mcp`, additive tool selection, custom-message startup, length-limited responses, and abort at settlement. Children retain `subagents`, receive the no-further-delegation instruction, inherit CLI exclusions, and never receive private parent conversation markers. The MCP/cancellation profiles warm the parent's catalog through normal codemode execution, then launch fresh children whose stdio initialization is delayed; no equivalence/readiness enforcement is imposed. Cleanup assertions find no surviving fixture pi or MCP processes.

Before fixes, the 74-test fixture baseline passed, but target smoke was rejected by the version gate and target typecheck failed because it looked for nested rather than hoisted peers. These were not evidence of target compatibility. The initial PTY harness had fixture assumptions that needed correction: a 35-column row cannot display the full aggregate counters after host padding; the parent's own MCP connection remains alive after child cancellation; and reload input must wait for parent settlement after Escape. The corrected harness retains all behavioral assertions, uses 48 columns, distinguishes the live parent's server from delegated descendants, and checks settlement before lifecycle commands.

Previously recorded host evidence (0.86/0.87, 0.99.1, 1.0.2, 1.0.4, including the 0.99.1 PTY check) is historical only: those windows were removed and those hosts are no longer claimed supported. An installed 1.0.4 remains available for source comparison, not retained-host validation. Other stable 1.2.x releases are now admitted by the version gate but have not been integration-tested.

No normal user resources, credentials, remote MCP server, downloads, or paid provider are used by these checks. Real-provider behavior, native binaries, other operating systems, pixel-perfect rendering/scrollback, mouse interaction, and resume/fork UI remain unvalidated on 1.2.0. Pi can replace an interrupted tool's result with its native aborted-operation error instead of displaying the extension's final cancelled-task rows.

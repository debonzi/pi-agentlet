# Integration evidence and compatibility boundaries

This document records host-specific evidence and limitations for the [functional specification](functional-spec.md) and [architecture decisions](architecture.md). See the [README](../README.md) for usage and the [development guide](development.md) for verification commands.

Allowed host range: `@earendil-works/pi-coding-agent` **>=1.5.0 <1.7.0** (stable **1.5.x and 1.6.x**, including build metadata); Node **24 or newer** on Linux. Existing 1.5.x support is retained without a new cutoff; prereleases and future minor releases are rejected. **Exact releases 1.5.2 and 1.6.0 have been reviewed and integration-tested**, including both shipped CLI layouts and isolated regular/fullscreen PTYs. Release notes for 1.5.0 and 1.5.1 were reviewed previously, but those hosts remain unavailable. Other 1.5.x and 1.6.x patches are admitted by explicit policy, not claimed reviewed or tested. The clarified upper boundary is exclusive: **1.7.0 and newer remain rejected**. Local installation paths are evidence, not production defaults.

## Public APIs used

- `ExtensionAPI.registerTool`, `promptSnippet`, and named `promptGuidelines`; failures of the tool itself are thrown. The target also supports returned `isError`, but this extension does not need to change its existing error path. Optional per-task `timeoutSeconds` uses a bounded TypeBox integer; the runner owns the timer, with no additional host timeout API needed. Pi normalizes/coerces arguments before execution (including nullable optional fields for strict providers); extension validation checks the resulting values, not the original model payload.
- `before_agent_start.systemPromptOptions` exposes structured skills, context files, and custom/appended prompt inputs for both user and custom-message-triggered runs on 1.5.2. The adapter does not read `event.prompt`, which is absent on the new custom event variant. It retains the configuration reference for comparison, not the parent prompt/history.
- `ctx.model`, `ctx.thinkingLevel`, `ctx.isProjectTrusted()`, `getAgentDir()`, `parseArgs()`, and `VERSION` expose effective non-tool configuration and CLI parsing. Parent CLI tool-selection options are replayed, but `getAllTools()` and `getActiveTools()` are not used to verify or constrain children. Tool discovery, exposure, activation, and readiness remain pi's responsibility.
- `onUpdate`, `renderCall`, `renderResult`, theme colors, and TUI width helpers implement the tool-local UI. `ToolRenderContext.toolCallId` associates a row with its live execution; `invalidate()` rebuilds the row and requests rendering for UI-only animation. `usage` on the final tool result is supported.
- The supported `pi-tui` Loader uses ten Braille frames (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) at 80 ms. Tool renderers do not receive its required TUI instance, so the extension matches these defaults using a call-owned clock and public row invalidation rather than importing host internals. Custom global working-indicator overrides are not mirrored. The host does not dispose tool slot components on replacement; execution/lifecycle hooks own animation cleanup. In regular-screen mode, supported pi versions clear the screen and scrollback when the first changed line is above the tracked viewport. Keeping all live progress in a height-bounded final tail avoids that path when an expanded active block exceeds terminal height. The tail budget uses `process.stdout.rows` because `ToolRenderContext` does not expose available rows or row visibility; the extension cannot guarantee visibility if unrelated later UI pushes the entire block off-screen.
- `session_shutdown` covers quit, reload, new/resume, and fork/clone teardown on 1.5.2. `session_start` recreates instance state. Public `agent_settled.aborted` is required to distinguish normal final completion from cancellation after an otherwise valid assistant answer.

## 1.6.0 review (2026-11-23 UTC)

The active extension's imported `VERSION` rejected the initial read-only delegation with `installed version is 1.6.0`; no child started. Parent PID 54393 runs `/home/debonzi/.nvm/versions/node/v24.16.0/bin/node`, with rewritten title `pi`. Its inherited `PI_MANAGED_INSTALL_ROOT`, the managed launcher `/home/debonzi/.local/bin/pi` → `/home/debonzi/.pi/agent/bin/pi`, and `current-version` = 1.6.0 (modified before parent startup) identify `/home/debonzi/.pi/agent/install/releases/1.6.0/node_modules/@earendil-works/pi-coding-agent`. The release's `.bin/pi` resolves to `dist/bundle/cli.js`; `dist/cli.js` is also shipped. This is not a PATH/latest substitution. The initial working tree was clean; only 1.5.2 and 1.6.0 hosts were available.

Official evidence: `gh-axi release view v1.6.0 -R earendil-works/pi --full` and `gh-axi release list -R earendil-works/pi --limit 6` show 1.5.2 → 1.6.0 with no intervening published release. `gh-axi release view v1.7.0 -R earendil-works/pi --json tagName,body` returned `NOT_FOUND`. See [versioned release notes](https://github.com/earendil-works/pi/releases/tag/v1.6.0). The user subsequently clarified that 1.7.0 is the exclusive upper boundary, not a requested target release; its unavailability does not block that policy.

Before editing integration, the complete shipped README and extension, TUI, JSON, CLI/CLI-integration, SDK, package, settings/configuration/environment, provider/custom-provider, model/model-configuration, MCP, virtual-model, codemode, security, skill, prompt-template, session/session-format/message-type and compaction guides were read. Public tool/render/lifecycle/resource declarations and SDK extension/MCP examples were inspected, along with the subagent example's integration surface. Installed implementations were compared to the retained 1.5.2 baseline.

| 1.6.0 evidence | Repository impact |
|---|---|
| `pi-tui/dist/tui.d.ts`: `Component.render()` returns `readonly string[]`; containers cache child arrays by identity | `src/ui.ts` constructs new output arrays and does not mutate host render output. No renderer shim required; both layouts pass regular/fullscreen PTYs. Loader frames/cadence are unchanged. |
| `dist/modes/print-mode.js` subscribes before `bindExtensions`, preserving JSON events from `session_start`; JSON transformation and pi-ai Usage types unchanged | `protocol.ts` already accepts startup entries, accounts for ancillary usage, and still requires final non-aborted settlement. New regression covers startup custom/usage entries before `agent_start`, with no private startup content becoming an answer. |
| `pi-agent-core/dist/agent-loop.js` finalizes every aborted batch call, checking abort before preparation/hooks | Existing settlement checks and runner cleanup remain necessary. Real shutdown/cancel, settled-abort and PTY Escape checks pass. No looser final-answer extraction was adopted. |
| Extension runner routes event-bus errors safely; session runtime adds deduplicated diagnostics; reload with empty SDK bindings now restarts extensions | CLI/lifecycle hooks need no replacement. Ordinary error/result handling, reload/new/quit and cleanup pass. Inline SDK reconstruction remains unsupported. |
| Resource loader/package manager captures install output and makes git non-interactive; CLI parser changes only credential help text | Keep existing `--offline`, `PI_OFFLINE=1`, stdin tasks, ephemeral sessions and explicit resource/tool/trust replay. No installer, approval or resource fallback added. Cached remote-package refresh remains source-reviewed rather than live-tested. |
| Model defaults become GPT-6.2 Sol; Qwen endpoints/credentials, Anthropic threads and provider transports change | Explicit physical provider/model/effective thinking pins remain authoritative. Offline collision/literal-ID/provider-slash profiles pass. Actual transport/OAuth, new model capabilities and HTTP MCP are not validated. |
| MCP summary helper extracted; pending restored tools survive unrelated deactivation | No catalog comparison/readiness barrier added; local delayed MCP, `--no-mcp`, tool deltas and differing child tools pass. Resume/fork restoration itself is not certified. |

The concrete target incompatibility was the gate: the initial bundled smoke failed at `Unsupported pi version: 1.6.0` before host/provider work. The initial production adjustment added exactly 1.6.0 while preserving 1.5.x. After the user's clarification, the gate admits the requested stable `>=1.5.0 <1.7.0` window, including unvalidated patches. Regression tests check 1.6.x patch admission and rejection of 1.7.0, newer releases and prereleases. Both smoke scripts consume this shared gate; all 17 headless profiles remain unconditional, with no skipped behavior or new orchestration. Host peers remain `"*"`.

### Validation and commands

Existing toolchains: Node 24.16.0, TypeScript 5.9.3 at `/home/debonzi/devel/repos/opcode/site/node_modules/typescript/lib/typescript.js`, and Python 3.13.0. No installation or update was performed.

```sh
export PI_AGENTLET_TYPESCRIPT=/home/debonzi/devel/repos/opcode/site/node_modules/typescript/lib/typescript.js
export PI_AGENTLET_HOST=/home/debonzi/.pi/agent/install/releases/1.6.0/node_modules/@earendil-works/pi-coding-agent
npm test
npm run typecheck
npm run check
# Repeated for 1.6.0 and retained 1.5.2, both entry points:
PI_AGENTLET_CLI="$PI_AGENTLET_HOST/dist/bundle/cli.js" node scripts/smoke.mjs
PI_AGENTLET_CLI="$PI_AGENTLET_HOST/dist/cli.js" node scripts/smoke.mjs
# Target interactive checks, both entry points:
PI_AGENTLET_CLI="$PI_AGENTLET_HOST/dist/bundle/cli.js" python3 scripts/smoke-pty.py
PI_AGENTLET_CLI="$PI_AGENTLET_HOST/dist/cli.js" python3 scripts/smoke-pty.py
# Retained-host declarations:
PI_AGENTLET_HOST=/home/debonzi/.pi/agent/install/releases/1.5.2/node_modules/@earendil-works/pi-coding-agent npm run typecheck
```

| Validation | Result |
|---|---|
| `npm test`, repeated by `npm run check` | 86 passed, none skipped. |
| Target `npm run typecheck`, `npm run check`; retained 1.5.2 typecheck | Passed. |
| Final headless matrix: 1.6.0 and 1.5.2 × bundled/unbundled | All 17 profiles passed in each combination (68 profile runs). |
| Target PTY matrix: both layouts × regular/fullscreen × basic/cancel | All eight combinations passed, including expansion, aggregate resize, Escape, settlement, reload/new/quit and process cleanup. No UI implementation or PTY assertions changed. |
| 1.5.0/1.5.1 and other admitted patches | Not installed; **not yet validated**. Retained 1.5.2 PTYs were not rerun in this review; earlier results below remain historical evidence. |

After correcting the range to `>=1.5.0 <1.7.0`, `npm test` (86 passed, none skipped), target `npm run typecheck`, `npm run check`, and all 17 headless profiles on both releases and both CLI layouts were rerun successfully (68 additional profile runs). `git diff --check` passed. PTYs were not rerun for this gate-only correction; the eight target results above are from the preceding review.

An initial unbundled timeout profile failed its unchanged four-process assertion (three registrations): the one-second execution budget could expire during cold startup before the offline extension loaded. The fixture budget is now five seconds, still much shorter than the default. It continues to require one timed-out child, two completed siblings, four fixture registrations and no surviving processes. The complete final headless matrix passed after this adjustment; the earlier failure is not counted as a pass.

**Verdict: compatible after the gate adjustment for exact 1.6.0, within these CLI/offline boundaries.** Previous range `>=1.5.0 <1.6.0`; resulting range **`>=1.5.0 <1.7.0`**, following the user's clarification of the exclusive upper bound. The interim exact-1.6.0 gate was corrected. Exact tested releases remain 1.5.2 and 1.6.0; broader patch admission is policy, not universal compatibility evidence. No additional cutoff or product redesign was applied. Real providers (including this session's Codex transport), OAuth persistence under forced kill, HTTP MCP, classifier/image services, cached package refresh, native binaries, Bun, other operating systems, resume/fork UI, mouse/scrollback and real-terminal behavior remain not yet validated. All checks used isolated temporary HOME/config/project resources, deterministic providers and local stdio MCP only. No normal user resources, remote private services or paid providers were loaded. No commit, publication, live reload or global configuration change was performed; this session retains its already-loaded gate until reload/restart.

## 1.5.2 review: changes mapped to integration

The official [v1.5.0](https://github.com/earendil-works/pi/releases/tag/v1.5.0), [v1.5.1](https://github.com/earendil-works/pi/releases/tag/v1.5.1), and [v1.5.2](https://github.com/earendil-works/pi/releases/tag/v1.5.2) release bodies and shipped changelog were read. The [public releases API](https://api.github.com/repos/earendil-works/pi/releases?per_page=10) confirms the published sequence 1.4.0 → 1.5.0 (November 2) → 1.5.1 (November 9) → 1.5.2 (November 10), with no intervening published release. Preferred `gh-axi release list/view` requests timed out; public web/API retrieval supplied the release evidence instead.

Before integration changes, the complete target README and `docs/extensions.md`, `tui.md`, `json.md`, `cli.md`, `cli-integration.md`, `sdk.md`, `packages.md`, `settings.md`, `configuration.md`, `environment-variables.md`, `providers.md`, `custom-provider.md`, `models.md`, `models-configuration.md`, `mcp.md`, `virtual-models.md`, `codemode.md`, `security.md`, `skills.md`, `prompt-templates.md`, `sessions.md`, `session-format.md`, `message-types.md`, and `compaction.md` were read across bounded independent reviews. Corresponding public extension/context/tool/render/lifecycle, CLI, SDK/resource-loader/system-prompt, provider/virtual-model, Usage, and TUI declarations were inspected, together with the subagent, Q&A/reload-runtime, Jev router/provider, and SDK resource/session examples. The available 1.4.0 installation supplied the previously reviewed source baseline; 1.5.0/1.5.1 installations were not present.

| Upstream evidence through 1.5.2 | Repository impact / regression |
|---|---|
| 1.5.0 tool validation moves to `pi-schema`; TypeBox features outside JSON Schema no longer apply; 1.5.1 restores some special conversions | `src/index.ts` uses only standard object/array/string/integer bounds and optional fields, not refinements/codecs. No schema shim needed. All delegation/timeout profiles pass the real host's validation; malformed-provider-wire validation is not certified. |
| 1.5.0 `pi-ai/dist/types.d.ts`: `Usage.cost.totalFromProvider`; host `core/usage-totals.js` combines explicit true flags with AND | Fixed `src/usage.ts` dropping provenance. Numeric totals and deduplication remain unchanged. New unit/protocol/task-aggregation tests and the `billed-cost` real-host profile cover billed, mixed/absent flags, zero billed cost, finalized/nested/ancillary usage and repeated snapshots. Smoke billing values are synthetic, not actual charges. |
| `core/system-prompt.js`: `forceSystemPrompt !== undefined` selects an opaque prompt, including an empty string | Review exposed a pre-existing `resources.ts` gap: parent capture used truthiness and child verification ignored the field. Both now reject any defined forced prompt. Unit cases cover empty/nonempty values; `forced-prompt` smoke requires all children to fail verification without answer or usage. No prompt copying was introduced. |
| `core/model-resolver.js`: longest provider-prefix matching supports provider IDs containing `/`; provider defaults/catalogs change | Explicit physical provider/model/thinking pins stay intact. New `provider-slash` smoke complements unchanged authenticated collisions/literal model-ID coverage. Model registry declarations/implementation and virtual-model implementation are unchanged versus 1.4.0; virtual selection still fails explicitly. New `responseModel` metadata does not make router state reconstructible. |
| `core/project-trust.js`: saved denial now wins even without trust-gated project resources | Effective trust capture and `--approve`/`--no-approve` replay remain correct. New `saved-denial` smoke leaves only project AGENTS.md, checks false trust in parent/children and verifies the saved decision is not rewritten. Other profiles continue exercising temporary approval without persisted trust. |
| `core/package-manager.js`: temporary unpinned npm/git resources can refresh at startup; resource path identity/deduplication changes | Preserve both `--offline` and `PI_OFFLINE=1`; reviewed install/update paths return or retain cached resources offline. No package fallback/installer added. Cached temporary npm/git refresh suppression was source-reviewed, not separately exercised by the local-file smoke. |
| 1.5.1 idle cache warming, Anthropic process-local threads, provider refresh/auth locking and MCP OAuth/transport changes | Smoke explicitly sets `cacheWarming: off`. Ancillary usage accounting remains applicable. Fresh ephemeral children inherit neither history nor thread state. MCP readiness remains host-owned; delayed local stdio, `--no-mcp`, differing catalogs and cleanup pass unchanged. HTTP/OAuth/thread transports were not live-tested. |
| `core/agent-session-runtime.js` awaits active abort and credential writes; print mode shares disposal and retains signal handlers through final cleanup | Keep actual-close waiting and bounded descendant escalation in `runner.ts`/`process-tree.ts`. Shutdown/cancel and PTY lifecycle checks pass. The 1.5-second forced-kill grace can still preempt slow credential writes; no OAuth-persistence guarantee is claimed. |
| Extension render context adds key-hint helpers; tool argument rendering coalesces to render frames; overlay teardown improves | Existing ordinary tool-block API needs no change. JSON transformation, extension/tool wrappers, agent-loop implementation, codemode worker host and pi-tui Loader are unchanged in relevant comparisons. Both layouts pass regular/fullscreen PTY expansion, resize, Escape, reload/new/quit and cleanup checks; no custom UI or readiness framework added. |
| 1.5.2 offers continue/fork/cancel for sessions whose original folder vanished; fixes Anthropic OAuth version reporting | Delegated children use fresh `--no-session` conversations in the effective cwd, not resume/import/fork. No adapter change; missing-folder resume/fork and real Anthropic OAuth remain unvalidated. |

The previous gate already admitted 1.5.2; this review did **not** reproduce a target gate rejection. Baseline 82 fixtures, target typecheck and the original 13 smoke profiles passed on both layouts. New focused regressions then reproduced the provenance and forced-prompt gaps before fixes. Production changes are confined to `resources.ts` and `usage.ts`; no protocol/lifecycle/renderer redesign was needed. Both smoke scripts share `supportsPiVersion()` and have no legacy version-dependent profiles to retain: headless now runs all 17 profiles unconditionally; PTY still runs all four mode/profile combinations per layout. Host peer dependencies remain `"*"`.

## Historical reviews (removed support windows)

Policies and results in this section describe earlier reviews, not the current supported range.

### 1.2.0 review

The 1.2.0 review read the shipped README and the complete `docs/extensions.md`, `tui.md`, `json.md`, `cli.md`, `cli-integration.md`, `packages.md`, `session-format.md`, `message-types.md`, `sdk.md`, `settings.md`, `environment-variables.md`, `configuration.md`, `custom-provider.md`, `providers.md`, `models.md`, `mcp.md`, `virtual-models.md`, and `codemode.md`. Relevant linked resource, trust, session, compaction, theme, terminal, and keybinding documentation was also read. Installed public types, subagent/tool-rendering/SDK examples, CLI parsing and entry points, print/JSON output, resource/model loaders, MCP readiness, lifecycle teardown, and pi-tui Loader/render invalidation implementations were inspected. The available 1.0.4 installation supplied the previous implementation baseline; the shipped changelog and official [1.1.0](https://github.com/earendil-works/pi/releases/tag/v1.1.0) and [1.2.0](https://github.com/earendil-works/pi/releases/tag/v1.2.0) release notes cover the intervening release and target. The release notes link to version-tagged documentation. These findings concern 1.2.0 only; the allowed patch window is a policy choice, not broader validation evidence.

#### Changes mapped to integration

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

### 1.3.0 review: changes mapped to integration

The official [v1.3.0 release notes](https://github.com/earendil-works/pi/releases/tag/v1.3.0) (`gh-axi release view v1.3.0 -R earendil-works/pi --full`), shipped changelog, and `gh-axi release list -R earendil-works/pi --limit 8` identify 1.3.0 as the next published release after the previously reviewed 1.2.0; there are no intervening published releases in that list. Version-tagged documentation is linked from the release notes.

Before changing integration, the complete shipped 1.3.0 README and the extension, TUI, JSON, CLI/CLI-integration, SDK, package, configuration/settings/environment, provider/custom-provider/model, MCP, virtual-model, and codemode documentation were read, together with the relevant linked security/trust, sessions/session-format/message-types/compaction, skills, prompt-template, theme, terminal, keybinding, and usage references. Corresponding installed public extension/resource types and subagent/tool/SDK examples were inspected. Byte comparisons against 1.2.0 confirmed unchanged extension declarations/runner/wrapper, resource loader, SDK, CLI argument parser, JSON event transformation, print mode, model registry/runtime, package manager, trust, prompt builder, session manager/runtime, MCP extension, and pi-tui Loader. The changed model resolver, session tool restoration, provider parsing/validation, and codemode worker implementations were also inspected. No protocol, lifecycle, renderer, or cleanup replacement was needed.

| Upstream evidence in 1.3.0 | Repository impact / evidence |
|---|---|
| `dist/core/model-resolver.js`, `dist/main.js`: credential-aware ambiguity resolution; literal model IDs and thinking suffixes | `resources.ts` already pins `--provider`, resolved `--model`, and effective `--thinking`; non-tool verification still rejects mismatches. New unconditional `model-selection` smoke uses two authenticated offline providers, colliding IDs, a literal `agentlet-decoy/fixture:high` ID, and high thinking; the decoy throws if selected. Passed on 1.2.0 and 1.3.0, both layouts. |
| `dist/core/agent-session.js`: restore transcript tools with additive CLI modifiers when resuming | Children remain fresh `--no-session` invocations; no history or runtime activation snapshot is copied. Existing additive-tool, differing-catalog, and local-MCP profiles pass unchanged. |
| `pi-ai/dist/types.d.ts`, `utils/json-parse.js`, `utils/validation.js`: `ToolCall.argumentsError`, complete malformed arguments rejected instead of retaining a parsed prefix | Host validation remains authoritative before extension execution; no parser/coercion shim added. `protocol.ts` still rejects assistant tool-call messages as final answers. Real provider wire parsing is not exercised by the fake-provider smoke. |
| `pi-codemode/dist/runtime/host.js` and host `dist/extensions/codemode/execute.js`: request worker termination without waiting; count live workers until actual exit, cap two per pi process | No scheduling redesign: each delegated pi is a separate process. Agentlet still awaits process close and kills ordinary descendants; codemode/nested-usage, shutdown, and PTY cancellation profiles pass. Bun's non-interruptible built-ins remain unvalidated. |
| `pi-ai/dist/api/transform-messages.js`: drop other models' thinking; Kimi now uses Chat Completions `/v1`; changed retry patterns and catalog metadata | Independent children never receive parent thinking/history; physical model/resource verification is unchanged. Provider endpoint overrides may require user migration; no credentials, endpoint rewrites, or live provider calls were used. |
| Exact internal package pins; interactive overlay completion fix | Preserve `*` host peer dependencies. No custom overlays are used. Ordinary tool rendering and default Loader cadence are unchanged; both CLI layouts pass isolated regular/fullscreen PTY checks. |

The concrete pre-fix incompatibility was the version gate rejecting 1.3.0, including in the active session. Baseline fixtures (81 tests) and target typecheck already passed; the initial target smoke failed at its gate, not at provider execution. The initial minimal production adjustment added only 1.3.0. A subsequent explicit user request expanded admission to `>=1.2.0 <1.4.0`, including unvalidated stable patches; regression tests at that point admitted both minor lines and rejected 1.4.0 or newer and all prereleases while retaining the previous lower boundary. Neither a passing fixture suite nor that gate adjustment alone establishes support; the real-host results below do.

### 1.4.0 review: changes mapped to integration

The official [v1.4.0 release notes](https://github.com/earendil-works/pi/releases/tag/v1.4.0), shipped changelog (2026-10-21), and `gh-axi release list -R earendil-works/pi --limit 8` identify 1.4.0 as the next published release after the previously reviewed 1.3.0, with no intervening published release in that list. Release notes were read with `gh-axi release view v1.4.0 -R earendil-works/pi --full`; linked documentation is version-tagged.

Before editing, the complete shipped 1.4.0 README and the extension/lifecycle, TUI, JSON, CLI/CLI-integration, SDK, package, configuration/settings/environment, provider/custom-provider/model, MCP, virtual-model, and codemode guides were read, together with Models Configuration and the relevant security/trust, session/session-format/message-types/compaction, skills, prompt-template, theme, terminal, keybinding, usage, and context references. Changed relevant 1.3.0 guides were also read completely; unchanged guides were compared byte-for-byte. Corresponding public extension/context/tool/rendering/lifecycle, CLI, resource-loader, and structured-prompt declarations and subagent/tool-rendering/SDK examples were inspected.

Byte comparisons confirmed unchanged extension public declarations/runner/wrapper, resource loader and declarations, CLI parser/declarations and main entry, JSON event transformation, print mode, session manager/runtime, settings, package manager, trust, structured prompt builder, tool-execution renderer, and pi-tui Loader. Changed session recovery/tool restoration, SDK/provider composition/runtime, codemode admission, MCP config, interactive dialogs, and terminal-exit restoration implementations were inspected. This is source-review evidence, not a substitute for the real-host matrix below.

| Upstream evidence in 1.4.0 | Repository impact / evidence |
|---|---|
| `dist/core/agent-session.js`: recovery now omits a failed attempt and its matching tool results from projected context; extension tools not mentioned on a resumed branch can activate | `protocol.ts` still accepts only finalized normal text followed by final non-aborted settlement; no context/history is copied. Existing protocol retry/usage tests and real `length`, `custom-start`, and `settled-abort` profiles pass. Resume/fork recovery itself was not exercised. |
| `dist/core/compaction/{compaction,branch-summarization}.js`: summary output caps removed; split-turn instructions forwarded | Agentlet calls neither summary helper. `protocol.ts` continues counting reported `entry_appended` usage once, not duplicate completion snapshots. Fixture coverage passes; real summary generation remains unvalidated. No extra summarization or resource fallback was added. |
| `dist/extensions/codemode/execute.js`: FIFO worker admission waits up to 60 seconds; `PI_CODEMODE_MAX_WORKERS` overrides the per-process default of two | Agentlet still uses independent processes and its own bounded five-child queue. Existing real codemode/nested-usage, local-MCP, timeout and cancellation profiles pass. `resources.test.ts` now explicitly checks preservation of the new environment setting. Saturating a child's worker pool is not covered. |
| `dist/core/sdk.js`, `model-runtime.js`, and pi-ai client identity: attribution headers move below `before_provider_headers`; default models/catalogs and retry behavior change | `resources.ts` pins the physical provider/model/thinking rather than using defaults. `model-selection` passes with authenticated offline collisions and a literal model ID; the adapter does not serialize header hooks or arbitrary provider closures. Actual HTTP/OAuth/provider transport behavior remains unvalidated. |
| `dist/extensions/mcp/config.js`: strip a UTF-8 BOM; provider composition accepts classifier compatibility metadata; loader aliases expose `pi-ai/models` | No adapter shim needed: resources are reloaded by the same host installation. Delayed local MCP, `--no-mcp`, built-in resource selections, and differing child catalogs pass unchanged. BOM-specific configuration, classifier/image calls, and the new import alias were source-reviewed, not separately integration-tested. |
| `pi-tui/dist/{tui,tui-alt-screen,terminal}.js`: last-resort exit restoration; host interactive dialogs now stack; Rex and Markdown fixes | Agentlet uses only the ordinary tool block, not dialogs or a custom TUI. Public row invalidation and 80 ms Loader defaults are unchanged. Both layouts pass isolated regular/fullscreen basic/cancel PTY checks, including expansion, resize, Escape, reload, new session, quit and fixture cleanup. Hard-kill restoration, real terminals, mouse and scrollback are not certified. |

The concrete reproduced incompatibility was the gate rejecting the active 1.4.0 host. Before changes, all 81 fixtures and target typecheck passed, but target smoke failed at `Unsupported pi version: 1.4.0` before provider work. The initial minimal production change added exactly 1.4.0 (including build metadata), with regression coverage then retaining both older windows and rejecting 1.4.1+, future minor/major releases and prereleases. The subsequent explicit policy expansion to `>=1.2.0 <2.0.0` now admits stable 1.x minor/patch releases without claiming they were reviewed or tested; tests retain the lower boundary and reject 2.x and all prereleases. The smoke scripts share `supportsPiVersion()` and contain no separate version-dependent profiles to update; all 13 profiles remain unconditional and unchanged. The verifier still requires the child's exact host version. No protocol, rendering, lifecycle, cleanup, or product-contract replacement was needed, and host peer dependencies remain `"*"`.

## Important findings

1. JSON streaming events are delta-only; finalized `message_end` is authoritative. `agent_end` and `turn_end` repeat messages and must not add usage again. JSON mode may exit successfully even if the assistant's final stop reason is an error, so process exit status alone is insufficient.
2. CLI print mode accepts task data on stdin. `--no-session` creates an ephemeral conversation; continuation/fork flags and parent prompts must not be copied.
3. CLI `--approve` and `--no-approve` override trust for one run without writing approvals. `isProjectTrusted()` includes temporary trust, unlike reading `trust.json` alone.
4. Pi's package resolver skips missing sources and temporary git refreshes in offline mode. Children use `--offline` to avoid automatic resource installation/updates. Required non-tool resource differences fail startup or verification rather than triggering installation; missing tools are left to pi's normal discovery/execution behavior.
5. Pi's shell tools can start detached children, so killing only the pi PID or its process group is insufficient. Linux `/proc` tracking complements group termination and pi's own shutdown cleanup.
6. The extension API does **not** expose the complete live `ResourceLoader`, extension manifest, effective SettingsManager, arbitrary SDK factory options, or provider implementation closures. `getSystemPromptOptions()` is command-only, not available inside tool execute; `before_agent_start` is the public source used here.
7. Since pi 0.99.2, MCP servers without direct tools connect in the background and need not be ready at `agent_start`. A warm parent and a fresh child can have different catalogs with identical configuration. The extension neither compares those catalogs nor introduces its own readiness barrier.

## Supported reconstruction

Normal CLI launches with file-backed global/project resources and explicit CLI selections are reconstructed, including pi 1.5.2 `-e builtin:<name>` selections combined with `--no-extensions` and `--no-mcp`. The child reloads the same settings/filter configuration, startup flags, cwd, and normal context resources. It uses independent extension instances and verifies observable non-tool configuration before agent work. The verifier runs on `agent_start` so custom providers that do not invoke HTTP payload hooks still work.

Tool handling replays `--tools` (plain/pattern or additive entries), `--exclude-tools`, `--no-tools`, and `--no-builtin-tools` exactly as selected by the parent. No extra tool restriction, fallback selection, `subagents` disabling, catalog comparison, or membership enforcement is added. Every child receives the instruction not to use `subagents` or start other sessions to delegate; it is not a technical recursion barrier.

The CLI script is accepted only when its real path is `dist/cli.js` or `dist/bundle/cli.js` under a package named `@earendil-works/pi-coding-agent`. The bundled layout must also match that package's `bin.pi` declaration, the npm entry point in the reviewed releases. Launcher symlinks resolve to the same installed script, not a different CLI. Only these two layouts are checked, with no unrestricted ancestor search. The shipped unbundled CLI remains supported even when `bin.pi` selects the bundle. A native executable named `pi` is recognized without falling back to PATH, but is not integration-tested. Tests may inject a fixture executable directly into the runner; that is not a public per-task capability.

## Explicit limitations

- Virtual models (`api: "pi-virtual"`) are rejected before child startup. The selected virtual model and thinking level do not establish a physical dispatch, routing policy, or branch-local router state; no physical-model fallback is used.
- Inline SDK hosts, unrecognized launchers, `--api-key` startup overrides, and forced in-memory system prompts (including empty strings, in parent capture and child verification) are rejected. Their non-tool state is not silently guessed. Tool origins themselves are not inspected or rejected.
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

### Previous target and commands (2026-11-16 UTC)

**Verdict: compatible after the usage-provenance and forced-prompt verification fixes, within the documented CLI/offline boundaries.** The active parent PID 20234 runs `/home/debonzi/.nvm/versions/node/v24.16.0/bin/node`; its rewritten process title is `pi`. Its inherited `PI_MANAGED_INSTALL_ROOT`, managed launcher's release selection, `current-version` = 1.5.2 (written before process startup), release manifest and `.bin/pi` symlink identify this installation, rather than a PATH/latest-release substitution. The installation's exported `VERSION` was independently read as 1.5.2; successful delegation through the active extension also requires exact parent/child version equality.

- Package: `/home/debonzi/.pi/agent/install/releases/1.5.2/node_modules/@earendil-works/pi-coding-agent`.
- Launcher: `/home/debonzi/.local/bin/pi` → `/home/debonzi/.pi/agent/bin/pi` → selected release's `node_modules/.bin/pi`.
- Declared/runnable CLI: `dist/bundle/cli.js`; shipped alternative: `dist/cli.js`.
- Existing toolchain: Node 24.16.0, TypeScript 5.9.3 at `/home/debonzi/devel/repos/opcode/site/node_modules/typescript/lib/typescript.js`, host-hoisted `@types/node` 22.19.19, Python 3.13.0; no installations.
- Initial working tree: clean. Available hosts: 1.4.0 and 1.5.2 only. The former is now outside the requested cutoff and was used for source comparison and a negative gate check, not retained-host integration revalidation. No other representative from the retained 1.5.x window was available.

Commands run:

```sh
HOST=/home/debonzi/.pi/agent/install/releases/1.5.2/node_modules/@earendil-works/pi-coding-agent
export PI_AGENTLET_HOST="$HOST"
export PI_AGENTLET_TYPESCRIPT=/home/debonzi/devel/repos/opcode/site/node_modules/typescript/lib/typescript.js
npm test
npm run typecheck
npm run check
PI_AGENTLET_CLI="$HOST/dist/bundle/cli.js" node scripts/smoke.mjs
PI_AGENTLET_CLI="$HOST/dist/cli.js" node scripts/smoke.mjs
PI_AGENTLET_CLI="$HOST/dist/bundle/cli.js" python3 scripts/smoke-pty.py
PI_AGENTLET_CLI="$HOST/dist/cli.js" python3 scripts/smoke-pty.py
# Negative gate check: expected nonzero exit before starting pi.
PI_AGENTLET_CLI=/home/debonzi/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js node scripts/smoke.mjs
```

| Validation | Exact host / layouts | Outcome |
|---|---|---|
| `npm test` | Host-independent fixtures, Node 24.16.0 | 85 passed, none skipped; repeated by `npm run check`. |
| `npm run typecheck`, `npm run check` | pi 1.5.2 declarations, compiler/types above | Passed. |
| `node scripts/smoke.mjs` | pi 1.5.2, both CLI layouts | All 17 profiles passed per layout: 34 profile runs; no surviving fixture pi/MCP processes. |
| `python3 scripts/smoke-pty.py` | pi 1.5.2, both layouts, regular/fullscreen, basic/cancel | All 8 combinations passed, including normal expansion, aggregate resize, Escape, settlement, reload, new session, quit and cleanup. No renderer or PTY assertions changed. |
| Removed-host smoke gate | pi 1.4.0 bundled path | Expected rejection: `Unsupported pi version: 1.4.0`, before starting a host/provider. This is a negative policy check, not compatibility validation. |
| Retained 1.5.0 / 1.5.1 and other 1.5.x patches | Not installed | **Not yet validated**; release-note/source review is not integration evidence for those exact hosts. |

The new forced-prompt smoke initially expected the verifier's internal category in the returned diagnostic. The runner intentionally exposes only its fixed privacy-safe resource-incompatibility message. The fixture was corrected to require that exact existing message and additionally assert three failed children with no answer or usage; no production diagnostic or earlier assertion was weakened. Both full 17-profile suites were then rerun successfully.

Support changes from `>=1.2.0 <2.0.0` to **`>=1.5.0 <1.6.0`**, as requested. All older validation below is historical. No future minor/major or prerelease is admitted; untested 1.5.x patches remain a policy window rather than a universal compatibility claim.

All integration checks used isolated temporary HOME/config/project directories, deterministic providers and local stdio MCP fixtures, with cache warming disabled. They loaded no normal user resources and contacted no paid provider or remote MCP service. No commit, publication, live reload, installation/update or global configuration change was performed; changes are left uncommitted, and the current parent keeps its already-loaded extension until reload/restart.

Real-provider behavior (including this session's OpenAI Codex transport), OAuth refresh persistence under forced termination, HTTP MCP, Anthropic threads, classifier/image calls, summary generation, worker-pool saturation, cached temporary package refresh, native binaries, Bun, other operating systems, missing-folder resume/fork, mouse/scrollback and real-terminal behavior remain **not yet validated** on 1.5.2. No further product approval is needed for these fixes; expanding those boundaries requires separate authorization/testing.

### Previous target and commands (2026-10-25 UTC)

**Verdict: compatible after the gate adjustment, within the documented CLI/offline validation boundaries.** The active extension's imported `VERSION` reported `installed version is 1.4.0` when the initial bounded analysis delegation was rejected. No child started. The active parent PID 1037404 runs `/home/debonzi/.nvm/versions/node/v24.16.0/bin/node`; its process title is rewritten to `pi`, so `/proc` alone does not expose the original script. Its inherited `PI_MANAGED_INSTALL_ROOT`, the managed launcher's release selection, `current-version` = 1.4.0, the release manifest, and the `node_modules/.bin/pi` symlink establish the matching installation:

- Package: `/home/debonzi/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent`.
- Launcher: `/home/debonzi/.local/bin/pi` → `/home/debonzi/.pi/agent/bin/pi` → selected release's `node_modules/.bin/pi`.
- Declared/runnable CLI: `dist/bundle/cli.js`; shipped alternative: `dist/cli.js`.

This uses active imported-version and managed-launcher evidence, not a PATH/latest-release substitution. The initial Git working tree was clean. Only local 1.3.0 and 1.4.0 installations were available. The retained 1.2.x window was not revalidated: its previously tested 1.2.0 installation is no longer present. No other stable patch was available.

Existing toolchains were reused: Node 24.16.0, TypeScript 5.9.3 at `/home/debonzi/devel/repos/opcode/site/node_modules/typescript/lib/typescript.js`, host-resolved `@types/node` 22.19.19, and Python 3.13.0. Commands run:

```sh
HOST=/home/debonzi/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent
export PI_AGENTLET_HOST="$HOST"
export PI_AGENTLET_TYPESCRIPT=/home/debonzi/devel/repos/opcode/site/node_modules/typescript/lib/typescript.js
npm test
npm run typecheck
npm run check
PI_AGENTLET_CLI="$HOST/dist/bundle/cli.js" node scripts/smoke.mjs
PI_AGENTLET_CLI="$HOST/dist/cli.js" node scripts/smoke.mjs
PI_AGENTLET_CLI="$HOST/dist/bundle/cli.js" python3 scripts/smoke-pty.py
PI_AGENTLET_CLI="$HOST/dist/cli.js" python3 scripts/smoke-pty.py
# Retained representative: typecheck and all four smoke commands repeated with:
HOST=/home/debonzi/.pi/agent/install/releases/1.3.0/node_modules/@earendil-works/pi-coding-agent
export PI_AGENTLET_HOST="$HOST"
```

| Validation | Exact host / layouts | Outcome |
|---|---|---|
| `npm test` | Host-independent fixtures, Node 24.16.0 | 82 passed, none skipped; repeated by `npm run check`. |
| `npm run typecheck`, `npm run check` | pi 1.4.0 declarations; external compiler/Node types above | Passed. |
| Retained-host `npm run typecheck` | pi 1.3.0 declarations | Passed. |
| `node scripts/smoke.mjs` | pi 1.4.0 and 1.3.0, both `dist/bundle/cli.js` and `dist/cli.js` | All 13 profiles passed per release/layout: 52 profile runs. Cleanup assertions found no surviving fixture pi/MCP processes. |
| `python3 scripts/smoke-pty.py` | Both releases/layouts, regular/fullscreen, basic/cancel | All 16 combinations passed, including expansion, resize/aggregate tail, Escape, settlement, reload, new session, quit and cleanup. No harness/assertion changes. |
| Retained pi 1.2.x | No installation available | Not revalidated; 1.2.0 results below are historical evidence only. |

Support initially changed from `>=1.2.0 <1.4.0` to `>=1.2.0 <1.4.0 || 1.4.0` after the review. A subsequent explicit user request expanded it to `>=1.2.0 <2.0.0`, including unvalidated stable minor and patch releases. No cutoff was requested or applied. This is an admission policy, not a claim that every admitted release was reviewed or tested.

After this gate-only policy expansion, `npm test` (82 passed, none skipped), `npm run typecheck`, and `npm run check` passed again using the exact target toolchain and commands above. Retained-host 1.3.0 typecheck and all 13 headless smoke profiles on both releases and both CLI layouts were also rerun successfully (52 profile runs). PTY checks were not rerun for the policy change; the 16 PTY results above are from the preceding compatibility review. No additional host release was available or declared tested.

All smoke runs used isolated temporary HOME/config/project directories, deterministic in-process providers, and local stdio MCP only. No normal user resources, credentials, remote MCP target, installation/update, or paid provider was used. The diff changes only the gate, regression tests, and support/evidence documentation. No commit, publish, live reload, or global configuration change was performed; this parent retains its previously loaded gate until reload/restart.

Real-provider behavior (including the active OpenAI Codex transport), classifier/image services, summary generation, worker-pool saturation, native binaries, Bun, other operating systems, resume/fork UI, and pixel-perfect/real-terminal behavior remain **not yet validated** on 1.4.0. Provider-specific migration and arbitrary runtime-only non-tool state remain subject to the explicit limitations above, not silent fallback.

### Previous target and commands (2026-10-17 UTC)

The active session's imported `VERSION` was confirmed by its own tool rejection: `installed version is 1.3.0`. The running parent process was Node 24.16.0, started after the managed launcher selected `current-version` 1.3.0. The launcher `/home/debonzi/.pi/agent/bin/pi` executes the selected release's `node_modules/.bin/pi`, whose symlink and package `bin.pi` both identify `dist/bundle/cli.js`. The exact package is `/home/debonzi/.pi/agent/install/releases/1.3.0/node_modules/@earendil-works/pi-coding-agent`; `dist/cli.js` is also shipped and tested. This combines active-process/import evidence with the launcher, not a PATH or latest-release substitution. The initial Git working tree was clean.

Existing toolchains were reused without installation: Node 24.16.0, TypeScript 5.9.3 at `/home/debonzi/devel/repos/opcode/site/node_modules/typescript/lib/typescript.js`, host-resolved `@types/node` 22.19.19, and Python 3.13.0. Both local host installations, 1.2.0 and 1.3.0, were available. No other admitted 1.2.x or 1.3.x patch was available for testing.

```sh
HOST=/home/debonzi/.pi/agent/install/releases/1.3.0/node_modules/@earendil-works/pi-coding-agent
export PI_AGENTLET_HOST="$HOST"
export PI_AGENTLET_TYPESCRIPT=/home/debonzi/devel/repos/opcode/site/node_modules/typescript/lib/typescript.js
npm test
npm run typecheck
npm run check
PI_AGENTLET_CLI="$HOST/dist/bundle/cli.js" node scripts/smoke.mjs
PI_AGENTLET_CLI="$HOST/dist/cli.js" node scripts/smoke.mjs
PI_AGENTLET_CLI="$HOST/dist/bundle/cli.js" python3 scripts/smoke-pty.py
PI_AGENTLET_CLI="$HOST/dist/cli.js" python3 scripts/smoke-pty.py
# Retained representative: repeat typecheck and all four smoke commands with:
HOST=/home/debonzi/.pi/agent/install/releases/1.2.0/node_modules/@earendil-works/pi-coding-agent
export PI_AGENTLET_HOST="$HOST"
```

| Validation | Exact host / layouts | Outcome |
|---|---|---|
| `npm test` | Host-independent fixtures, Node 24.16.0 | 81 tests passed, none skipped; repeated successfully by `npm run check`. |
| `npm run typecheck`, `npm run check` | pi 1.3.0 declarations; external compiler/Node types above | Passed. |
| Retained-host `npm run typecheck` | pi 1.2.0 declarations, same compiler | Passed. |
| `node scripts/smoke.mjs` | pi 1.3.0 and 1.2.0; `dist/bundle/cli.js` and `dist/cli.js` | All 13 profiles passed per release/layout (52 profile runs). No surviving fixture pi/MCP processes. |
| `python3 scripts/smoke-pty.py` | Both releases, both layouts; regular/fullscreen, basic/cancel | All 16 combinations passed: expansion, resize/aggregate progress, Escape, settlement, reload, new session, quit, and process cleanup. No renderer or PTY assertions were weakened. |

After the explicit policy expansion to `>=1.2.0 <1.4.0`, `npm test` (81 passed), `npm run typecheck`, and `npm run check` were rerun successfully, along with retained-host typecheck and all 13 headless smoke profiles on both releases and both CLI layouts. The PTY results above are from the preceding compatibility review; PTY checks were not rerun for this gate-only policy change.

All integration checks used isolated HOME/config/project directories, deterministic in-process providers, and local stdio MCP only. No normal user resources, credentials, remote MCP service, installation, or paid provider was used. Support initially changed from `>=1.2.0 <1.3.0` to `>=1.2.0 <1.3.0 || 1.3.0`, then to `>=1.2.0 <1.4.0` by explicit user request. The broader patch admission is policy, not evidence of additional tested releases. Interactive evidence is behavioral PTY coverage, not pixel-perfect/scrollback/mouse or real-terminal certification. Paid/real-provider behavior (including this session's OpenAI Codex transport), native binaries, Bun, other operating systems, and resume/fork interactive flows remain not yet validated on 1.3.0. The current parent keeps the previously loaded gate until reload/restart; no live reload or global configuration change was performed.

### Previous target and commands (2026-10-14)

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

Previously recorded host evidence (0.86/0.87, 0.99.1, 1.0.2, 1.0.4, including the 0.99.1 PTY check) is historical only: those windows were removed and those hosts are no longer claimed supported. At the previous review, an installed 1.0.4 was available for source comparison, not retained-host validation; it is no longer present in the current managed releases directory. At that review, other stable 1.2.x releases were admitted without integration testing; they are now outside the supported range.

No normal user resources, credentials, remote MCP server, downloads, or paid provider are used by these checks. Real-provider behavior, native binaries, other operating systems, pixel-perfect rendering/scrollback, mouse interaction, and resume/fork UI remain unvalidated on 1.2.0. Pi can replace an interrupted tool's result with its native aborted-operation error instead of displaying the extension's final cancelled-task rows.

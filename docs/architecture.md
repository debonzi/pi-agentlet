# Architecture and design decisions

This is the maintained design reference for pi-agentlet. The [functional specification](functional-spec.md) defines observable behavior; the [README](../README.md) documents use and maintenance; [compatibility notes](compatibility.md) record host-specific evidence and limitations. Update these documents together when an authorized change affects their contracts.

## Module ownership

| Module | Responsibility |
|---|---|
| `index.ts` | Package entry point; re-exports the extension implementation. |
| `src/index.ts` | Registers the tool, schema, parent guidance, rendering, configuration capture, and lifecycle hooks. |
| `src/manager.ts` | Validates input; owns the instance-wide FIFO queue, shared concurrency, task states, per-call cancellation, progress, and aggregation orchestration. |
| `src/runner.ts` | Spawns each child, feeds stdin, handles protocol/process outcomes, timeout and cancellation, and awaits cleanup. |
| `src/protocol.ts` | Incremental bounded JSONL framing, authoritative final-answer extraction, protocol validation, and event interpretation. |
| `src/process-tree.ts` | Linux process-group/descendant tracking and graceful/forced termination. |
| `src/resources.ts` | Resolves the reviewed executable, reconstructs CLI/environment configuration, and builds resource expectations. |
| `src/verify-child.ts` | Checks effective child configuration before work and detects supported configuration mismatches. |
| `src/results.ts` | Final-only result formatting, UTF-8 answer caps, and private full-answer artifacts. |
| `src/usage.ts` | Reported usage aggregation helpers. |
| `src/ui.ts` | Ordinary tool-block rendering, compact and expanded, and disposable running-task animation. |
| `src/prompt.ts` | Parent delegation guidelines and automatic child instructions. |
| `src/text.ts`, `src/types.ts` | Bounded/sanitized text helpers and internal contracts. |
| `src/limits.ts` | Centralized internal limits. |

The flow is: validate all tasks → capture/check invocation configuration → enqueue in the shared manager → start up to five children → verify child resources → collect final outcomes and clean up processes → preserve oversized answers → return ordered results once all tasks settle. Compact UI metadata is published while the call is pending, never as intermediate model-visible content.

## Decisions and rationale

### Blocking delegation, not a job-management framework

One `subagents({ tasks })` call owns the lifetime of its tasks. Waiting avoids background result injection and makes cancellation and aggregation explicit while child processes and the UI continue working. Calls on the same extension instance share a bounded FIFO queue; they do not each receive a separate process budget.

Do not add start/status/wait/cancel operations, background delivery through `sendMessage`, daemons, durable job registries, session recovery, personas, workflows, pipelines, task dependencies, or custom management panels without an explicitly approved scope change. No tmux-based or detached-process orchestration is needed for this product.

### Fresh subprocesses, not conversation forks

Each child is a normal pi session in a separate process, with independent context and new resource instances. This isolates disposable investigation from the parent's context without embedding another runtime or inventing a session scheduler inside pi.

Invoke the verified installed CLI with `spawn`, `shell: false`, task data on stdin, JSON/print output, and ephemeral session storage. Do not interpolate tasks into shell commands, copy `process.argv` blindly, reuse parent sessions, or copy the parent's complete prompt/history. Continuation flags and parent prompts are not configuration to inherit.

### Equivalent resources, not serialized runtime state

Use public host APIs and standard discovery/CLI selections to reconstruct applicable resources and verify observable effective configuration. Keep this adapter separate from scheduling and protocol handling because compatibility is host-version-specific.

The contract is resource/configuration equivalence, not shared extension memory or a clone of every closure and connection. File-backed extensions can reconstruct dynamic providers and tools; required runtime-only configurations that cannot be reproduced must fail explicitly. Do not work around API gaps by downgrading models, removing extensions/skills, choosing a fixed read-only tool list, copying history, approving trust, or installing resources. A central API blocker must be discussed rather than silently replacing the requirement. See [compatibility notes](compatibility.md) for current limits and future API opportunities.

### Instruction-only prohibition on further delegation

Children receive explicit instructions not to delegate further, but retain `subagents`. Disabling, hiding, or rejecting the tool based on a child marker would violate the normal-resource contract. Consequently, the five-child limit is per instance, not a global recursion or OS-process safeguard.

Likewise, task scope and read-only directions do not sandbox general-purpose shell tools. Delegation cannot enlarge the user's authorization, including for remote targets. Repository development instructions are not a substitute for the automatic child prompt.

### Authoritative final events, bounded retention

Streaming deltas are not reliable final-answer snapshots. Use finalized messages and validate stop reason, agent completion, verification, and actual process exit together. Neither an old text message nor exit code zero alone proves success. Count reported usage once instead of summing repeated turn/agent snapshots.

Retain only bounded protocol state, the current answer candidate, usage, and compact activity/diagnostics. Do not store full transcripts/thinking or forward raw stderr. Oversized valid answers are preserved as private final-only artifacts outside the repository; no additional model call is used to summarize them. Returned artifacts remain available after shutdown rather than being deleted with temporary execution files.

### Lifecycle owns process cleanup

The manager owns call/queue cancellation, while the runner and process-tree module own child termination and actual-close waiting. Input validation preserves each optional `timeoutSeconds` override and rejects invalid budgets before queueing. The runner converts seconds to milliseconds at child startup, using the centralized 20-minute default when omitted; queue time never consumes the budget. The maximum whole-second override fits Node's signed 32-bit timer to avoid overflow into an immediate timeout. Shutdown is asynchronous and idempotent; a new session receives fresh manager state. Do not spawn children or create long-lived watchers/timers merely by loading the extension.

Linux process groups plus `/proc` descendant tracking cover ordinary tool descendants, including separate groups. Escalation is required for ignored SIGTERM; `proc.killed` alone is insufficient. This is cleanup, not a sandbox against deliberately escaping processes. Other platforms are unsupported until their cleanup behavior is implemented and tested.

### Shared files and tool-local UI

No snapshots, automatic commits, worktrees, or global write queues are created. Parallel edits require disjoint scopes, and analysis references must be revalidated because sibling tools and external processes can still change files. Blocking one call does not serialize all tools or processes.

Progress uses the host's ordinary tool block, metadata updates, and normal expansion. During execution, task instructions are static and all changing content stays in a stable tail. Compact and expanded views use a fixed header plus two fixed rows per task—state/timing and bounded recent activity—when that tail fits within the terminal height after reserving six rows for host UI; otherwise they fall back to one aggregate row. Expanded view additionally shows the task instructions above the tail. This keeps animated lines in the live viewport when the active tool block itself is taller than the terminal, avoiding pi's destructive above-viewport full-redraw path without introducing a widget or configuration surface. Stable presentation snapshots are deduplicated. Each live TUI call owns a disposable animation clock, started only when a partial result contains running tasks. It redraws the row through `ToolRenderContext.invalidate()` without publishing progress or changing result data. The clock matches pi's default Working frames/cadence; the native Loader requires a TUI instance that tool renderers do not receive. Execution owns abort/finally cleanup, and session teardown stops all clocks before awaiting child cleanup. Renderers cannot start clocks for historical or headless calls. The extension cannot detect whether unrelated later UI has pushed its entire tool block out of the viewport; delegation guidelines already prohibit conflicting sibling tools, and no private host internals are used to guess visibility. Do not replace the editor/footer, install persistent widgets, add a `/subs` management command, or create a separate control panel. Headless behavior is part of the same contract, not a separate mode with weaker guarantees.

### Minimal dependencies and explicit compatibility

Use strict, erasable TypeScript and Node built-ins. Publish a pi package with an explicit root extension entry point and `*` host peer dependencies; do not bundle another pi runtime or add queue/process/UI libraries unnecessarily. The package includes the maintained `docs` directory so documentation links remain useful outside a checkout.

Compatibility is deliberately bounded to the supported host range. Before integration changes, read the relevant host documentation in full and inspect public types/examples across that range. The official subagent example is integration evidence, not a product template: its personas/chains and resource tradeoffs are not automatically adopted here.

## Verification and maintenance

Use fixture subprocesses and host mocks for normal tests; no credentials, network, global pi installation, or paid models are required. Reuse an existing TypeScript/host toolchain when necessary, without implicit installation. The [functional acceptance checklist](functional-spec.md#shared-filesystem-and-acceptance) defines regression areas; the [development guide](development.md) provides commands and opt-in smoke procedures.

When changing behavior, update the responsible module, regression tests, functional contract, and affected README/compatibility sections. Keep operational defaults in `src/limits.ts` and reflect them consistently in descriptions and docs. Product additions outside these decisions require explicit approval rather than speculative infrastructure.

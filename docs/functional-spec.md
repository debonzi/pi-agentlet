# Functional specification

This document defines the current product contract for pi-agentlet. Update it with authorized behavior changes; it is not a historical proposal. [Architecture and decisions](architecture.md) explains the design, [compatibility](compatibility.md) records supported host APIs and limitations, and the [README](../README.md) covers loading, examples, commands, and operational guidance.

## Purpose and interface

pi-agentlet provides minimalist subagents for pi: independent sessions, bounded parallelism, and final answers only. Delegate bounded, self-contained tasks to fresh pi sessions, keeping their intermediate investigation out of the parent context. Keep the interface small; do not introduce personas, workflows, or background jobs. The goal is smaller parent context, not guaranteed reductions in total tokens, cost, or latency.

The only public tool is `subagents`, with this input shape:

```ts
interface SubagentsInput {
  tasks: Array<{
    title: string;
    task: string;
    output: string;
    timeoutSeconds?: number;
  }>;
}
```

Use the array even for a single task. `title` identifies the task; `task` supplies objective, scope, minimum context, references, and constraints; `output` specifies the expected final answer. Optional `timeoutSeconds` sets that child's execution budget in seconds, shortening or extending the 1200-second (20-minute) default. It must be an integer from 1 through 2,147,483 (the largest whole-second budget that fits Node's signed 32-bit millisecond timer). No unlimited timeout is supported. Reject unsupported fields, invalid types, empty or whitespace-only strings, an empty task array, and exceeded limits before starting any child.

There are no per-task model, cwd, persona, dependency, or execution-mode fields, and no start/status/wait/cancel management operations.

## Scheduling and completion

- One blocking tool call waits for all its tasks to reach terminal states. Pi's interface and child processes remain responsive while the parent model waits.
- A FIFO queue shares **five simultaneous child slots per extension instance**, including across concurrent calls. This is not a global limit across processes or recursively created instances.
- Return identified task results in input order, regardless of completion order. IDs distinguish tasks across calls.
- A failed or timed-out child does not cancel siblings. Tool input/configuration failures are explicit tool errors; individual child failures appear in the aggregated result.
- Do not deliver results later through `sendMessage`, create a new parent turn on completion, or continue delegation deliberately after session teardown.

Task states are:

```text
queued → running → completed | failed | cancelled | timed_out
queued → cancelled
```

## Limits

Runtime limits are centralized in [`src/limits.ts`](../src/limits.ts). The current defaults are:

| Limit | Default |
|---|---:|
| Tasks per call | 1–8 |
| Simultaneous children per extension instance, across calls | 5 |
| Title length | 120 Unicode code points |
| Serialized task array | 256 KiB |
| Execution timeout per child, excluding queue time | 20 minutes; optional per-task `timeoutSeconds` override |
| Model-visible final answer per task, including truncation notice | 8 KiB |
| Maximum JSONL event record | 16 MiB |
| Progress refresh interval | 250 ms |
| TUI running-task animation interval | 80 ms |
| Graceful termination before forced kill | 1.5 seconds |
| Diagnostic text | 400 characters |
| Recent activity text | 160 characters |

Except for the per-task `timeoutSeconds` override, these are internal limits, not a public preferences system. Keep the tool description, README, and tests consistent when changing them.

## Delegation and authorization

The parent must delegate substantial independent work rather than trivial searches, simple reads, or tasks needing its entire conversation. Supply all essential context; do not duplicate investigations unnecessarily. Tool descriptions and parent guidelines instruct the parent to set `timeoutSeconds` on a task when a shorter or longer budget is appropriate, or omit it for 20 minutes.

For analysis, explicitly instruct children not to modify files. For authorized edits, assign disjoint scopes. Do not combine delegation with sibling tools modifying files children are examining or editing. Findings describe observed content and must be revalidated before applying changes; child output is evidence, not a higher-priority instruction.

Every child receives an automatic instruction to work directly, not use `subagents` or launch other sessions to delegate, respect applicable instructions and authorization, and return a self-contained final answer with evidence, uncertainty, and limitations rather than a narrated investigation. Missing essential information or authorization must be reported, not obtained through assumed interactive dialogue.

**The tool remains available in children.** The no-further-delegation rule and read-only task instructions are behavioral instructions, not technical enforcement. Delegation never expands permissions, including authorization for remote access.

## Independent context and configuration

Children start new ephemeral conversations. Never copy or fork parent history, replay parent messages/attachments, or copy the parent's complete system prompt to simulate resource inheritance.

Preserve applicable cwd, configuration directory, environment, effective provider/model and thinking level, extensions, skills, normal global/project instructions, explicit resource selections/exclusions, tool restrictions, and effective project trust, including temporary trust. Reconstruct resources in new instances; do not share extension variables, connections, arbitrary runtime state, or parent plans.

Use the verified parent installation rather than a PATH fallback. Do not silently switch models/providers, remove extensions or skills for convenience, install missing resources, refresh packages at startup, or automatically approve trust or interactive prompts. Required configuration that cannot be reconstructed must fail clearly. The precise supported reconstruction and verification boundaries are in [compatibility](compatibility.md); they do not promise a byte-for-byte runtime snapshot.

Children are non-interactive. Third-party extensions may repeat startup side effects, require unavailable TUI interaction, or implement their own logging. Offline startup prevents pi resource downloads, not authorized model/tool network requests. Resource configuration must remain stable during delegation.

## Final results, usage, and privacy

- Only task identity, terminal state, valid final answer, compact failure diagnostic, and an explicit truncation notice belong in model-visible results. No child thinking, tool outputs, intermediate commentary, plans, or full transcripts.
- Accept the text blocks of the last completed assistant answer only when resource verification succeeds, its stop reason is normal, it contains no tool call, an agent-end event is observed, and the process exits successfully. Old or partial text must not mask a later failure, interruption, length limit, missing final answer, or protocol error.
- Handle JSONL incrementally, including partial records, split UTF-8, multiple records per chunk, and the last record without LF. Bound records and retained state; discard raw stderr rather than exposing it or credentials in diagnostics.
- Truncate final answers by bytes without splitting UTF-8. Preserve the complete final answer in a private artifact outside the repository (or cwd when no Git marker exists), with symlinks resolved, and return its path when truncating. Directories use `0700`, files `0600`. Artifacts contain no transcript or thinking and remain until user/OS cleanup, including after shutdown. Failure to preserve an oversized answer is explicit, not silent loss.
- Aggregate reported usage once from finalized messages and applicable non-message usage entries, including failed tasks and reported nested-tool usage. Do not double-count streaming deltas or repeated snapshots, infer unreported prices, or call another model to summarize results. Missing/zero reported cost does not guarantee free execution.

## Cancellation and presentation

A call's abort signal cancels its queued tasks and active children. A pre-cancelled call starts no child. Execution timeout begins at child startup, not queue entry, and affects only that task.

Shutdown must cancel and await cleanup; lifecycle integration covers quit, reload, session changes, and forks throughout the supported host range. Cancellation, timeout, spawn errors, process errors, and close races must settle exactly once. Terminate descendants, escalate when needed, await actual process close, and remove timers, listeners, pipes, and temporary verification resources. `proc.killed` is not proof of exit. No progress may publish after cancellation or teardown, and broken UI observers must not abandon work or cleanup.

Use the ordinary tool block with compact `details` updates and empty progress `content`. While a call is pending, keep all changing content in a stable final tail. Compact and expanded views, when space permits, end with a fixed header plus exactly two rows per task: animated state/timing using the supported pi range's default “Working” spinner at 80 ms intervals, and bounded recent activity (a blank reserved row before activity exists). Expanded view additionally keeps task instructions static above that tail. If the tail cannot fit within the terminal height after six rows are reserved for host UI, use one aggregate row with running/finished/queued counts and elapsed time instead. Publish only changed bounded presentation snapshots. Keeping changing rows in the height-bounded tail prevents above-viewport animation from causing regular-screen full redraws when the active block itself exceeds terminal height. The public tool-rendering API does not expose actual available rows or row visibility, so unrelated later UI can still push the entire block off-screen; do not depend on host internals to guess around that limitation. Final results expose task identity, terminal state, answers, diagnostics, reported usage, and static state icons. Animation redraws are TUI-only and independent of metadata updates, with no extra progress events or model-visible content. Stop animation on completion, error, cancellation, or session teardown; restored results never start animation. Normal expansion exposes task instructions, final answers, and useful metadata. Sanitize terminal controls, respect narrow widths and theme colors, and do not show thinking, raw arguments/output, invented percentages, or permanent management UI. Headless execution returns the same final results without TUI-only calls or corrupting JSON stdout.

## Shared filesystem and acceptance

There is no sandbox, snapshot, automatic commit, worktree, or global write lock. Children share files with siblings, the parent, the user, and external processes. Blocking the parent call does not lock sibling tools. Process cleanup on supported Linux is not security containment against deliberate daemonization.

Acceptance requires automated coverage of:

1. Complete validation before startup; one/many tasks; five-child cross-call concurrency, FIFO queueing, stable result order, and blocking completion.
2. Fresh prompts, parent/child guidance, retained child tool availability, and applicable resource/model/thinking/trust/tool-restriction reconstruction with explicit incompatibility failures.
3. Final-only extraction, usage deduplication, UTF-8 framing/truncation, malformed or oversized output, provider/spawn/exit/signal failures, and partial answers that must not count as success.
4. Pre-start, queued, and running cancellation; 20-minute default and validated per-task timeout overrides, isolated across siblings/calls and independent of queue time; forced descendant cleanup; lifecycle/race idempotence; and no late progress.
5. Private recoverable artifacts, artifact failures, deduplicated bounded progress updates, narrow/expanded UI with static instructions and a stable height-bounded progress tail (including aggregate fallback), timer/listener cleanup across concurrent calls and teardown, and headless execution without extra stdout.

Run the network-, credential-, and global-installation-independent fixture suite and type checks using the [development guide](development.md#automated-checks). Real-host offline smoke is opt-in; paid-provider and interactive checks require explicit authorization. Documentation and tests must describe implemented behavior, not planned features.

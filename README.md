# pi-agentlet

**Super simple subagents for [pi](https://pi.dev).**

Minimalist subagents for pi: independent sessions, bounded parallelism, and final answers only. No personas, workflows, or background jobs.

Let your main agent delegate a focused investigation without filling its conversation with every file read, search result, and intermediate thought. Each subagent starts a fresh session, does its task, and returns a final answer.

[Why pi-agentlet?](#why-pi-agentlet) · [Install](#install) · [Use it](#use-it) · [Limits and safety](#limits-and-safety) · [Development](#development)

## Why pi-agentlet?

pi-agentlet is for people who want **delegation, not an orchestration framework**.

- **One tool, three fields per task.** No agent definitions, role files, or workflow configuration to maintain.
- **Independent context.** Subagents do not receive the parent conversation. Their investigation stays out of it; only final answers and compact failure diagnostics come back.
- **Your existing pi setup.** Children use the parent's model and thinking level, working directory, and applicable extensions, skills, instructions, and tool restrictions. Unsupported configuration fails explicitly instead of silently falling back.
- **Bounded parallel work.** Up to five children run at once. The main agent waits for the results while pi's interface remains responsive.
- **No extra management interface.** Progress and results appear in the ordinary tool block. There is no background job registry or separate control panel.

It is a good fit for independent code reviews, test-coverage checks, and focused investigations whose intermediate work would otherwise crowd the main conversation. It is not intended for persistent agent teams, per-agent model routing, or multi-step pipelines. A simple file read or quick search usually does not need a subagent.

## Install

### Requirements

- **pi 0.86.1** from `@earendil-works/pi-coding-agent`, installed through Node/npm.
- **Node.js 24+** and **Linux**.
- A working pi model/provider configuration.

Compatibility is intentionally narrow: other pi versions are rejected until reviewed. Native binary installations are not integration-tested. See [compatibility notes](docs/compatibility.md) for SDK, wrapper, and extension limitations.

### From GitHub

```sh
pi install git:github.com/debonzi/pi-agentlet
```

Start a new pi session after installation. The tool is named **`subagents`**, not `agentlet`; you do not need to configure an agent registry or choose a separate model.

Installation is user-wide by default. To install only for the current project:

```sh
pi install -l git:github.com/debonzi/pi-agentlet
```

<details>
<summary>Try a local checkout, update, or uninstall</summary>

From a local checkout, load the extension for one session without registering an installation:

```sh
pi -e ./index.ts
```

Or register the checkout with `pi install /absolute/path/to/pi-agentlet`. Pi loads TypeScript directly; no build step is needed. Use the actual checkout path, and load only one copy of the extension. Avoid loading another extension that registers the same `subagents` tool.

Update or remove the GitHub installation:

```sh
pi update git:github.com/debonzi/pi-agentlet
pi remove git:github.com/debonzi/pi-agentlet
```

For a project-only installation, run removal with `-l` from that project. Reload or restart pi after updating. Removing the installation does not delete retained final-answer artifacts.

</details>

## Use it

Ask pi to delegate in ordinary language. For example, in a project with authentication code and tests:

```text
Use subagents for two independent reviews:
1. Review src/auth.ts for token expiry and renewal bugs.
2. Review tests/auth.test.ts for missing edge-case coverage.

Do not modify any files. Give each subagent the context it needs and ask
for up to five findings with file references, impact, and a suggested fix.
Then compare their final answers and summarize the priorities.
```

Replace the paths with files in your project. Pi supplies the tool arguments; you do not need to write JSON yourself.

### What happens

1. Pi sends self-contained tasks to `subagents`.
2. Each child opens a fresh pi session in the same working directory. Up to five run at once; additional tasks wait in a queue.
3. The tool block shows each task's state, elapsed time, and recent tool activity. The main agent waits, but the interface stays responsive.
4. The main agent receives final answers in the original task order, then continues your conversation. One child's failure does not discard the others' results.

Use pi's normal tool expansion to inspect the task instructions, final answers, and reported usage. **Escape** cancels the call's running and queued tasks. Closing or reloading the session also cancels and cleans up its children.

### Give each task enough context

Subagents **cannot see your conversation**. Include the goal, relevant paths, constraints, and expected output. Repeat any conversation-only instruction they need to follow.

For analysis, explicitly say **“Do not modify files.”** For edits, assign separate files or otherwise non-conflicting scopes. Do not ask multiple children—or other tools running alongside them—to change the same files. Treat findings as evidence and recheck references before applying fixes.

<details>
<summary>Tool arguments for advanced use</summary>

The only input is a `tasks` array. Every task has three required, non-empty strings:

| Field | Purpose |
|---|---|
| `title` | Short label for progress and results. |
| `task` | Objective, scope, context, references, and constraints. |
| `output` | Expected final-answer format and content. |

```json
{
  "tasks": [
    {
      "title": "Review authentication",
      "task": "Analyze src/auth.ts for token expiry and renewal bugs. Do not modify files.",
      "output": "Up to five concrete findings with file:line, impact, and suggested fix. State explicitly if none."
    },
    {
      "title": "Review test coverage",
      "task": "Compare tests/auth.test.ts against src/auth.ts. Identify important untested edge cases. Do not modify files.",
      "output": "Up to five gaps, ordered by importance, with a suggested test scenario for each."
    }
  ]
}
```

For one task, use the same array with one element. There are no per-task model, role, cwd, or workflow options.

</details>

## Limits and safety

| Limit | Default |
|---|---:|
| Tasks per call | 1–8 |
| Simultaneous children per extension instance, across calls | 5 |
| Execution time per child, excluding queue time | 10 minutes |
| Final answer returned per task | 8 KiB |

A timeout affects only that child. Failed, interrupted, or incomplete answers are reported as such rather than presented as successful results. See the [full limits and result contract](docs/functional-spec.md) for details.

**Long answers are preserved.** If a final answer exceeds 8 KiB, the returned text includes a truncation notice and a path to the complete answer in a private `pi-agentlet-result-*` directory outside the repository. Artifacts contain only final answers and remain until you delete them or the OS cleans temporary files. Save important results elsewhere and review them before sharing. Child transcripts are not persisted by pi-agentlet; third-party extensions may have their own logging.

**This is not a sandbox.** Children share your filesystem and inherit applicable tools, environment credentials, and project trust. Read-only directions are instructions, not access controls. Delegation does not grant extra permissions. Children are told not to delegate further, but `subagents` remains available to them; the concurrency limit is not a global recursion barrier.

**Smaller parent context does not mean lower cost.** Each child makes its own model requests. Reported usage is aggregated, but total tokens, cost, and latency may increase.

**Resources are reloaded, not cloned from memory.** Extension startup side effects can repeat. Extensions requiring a TUI or human confirmation may not work in children. Keep resource configuration unchanged during delegation. pi-agentlet does not automatically approve prompts, install missing resources, or silently switch models to make a task run. See [compatibility notes](docs/compatibility.md) if your setup is unsupported.

## Development

Want to inspect or contribute to the implementation?

- [Development guide](docs/development.md): local setup, tests, type checking, and offline/manual smoke checks.
- [Architecture and decisions](docs/architecture.md): module responsibilities and why the design stays small.
- [Functional specification](docs/functional-spec.md): the maintained behavior contract and acceptance criteria.
- [Contributor instructions](AGENTS.md): repository rules.

For bugs or feature proposals, [open an issue](https://github.com/debonzi/pi-agentlet/issues). Include your pi and Node versions, OS, a minimal reproduction, and relevant extension configuration—without credentials or private transcripts.

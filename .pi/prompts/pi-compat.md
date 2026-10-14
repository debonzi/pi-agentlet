---
description: Validate compatibility with the current pi installation and apply minimal fixes
argument-hint: "[additional instructions, including an optional support cutoff]"
---

Review pi-agentlet compatibility with the installed pi host running this session.

Additional user instructions:
$ARGUMENTS

This invocation authorizes narrowly scoped repository changes needed for
compatibility: implementation, regression tests, validation scripts, and
supported-version documentation. It does not authorize product redesign,
software installation, global configuration changes, commits, or publishing.

Do not create a Git commit after applying adjustments. Leave all changes
uncommitted for the user to review.

## 1. Establish the target and scope

Read AGENTS.md, README.md, docs/functional-spec.md, docs/architecture.md,
docs/compatibility.md, docs/development.md, and package.json.

Inspect git status and preserve existing user changes. Do not reset, overwrite,
or incorporate unrelated work.

Identify the exact version, package location, and executable of the pi host
running this session. This is the target release. Do not substitute another
installation found on PATH or the latest publicly available release.
If the active installation cannot be identified reliably, report the blocker
and ask for clarification rather than guessing.

Identify available local toolchains and distinguish declared support windows
from releases actually tested. Do not install or update software implicitly.

Preserve existing support unless the additional instructions explicitly request
a cutoff. If a cutoff is requested:

- Interpret "below X" as removing versions strictly lower than X.
- Trim existing support windows; do not fill unsupported gaps or automatically
  support every version at or above X.
- Treat the requested removal as authorized, without asking for it again.
- Update runtime gates, version-dependent branches, tests, smoke profiles, and
  documentation consistently.
- Clarify ambiguous instructions or a cutoff that excludes the target host.

## 2. Review upstream changes

Use official release notes, changelogs, versioned documentation, public types,
examples, and relevant implementations.

Compare the target with previously reviewed releases, including relevant
intervening releases. Before integration changes, read the relevant host
documentation completely and inspect the corresponding public types/examples:
extensions, lifecycle, JSON, CLI, SDK/resources, packages, settings, environment,
providers, MCP, virtual models, and TUI, as applicable.

Map relevant changes to repository modules and tests. Inspect:

- Tool registration, schemas, execution, progress, rendering, and usage.
- CLI layouts/options, stdin, ephemeral sessions, and offline startup.
- JSONL framing, authoritative final events, stop reasons, and usage accounting.
- Model/thinking, resources, tool-selection flags, and temporary project trust.
- MCP startup and non-tool configuration verification.
- Cancellation, lifecycle transitions, and descendant cleanup.
- Headless execution and regular/fullscreen TUI behavior.

Do not treat changelog silence, compilation, or fixture tests alone as proof of
real-host compatibility.

## 3. Apply minimal fixes

Summarize concrete findings and intended changes before editing.
Proceed with compatibility fixes that preserve the approved product contract.

Ask for approval if an upstream blocker requires changing that contract,
expanding product scope, or removing support not covered by the requested cutoff.

Preserve bounded blocking delegation, independent sessions, final-only results,
privacy, explicit incompatibility failures, and cleanup guarantees.

Do not copy parent history, silently fall back to another model, remove resources
for convenience, approve trust automatically, compare child tool catalogs, or
technically disable subagents in children.

Add regression tests for discovered incompatibilities. Adapt smoke fixtures when
necessary without weakening assertions or skipping failing behavior.

Inspect version-dependent branches throughout implementation, tests, and smoke
scripts. Updating a version gate is not itself a compatibility fix or proof.

## 4. Validate

Follow docs/development.md. Reuse existing toolchains with
PI_AGENTLET_TYPESCRIPT and PI_AGENTLET_HOST when necessary.

Run and record:

- npm test
- npm run typecheck
- npm run check
- PI_AGENTLET_CLI=<verified-target-cli> node scripts/smoke.mjs

Run the real-host smoke against both shipped CLI layouts when applicable.
Use isolated configuration, deterministic offline providers, and local fixtures.
Do not load normal user resources, contact remote MCP services, or invoke paid
providers.

If the target is initially rejected, a provisional repository gate change may
be needed to run the smoke. Do not leave the target declared supported when
required validation fails or is blocked.

Revalidate available representative hosts from retained support windows when
shared integration changes could affect them. Report unavailable hosts as gaps,
not as tested releases.

When TUI integration changes, validate using an isolated offline PTY setup if
available; otherwise mark interactive validation as pending. Headless smoke
does not establish interactive compatibility.

Inspect the final diff for weakened assertions, unrelated changes, sensitive
output, and inconsistent support declarations.

## 5. Maintain evidence and report

Keep implementation, tests, README.md, compatibility notes, architecture, and
other affected contracts consistent. Preserve "*" host peer dependencies.

Choose conservative support boundaries. Separate exact tested releases from
broader reviewed windows. Do not automatically admit future minor/major
releases or prereleases.

Record exact versions, entry points, commands, outcomes, and limitations.
If required validation is incomplete, report "not yet validated" instead of
declaring support.

Return a concise report in Portuguese with:

1. Target host version and installation.
2. Verdict: compatible, compatible after fixes, incompatible, or validation blocked.
3. Relevant upstream changes and evidence.
4. Changed files and rationale.
5. Validation matrix and coverage gaps.
6. Previous and resulting support ranges, including any requested cutoff.
7. Remaining risks or approvals needed.

Do not claim successful checks that were not run or universal compatibility.
Do not commit the adjustments; leave the final diff for user review.

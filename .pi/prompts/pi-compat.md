---
description: Test the current pi installation, record compatibility evidence, and fix concrete breakage
argument-hint: "[additional instructions, including an optional minimum-version change]"
---

Review pi-agentlet compatibility with the installed pi host running this session.

Additional user instructions:
$ARGUMENTS

This invocation authorizes narrowly scoped repository changes needed for
compatibility: implementation, regression tests, validation scripts, and
compatibility documentation. It does not authorize product redesign,
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

Identify available local toolchains and the latest stable release listed by
upstream. Report it separately if it differs from the installed target; do not
install or update software implicitly. The latest published version, the version
under test, and the most recent validated version may all differ.

Preserve the existing minimum stable version and prerelease policy unless the
user explicitly requests a change. Interpret "below X" as strictly lower than X;
clarify ambiguous requests or a requested minimum that excludes the target.
Keep the implementation, tests, and docs consistent if the minimum changes.
Never use the latest tested version as an upper bound in the extension,
validation scripts, or package metadata.

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
expanding product scope, or raising the minimum version without an explicit request.

Preserve bounded blocking delegation, independent sessions, final-only results,
privacy, explicit incompatibility failures, and cleanup guarantees.

Do not copy parent history, silently fall back to another model, remove resources
for convenience, approve trust automatically, compare child tool catalogs, or
technically disable subagents in children.

Add regression tests for discovered incompatibilities. Adapt smoke fixtures when
necessary without weakening assertions or skipping failing behavior.

Fix concrete API or behavior incompatibilities, not version numbers. Check that
implementation, tests, and smoke scripts do not block stable releases solely
because they are newer than the latest tested release.

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

Revalidate previously tested local hosts when shared integration changes could
affect them. Report unavailable hosts as gaps, not as tested releases.

When TUI integration changes, validate using an isolated offline PTY setup if
available; otherwise mark interactive validation as pending. Headless smoke
does not establish interactive compatibility.

Inspect the final diff for weakened assertions, unrelated changes, sensitive
output, and inconsistent compatibility claims.

## 5. Maintain evidence and report

Keep implementation, tests, README.md, compatibility notes, architecture, and
other affected contracts consistent. Preserve "*" host peer dependencies.

Update the most recent tested version in README.md and docs/compatibility.md
only when a newer stable target passes the required real-host checks. Record
exact versions, entry points, commands, outcomes, and limitations. Do not imply
that intervening releases were all tested. If validation fails or is incomplete,
record the failure or gap and leave the latest successful version unchanged.
Do not add a version ceiling in response to a failed or blocked check.

Return a concise report in Portuguese with:

1. Target host version and installation.
2. Verdict: compatible, compatible after fixes, incompatible, or validation blocked.
3. Relevant upstream changes and evidence.
4. Changed files and rationale.
5. Validation matrix and coverage gaps.
6. Latest published stable version and most recent successfully tested version, plus any explicitly requested minimum-version change.
7. Remaining risks or approvals needed.

Do not claim successful checks that were not run or universal compatibility.
Do not commit the adjustments; leave the final diff for user review.

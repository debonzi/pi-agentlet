# Development guide

For an introduction, installation, and everyday use, start with the [README](../README.md). This guide covers working on pi-agentlet itself. Read the [contributor instructions](../AGENTS.md), [functional specification](functional-spec.md), and [architecture decisions](architecture.md) before changing behavior.

## Local loading

From the checkout:

```sh
pi -e ./index.ts
```

The package manifest points to the root `index.ts`, which re-exports `src/index.ts`. Load only one entry point; remove any old explicit `src/index.ts` selection when switching to the package. Pi loads TypeScript directly, so there is no build step.

Alternatively, register the local package with `pi install /absolute/path/to/pi-agentlet`. Local installs reference the checkout without copying it. Reload or restart pi after changes; reinstalling is unnecessary. If you move the checkout, update its configured installation path separately. Pi's compact startup label follows the checkout directory name, not `package.json`'s name.

Host packages are `*` peer dependencies, not bundled runtimes. Do not install dependencies, update pi, or invoke a paid provider implicitly while working on the project.

## Automated checks

The default suite requires Node.js 24+ and uses fixture subprocesses and host mocks. It requires no credentials, network, global pi installation, or paid models.

```sh
npm test
npm run typecheck
npm run check
```

Type checking requires existing TypeScript, Node types, and pi peer dependencies. To reuse an existing toolchain without changing local or global dependencies:

```sh
PI_AGENTLET_TYPESCRIPT=/absolute/path/to/typescript/lib/typescript.js \
PI_AGENTLET_HOST=/absolute/path/to/@earendil-works/pi-coding-agent \
  npm run typecheck
```

Set the same variables when running `npm run check` without local dependencies. The host toolchain resolver accepts nested and hoisted peer dependencies, including the managed installer's flat `node_modules` layout. See the [acceptance checklist](functional-spec.md#shared-filesystem-and-acceptance) for required regression coverage.

## Real-pi offline smoke

An opt-in integration smoke uses an isolated temporary configuration and a deterministic in-process fake provider. On the validated pi 1.2.0 and 1.3.0 releases it also uses file-backed callable tools and a local stdio MCP fixture with no external dependencies. It makes no network or paid-model calls and deletes its fixture configuration afterward:

```sh
PI_AGENTLET_CLI=/absolute/path/to/pi-coding-agent/dist/bundle/cli.js \
  node scripts/smoke.mjs
```

The shipped `dist/cli.js` entry point is also supported. With an allowed stable pi host (`>=1.2.0 <1.4.0`; unvalidated stable patches are admitted by explicit policy) on Node 24+ and Linux (exact releases 1.2.0 and 1.3.0 validated), the smoke exercises a parent delegation to three children, independent contexts, normal child tool loading without disabling `subagents`, the explicit no-further-delegation instruction, inherited CLI tool exclusions, non-tool configuration verification, timeout isolation, and valid JSON stdout. All 13 profiles run unconditionally after the version gate: explicit physical provider/model/thinking selection with colliding authenticated providers and a literal model ID containing provider/thinking syntax, explicit `builtin:` selections with discovery disabled, inactive callable tools through real codemode, nested usage, acceptance of child-only tools and differing schemas/exposure/metadata, virtual-model rejection, local MCP startup/cleanup, `--no-mcp` with a configured server, additive CLI tool selections, custom-message-triggered starts, length-limited responses, and abort at settlement. The MCP/cancellation profiles first warm the parent's MCP catalog and then create fresh children with delayed MCP initialization, including shutdown cancellation of five running tasks and one queued task. The smoke rejects hosts outside the supported ranges rather than skipping version-specific coverage. It does not validate interactive behavior or a paid provider. See [compatibility evidence](compatibility.md#validation).

## Isolated offline PTY smoke

With an existing Python 3 standard library, Node 24+, and Linux PTY support:

```sh
PI_AGENTLET_CLI=/absolute/path/to/pi-coding-agent/dist/bundle/cli.js \
  python3 scripts/smoke-pty.py
```

Repeat with `dist/cli.js` to cover the unbundled layout. The script uses temporary HOME/config/project directories, the offline provider, and only the local stdio MCP fixture. It checks regular/fullscreen completion, normal tool expansion, a 48-column/10-row resize with aggregate progress, Escape with five running children and one queued task, non-aborted/aborted settlement, reload, new session, and orderly quit. The parent's own MCP connection correctly remains alive after cancelling delegated tasks; all fixture processes must be gone after quit. Lifecycle logs contain only PID/event/reason/abort metadata and are deleted with the fixture directory. This is behavioral PTY evidence, not a pixel-perfect rendering, scrollback, mouse, or real-terminal protocol test.

## Manual interactive smoke

Run only with authorization to use the configured provider and resources:

1. Start `pi -e ./index.ts` with the desired model and thinking level.
2. Ask it to run two independent read-only reviews against real local files, as in the [README example](../README.md#use-it).
3. Check that the ordinary tool block updates while the parent waits: compact and expanded views have stable per-task state/activity rows when they fit, while expanded view also shows static task instructions; both use the aggregate fallback in a short terminal. Verify narrow widths, then make the expanded block taller than the terminal and confirm animation does not flicker, clear scrollback, or prevent scroll-up. Only final findings should return, and animation should stop on completion or cancellation without changing the editor/footer.
4. Start six bounded tasks; verify that five run while one queues. Press Escape; verify that running and queued tasks cancel.
5. Repeat with explicit local `-e`, `--skill`, tool exclusions, and temporary project trust. Check inherited CLI selection policy without catalog equivalence enforcement, then try unreconstructible non-tool configuration and verify an explicit failure rather than fallback. On pi 1.2.0 and 1.3.0, exercise both the default fullscreen TUI and `--tui-mode regular`.
6. After a run, exercise `/reload`, `/new`, `/resume`, `/fork`, and quit; verify that no child processes or progress callbacks remain.

## Maintaining the documentation

Keep the README focused on prospective users: purpose, differentiators, installation, examples, and practical limitations. Keep internal contracts in the functional specification, design rationale in the architecture document, and version-specific API evidence in compatibility notes.

When changing defaults in `src/limits.ts`, update affected tool descriptions, tests, and user-facing documentation. Before changing host integration, read the relevant documentation in full and inspect public types/examples for the supported pi range; compatibility is deliberately bounded and must not be expanded without review.

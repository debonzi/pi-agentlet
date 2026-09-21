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

Set the same variables when running `npm run check` without local dependencies. See the [acceptance checklist](functional-spec.md#shared-filesystem-and-acceptance) for required regression coverage.

## Real-pi offline smoke

An opt-in integration smoke uses an isolated temporary configuration and a deterministic in-process fake provider. It makes no network or paid-model calls and deletes its fixture configuration afterward:

```sh
PI_AGENTLET_CLI=/absolute/path/to/pi-coding-agent/dist/bundle/cli.js \
  node scripts/smoke.mjs
```

The shipped `dist/cli.js` entry point is also supported. The smoke exercises a parent delegation to three children, independent contexts, retained child tool availability, resource verification, and valid JSON stdout. It was tested with pi 0.86.1 and Node 24.16.0 on Linux. It does not validate interactive behavior or a paid provider. See [compatibility evidence](compatibility.md#validation).

## Manual interactive smoke

Run only with authorization to use the configured provider and resources:

1. Start `pi -e ./index.ts` with the desired model and thinking level.
2. Ask it to run two independent read-only reviews against real local files, as in the [README example](../README.md#use-it).
3. Check that the ordinary tool block updates while the parent waits: running tasks have pi's default Working spinner, queued/finished tasks stay static, expansion works at narrow terminal widths, and only final findings return. Animation should stop on completion or cancellation without changing the editor/footer.
4. Start six bounded tasks; verify that five run while one queues. Press Escape; verify that running and queued tasks cancel.
5. Repeat with explicit local `-e`, `--skill`, tool exclusions, and temporary project trust. Check inherited resources, then try an unreconstructible configuration and verify an explicit failure rather than fallback.
6. After a run, exercise `/reload`, `/new`, `/resume`, `/fork`, and quit; verify that no child processes or progress callbacks remain.

## Maintaining the documentation

Keep the README focused on prospective users: purpose, differentiators, installation, examples, and practical limitations. Keep internal contracts in the functional specification, design rationale in the architecture document, and version-specific API evidence in compatibility notes.

When changing defaults in `src/limits.ts`, update affected tool descriptions, tests, and user-facing documentation. Before changing host integration, read the installed pi version's relevant documentation in full and inspect its public types/examples; compatibility is deliberately pinned to the reviewed version.

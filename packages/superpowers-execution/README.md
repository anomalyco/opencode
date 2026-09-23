# @bearmanser/opencode-superpowers-execution

Local companion plugin for the Superpowers Execution UI. It stores structured Superpowers
execution reports and serves read-only snapshots over the `superpowers.execution.v1` RPC.

The package name is a proposed local package name. It is not published on npm and this project
does not ship a private installer, signing, branding, or automatic update channel.

## Compatibility

| Item | Requirement |
|---|---|
| Host | OpenCode **2.0.11** only. Other 2.x releases are untested and are not a compatibility promise. |
| Runtime | Bun 1.4.2 (the repository-pinned version). |
| Package | `@bearmanser/opencode-superpowers-execution` `0.1.0`. |
| Frontend | Requires the matching `execution-ui` fork app for the Execution tab. The stock app without this feature can still call the RPC directly. |

## Installations (do these separately)

There are **two independent installations**. The frontend feature is already in this fork; the
companion plugin is configured on the existing server only when you choose to enable tracking.
Neither installation is applied to your config automatically by this repository.

### 1. Frontend feature (already part of the fork)

Run the fork's app/TUI; the Execution tab is part of that build. Nothing in this package has to be
installed to use observer mode. See `docs/superpowers/verification/execution-ui/feature-guide.md`
for the user-facing guide.

### 2. Companion plugin on the existing server (opt in)

1. Create the standalone local package directory. This builds the package and copies it, with its
   exact-version runtime dependencies, into a portable directory outside the checkout:

   ```bash
   cd packages/superpowers-execution
   bun run package:stage /opt/opencode/superpowers-execution
   ```

   The command writes the resolved manifest (no `workspace:`/`catalog:` ranges), the built
   `index.js`/`dist/`, the `skills/` assets, the `LICENSE`, and a real `node_modules/` containing
   `@opencode/plugin` 2.0.11, `@opencode/schema` 2.0.11, and `zod` 4.1.8. It fails if any dependency
   resolves back inside this repository or is a symlink, so the printed directory is genuinely
   portable and can be copied or moved.

   The output path is resolved to its physical path and validated before anything is created: the
   repository root, the package source directory, any path inside the repository (including through
   a symlinked ancestor alias), the filesystem root, and the home directory root are rejected. Every
   existing output path, including an empty directory or an output from an earlier run, is rejected
   with instructions to remove it manually. The package is built in a unique working directory under
   the physically resolved OS temporary directory and transferred into a newly claimed output directory.
   Only that working directory is recursively removed, after its filesystem identity is rechecked. A
   failed output transfer is left in place for manual inspection and removal.

2. Merge **one entry** into the existing `plugins` array of your server config. This is an entry to
   merge, not a replacement for your full config; keep your existing Superpowers and other plugin
   entries.

   ```jsonc
   {
     // ...keep your existing configuration...
     "plugins": [
       // ...keep your existing plugin entries...
       "/opt/opencode/superpowers-execution"
     ]
   }
   ```

   Point at the **staged standalone package directory** produced in step 1 (the directory
   containing `package.json`, `index.js`, `dist/`, `skills/`, and `node_modules/`). Do not point at
   a guessed bare-file path, do not point at the workspace source directory (its manifest still
   contains `workspace:*`/`catalog:` ranges and its dependencies resolve from this checkout), and do
   not use the unpublished npm name.

3. Restart only the server you own, on your own schedule. This repository never restarts, replaces,
   or upgrades your running service.

Importing the contract alone does not install the plugin. With no plugin configured, the UI stays
in observer mode.

### Required global controller policy

After the companion is built, deployed, and verified, add this rule to your installation-wide
OpenCode controller instructions (`~/.config/opencode/AGENTS.md`). Keep unrelated instructions;
do not edit cached Superpowers skill files. The rule applies even when reporting tools are missing:
subsequent approved-plan executions pause until reporting can register a run. It does not govern
the bootstrap development of the companion itself.

```text
Before implementation or implementer dispatch for an approved Superpowers plan, the root controller must read the approved plan, compute its plan hash, load superpowers-execution-reporting, call execution_read, then reconcile a matching plan run or persist execution_report run.start with the complete graph, gates, and final review. A run for a different plan is not a match. Do not begin plan work until registration succeeds. If the reporting skill, tools, or storage are unavailable, pause implementation and new dispatch, state the blocker, and allow only read-only diagnosis. If workers are already running, request a cooperative safe stop; do not claim they were automatically paused. After recovery, execution_read and reconcile before resuming. Never substitute a local ledger, badge, or capabilities response for persisted registration.
```

This is a controller-workflow requirement. It does not add a host-side block to native tools, and
the plugin does not infer approval or create a run from session text. A source build alone does not
change the installed server: verify the staged package in a disposable host and separately confirm
the controller can see the deployed reporting tools before activating the policy.

## Rollback to observer mode

Remove the package directory from the server `plugins` array (or remove/uninstall the copied
directory). Restart the server you own. The Execution UI returns to observer mode.

- Native sessions are untouched.
- Ledger data is retained under the server's plugin storage unless you separately delete it.
- Removing the plugin does not delete or migrate any native session.

## Build and verification

```bash
bun run build                        # dist/plugin.js, dist/contract.js, dist/*.d.ts
bun run package:stage <outDir>       # portable standalone directory (resolved manifest + real deps)
bun test                             # unit tests
bun run typecheck                    # tsgo --noEmit
bun run package:smoke                # stage, browser-import the contract, drive the built plugin
bun run package:host-smoke           # additionally load the staged directory in a disposable 2.0.11 host (Linux)
```

`package:stage` writes a self-contained package directory: the resolved manifest, built entrypoints
and declarations, the reporting skill, the upstream `LICENSE`, and real `node_modules` copies of
`@opencode/plugin` 2.0.11, `@opencode/schema` 2.0.11, and `zod` 4.1.8. It verifies each dependency's
real path is inside the staged directory and outside this repository, so the directory can be moved
or copied without breaking.

`package:smoke` stages the same way (outside the monorepo) and then asserts the staged manifest has
no `workspace:`/`catalog:` ranges, imports the staged `./contract` in a real browser context, and
drives install, report, `getRun`, unload, reload, and stored-state recovery against the built
plugin. `package:host-smoke` additionally starts an explicitly selected disposable OpenCode 2.0.11
server under its own XDG directories and loopback port, calls `capabilities`/`listRuns`, and repeats
after an isolated restart. It never touches the user's service.

## Layout

| Path | Purpose |
|---|---|
| `index.js` | Package root entrypoint; re-exports the built plugin from `dist/plugin.js`. |
| `src/` | Plugin, contract, schema, reducer, repository, principal, reporting sources. |
| `dist/` | Built JS entrypoints and declarations (generated by `bun run build`). |
| `skills/superpowers-execution-reporting/SKILL.md` | The controller reporting skill. The built plugin reads it at the dist-relative `../skills` layout, so keep `dist/` and `skills/` together. |
| `script/build.ts` | Build entrypoint (`dist/plugin.js`, `dist/contract.js`, declarations). |
| `script/stage.ts` | `package:stage`: builds, resolves the manifest, installs exact-version runtime dependencies into the staged tree, and verifies self-containment. |
| `script/package-smoke.ts` | Staged browser-contract and disposable-host smoke helpers. |

## License

MIT. The upstream `LICENSE` notice is preserved in the built package.

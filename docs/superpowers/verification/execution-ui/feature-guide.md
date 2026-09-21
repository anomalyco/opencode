# Superpowers Execution feature guide

Task: T20. Spec: `docs/superpowers/specs/2026-09-20-superpowers-execution-ui-design.md` §3, §6.1, §12, §16.
Companion package README: `packages/superpowers-execution/README.md`.

This guide covers the two independent installations. The **frontend feature** is already part of
this fork. The **companion plugin** is configured on your existing server only when you choose to
enable structured tracking. This repository never writes to your production config, and this
project does not deliver a private installer, signing, branding, or an auto-update channel.

## 1. Frontend feature (already in this fork)

The Execution feature ships with the app in this worktree. No companion installation is needed for
observer mode.

- Open a session, then use the session header Execution shortcut or add an Execution tab from the
  side panel's add-tab control.
- Views: **Map** (task dependency graph), **Agents** (controller plus descendants and native
  child-session navigation), **Tasks** (accessible list alternative with search and filters), and
  **Activity** (durable report events; a truncated window is labelled).
- The tab defaults to Agents in observer mode and Map when a registered run exists. It opens on
  explicit user action and does not steal focus or replace your active file.
- The compact header control shows, in priority order, a connection/staleness warning, pending user
  input, a failed/blocked task notice, the reported verification count, or the active-agent count.
- Expanded and narrow (mobile) presentations share the same model and selection. Pending
  permissions and questions remain the session's own controls; the dashboard does not auto-approve,
  dispatch, change models, or stop work.

Run it live from this worktree with `bun run dev:live` (see the repository guide). The stock app
without this feature can still call the read RPC directly once the companion is installed.

## 2. Companion plugin on the existing server (opt in)

Install only if you want a real plan map, honest task counts, and durable evidence. Without it the
UI stays in observer mode and shows no fabricated percentage.

1. Create the standalone local package directory (builds, resolves the manifest, and copies the
   exact-version runtime dependencies into a portable directory outside the checkout):

   ```bash
   cd packages/superpowers-execution
   bun run package:stage /opt/opencode/superpowers-execution
   ```

   The command prints the staged directory and its resolved dependencies. It refuses to produce a
   directory whose dependencies resolve back into the checkout or are symlinks.

2. Merge **one entry** into the `plugins` array of your server config. It is an entry to merge, not
   a replacement for your full config; keep your existing Superpowers and other plugin entries.

   ```jsonc
   {
     // ...keep your existing configuration...
     "plugins": [
       // ...keep your existing plugin entries...
       "/opt/opencode/superpowers-execution"
     ]
   }
   ```

3. Restart only the server you own. This repository never restarts, replaces, or upgrades your
   running service.

Point at the **staged standalone package directory** (containing `package.json`, `index.js`,
`dist/`, `skills/`, and `node_modules/`). Do not point at a guessed bare-file path, do not point at
the workspace source directory (its manifest still has `workspace:*`/`catalog:` ranges and resolves
dependencies from the checkout), and do not use the unpublished npm name. The built plugin reads the
reporting skill at the dist-relative `../skills/superpowers-execution-reporting/SKILL.md` layout, so
keep `dist/` and `skills/` together.

Importing the shared contract alone does not install the plugin.

### Compatibility (exact)

| Item | Requirement |
|---|---|
| Host | OpenCode **2.0.11** (the inspected commit `c555559ac1`). Other 2.x releases are untested; this project does not promise broad 2.x compatibility. |
| Runtime | Bun **1.4.2** (repository-pinned). |
| Contract | RPC id `superpowers.execution.v1`; read-only methods `capabilities`, `listRuns`, `getRun`, `getSummaries`. |
| Package | `@bearmanser/opencode-superpowers-execution` `0.1.0`, a local-only package name. |

## 3. Rollback to observer mode

Remove the package directory from the server `plugins` array (or delete the copied directory) and
restart only the server you own.

- Native sessions are untouched.
- Ledger data is retained under the server's plugin storage unless you separately ask for it to be
  deleted.
- Removing the plugin stops reporting; it does not delete or migrate native sessions.
- The UI returns to observer mode.

## 4. What is not included

No signed installer, branding, auto-update feed, separate dashboard server, agent dispatch, model
routing, pause/resume/kill controls, task time estimates, cross-server orchestration, or automatic
import from historical prose.

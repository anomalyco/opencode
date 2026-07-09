# Worktree CLI and TUI

## Why it doesn't exist yet

The backend is complete and tested. The `Worktree.Service` (create, list, remove,
reset), the HTTP API under `/experimental/worktree`, the control-plane
`WorktreeAdapter`, and the `worktree.ready` / `worktree.failed` event schema are
all production-quality and ship today.

The user-facing layer was never built because the workspace concept was gated
behind `OPENCODE_EXPERIMENTAL_WORKSPACES` while the GUI app (`packages/app`)
was the primary harness. The TUI received only partial wiring:
- `DialogWorkspaceList` can delete existing workspaces but cannot create one.
- `workspace.list` slash command is hidden unless the flag is set.
- `/workspace.set` exists in the prompt but requires an already-created workspace.
- There is no `opencode worktree` CLI subcommand at all.

This spec fills that gap without touching the flag, the backend, or the HTTP API.

---

## Goals

1. `opencode worktree` — a first-class CLI subcommand with `create`, `list`,
   `remove`, and `reset` sub-subcommands.
2. TUI — remove the `OPENCODE_EXPERIMENTAL_WORKSPACES` gate from `workspace.list`
   and add a **"New worktree"** action inside `DialogWorkspaceList` so users can
   create worktrees without the GUI.

Non-goals for this iteration:
- Auto-provisioning a worktree per session (separate design decision).
- An apply/merge-back flow (requires conflict-resolution UX).
- Changes to the HTTP API or backend service.

---

## Requirements

### R1 — CLI: `opencode worktree create`

```
opencode worktree create [--name <name>] [--start-command <cmd>]
```

- Calls `Worktree.Service.create({ name?, startCommand? })`.
- Waits for `worktree.ready` or `worktree.failed` via the event bus (uses the
  existing `GlobalBus` listener already available in `AppRuntime`).
- On success: prints the worktree directory path and branch name (if any) to
  stdout.
- On failure: prints the error message and exits non-zero.
- `--name` is optional; omitting it lets the service generate a slug.
- `--start-command` is optional; it is passed as `CreateInput.startCommand`.

### R2 — CLI: `opencode worktree list`

```
opencode worktree list [--format table|json]
```

- Calls `Worktree.Service.list()`.
- Default format is `table`: columns `Name`, `Branch`, `Directory`.
- `--format json` prints the raw array as JSON.
- Exits 0 even when the list is empty (prints nothing in table mode, `[]` in
  JSON mode).

### R3 — CLI: `opencode worktree remove`

```
opencode worktree remove <directory>
```

- Takes a positional directory path.
- Calls `Worktree.Service.remove({ directory })`.
- Prints a confirmation message on success.
- On `NotGitError` or `RemoveFailedError`: prints the message and exits non-zero.

### R4 — CLI: `opencode worktree reset`

```
opencode worktree reset <directory>
```

- Takes a positional directory path.
- Calls `Worktree.Service.reset({ directory })`.
- Prints a confirmation message on success.
- Errors are surfaced the same way as `remove`.

### R5 — TUI: ungated `workspace.list` command

- Remove `hidden: !Flag.OPENCODE_EXPERIMENTAL_WORKSPACES` from the
  `workspace.list` command in `packages/tui/src/app.tsx`.
- The command and its dialog are stable enough to ship without the flag.

### R6 — TUI: "New worktree" action inside `DialogWorkspaceList`

- Add a "new worktree" option at the top of `DialogWorkspaceList` (analogous to
  how `DialogWorkspaceSelect` lists adapters).
- Selecting it calls `sdk.client.experimental.workspace.create({ type:
  "worktree", branch: null })` (the same path the GUI app uses).
- Shows an inline "Creating…" state while the worktree boots.
- On `worktree.ready`: refreshes the workspace list; shows a toast.
- On `worktree.failed`: shows a toast with the error message.
- The option label is **"New worktree"**; description is "Create a git worktree".

### R7 — TUI: `/workspace.set` ungated

- Remove the `enabled: Flag.OPENCODE_EXPERIMENTAL_WORKSPACES` gate from the
  `/workspace.set` slash command in `packages/tui/src/component/prompt/index.tsx`
  (it is already wired to `workspace.open()` which calls `DialogWorkspaceSelect`).

---

## Implementation plan

### Step 1 — `packages/opencode/src/cli/cmd/worktree.ts` (new file)

Create a `WorktreeCommand` that nests four `effectCmd`-based sub-subcommands
following the same pattern as `SessionCommand` in `session.ts`.

Each subcommand:
- Uses `instance: true` (default) so `InstanceRef` is provided.
- Yields `Worktree.Service` directly.
- Uses `UI.println` / `UI.error` for output.

**`create` subcommand** waits for the async boot event. The service forks
`boot()` into the instance scope and emits `worktree.ready` or `worktree.failed`
via `GlobalBus`. The CLI implementation:

1. Call `Worktree.Service.create()` which returns `Info` immediately (after git
   worktree setup but before async bootstrap).
2. Use the existing `waitEvent()` utility from `@/control-plane/util` which wraps
   `GlobalBus.on("event", handler)` in `Effect.callback` with built-in timeout
   and abort-signal support. Filter events by the returned `info.directory` and
   payload type (`worktree.ready` or `worktree.failed`).
3. Set a 120-second timeout on the `waitEvent` call.
4. On success: print directory and branch.
5. On failure (`worktree.failed`): print error message and exit non-zero.
6. On timeout: print a warning that the worktree was created but bootstrap is
   still running (don't fail, since git worktree setup succeeded).

Event payload structure:
```ts
{
  directory: string,
  project: string,
  workspace?: string,
  payload: {
    type: "worktree.ready" | "worktree.failed",
    properties: { name: string, branch?: string } | { message: string }
  }
}
```

**`list` subcommand** — `Worktree.Service.list()` returns an `Effect.Effect<(...)[], Error>`.
Yield it in the handler (same pattern as `SessionListCommand` which does
`yield* Session.Service.use((svc) => svc.list(...))`). The resolved value is a
plain array.

**`remove` / `reset` subcommands** — both return `Effect.Effect<boolean, Error>`.
Yield them in the handler. The resolved value is a plain `boolean`.

### Step 2 — Register `WorktreeCommand` in `packages/opencode/src/index.ts`

Add `.command(WorktreeCommand)` alongside `SessionCommand`.

### Step 3 — `DialogWorkspaceList` — add "New worktree" action

In `packages/tui/src/component/dialog-workspace-list.tsx`:

- Add a `creating` signal (boolean).
- Insert a synthetic option at the top of `options()`:
  ```ts
  {
    title: creating() ? "Creating worktree…" : "New worktree",
    value: { workspace: NEW_WORKTREE_SENTINEL },
    footer: "worktree",
  }
  ```
  where `NEW_WORKTREE_SENTINEL` is a local constant with a sentinel `id`.
- In `onSelect`: when the sentinel is detected:
  1. Call `sdk.client.experimental.workspace.create({ type: "worktree", branch: null })`
  2. Set `creating(true)`
  3. Poll `project.workspace.sync()` every 500ms for up to 120 seconds
  4. Check if the new workspace appears in the list (compare against pre-create list)
  5. On success: show success toast and clear creating state
  6. On timeout: show timeout toast
- Disable the sentinel option (no-op select) while `creating()` is true.

The polling approach is simpler than wiring SSE into the dialog and matches
existing TUI patterns.

### Step 4 — Ungate `workspace.list` in `app.tsx`

Remove `hidden: !Flag.OPENCODE_EXPERIMENTAL_WORKSPACES` from the
`workspace.list` command entry.

### Step 5 — Ungate `/workspace.set` in prompt `index.tsx`

Remove `enabled: Flag.OPENCODE_EXPERIMENTAL_WORKSPACES` from the
`workspace.set` slash command entry.

### Step 6 — Verify

```bash
# from packages/opencode
bun typecheck

# from packages/tui
bun typecheck

# worktree tests
bun test test/project/worktree.test.ts
bun test test/project/worktree-remove.test.ts
```

---

## File changes summary

| File | Change |
|------|--------|
| `packages/opencode/src/cli/cmd/worktree.ts` | **new** — CLI subcommand |
| `packages/opencode/src/index.ts` | register `WorktreeCommand` |
| `packages/tui/src/component/dialog-workspace-list.tsx` | add "New worktree" option |
| `packages/tui/src/app.tsx` | remove `OPENCODE_EXPERIMENTAL_WORKSPACES` gate from `workspace.list` |
| `packages/tui/src/component/prompt/index.tsx` | remove flag gate from `workspace.set` |

The backend, HTTP API, schema, and tests are untouched.

---

## Open questions

1. **Startup scripts in TUI**: `CreateInput.startCommand` is supported by the
   backend. For the first iteration the TUI "New worktree" action omits it
   (uses whatever the project's configured start command is). A follow-up could
   show a text input for an extra command.

2. **Auto-provision per session**: Cursor creates a worktree automatically when
   you start a session with the `Agents` mode. That requires a session-creation
   policy change and is out of scope here.

3. **Apply/merge-back**: No `/apply-worktree` equivalent is planned now. The
   user uses git outside opencode to merge the branch.

4. **Flag cleanup**: Once this ships and is stable, `OPENCODE_EXPERIMENTAL_WORKSPACES`
   can be removed from `flag.ts` and all remaining guards cleared. That is a
   separate clean-up PR.

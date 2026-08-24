## Why

The `opencode loop` CLI command (packages/opencode/src/cli/cmd/loop.ts) exists but is invisible from the TUI, where most sessions actually happen — the user expected `/loop` in the TUI and assumed the feature was lost. The CLI implementation also keeps its loop registry in-process only, so loops die with the terminal and cannot be listed, paused, or resumed from anywhere else.

## What Changes

- Extract the loop engine out of `cli/cmd/loop.ts` into a server-side Loop service with SDK/HTTP endpoints (create, list, pause, resume, cancel) and events, so loops survive any single client process and are visible to every client.
- New TUI slash command `/loop <prompt> [--interval <sec>] [--max <n>]` that starts a loop in the current project: ralph-style (iterate until `<promise>COMPLETE</promise>` or `--max`) by default, timed re-send with `--interval`.
- New TUI command `/loops` (palette: "Manage loops") opening a dialog that lists active loops with iteration count, last-run time, and pause/resume/cancel actions; each iteration's session is navigable from the dialog.
- Loop completion detection hardened beyond the promise token: an iteration that produces no output or no tool activity counts toward a no-progress limit that stops the loop and surfaces a notice, instead of burning iterations silently.
- `opencode loop` CLI becomes a thin client of the same service (list/pause/resume/cancel now work across processes). **BREAKING** only for the undocumented in-process behavior; command syntax is unchanged.

## Capabilities

### New Capabilities
- `loop-service`: server-side loop lifecycle (create/list/pause/resume/cancel, persistence across client processes, completion + no-progress detection).
- `tui-loop-command`: `/loop` and `/loops` in the TUI — start, observe, and control loops without leaving the session view.

### Modified Capabilities
<!-- none — CLI loop keeps its syntax; its backing store moves behind the service -->

## Non-Goals

- No cron/schedule syntax (intervals only; scheduling is a separate concern).
- No cross-project loop orchestration or fleet dispatch — one loop targets one project/session lineage.
- No persistence of loops across server restarts in this change (in-memory in the server is already a strict improvement; durable storage can follow).

## Impact

- New: `packages/opencode/src/loop/` (service), server routes, SDK v2 client methods, events.
- Modified: `packages/opencode/src/cli/cmd/loop.ts` (delegate to service), `packages/tui/src/app.tsx` (keymap layer commands `/loop`, `/loops`), new TUI dialog component for loop management.
- SDK consumers gain `loop.*` methods; no existing API surface changes.

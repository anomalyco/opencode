## Context

Current state: `opencode loop` (cli/cmd/loop.ts) creates a fresh SDK session per iteration, streams events until idle, and checks the output for `<promise>COMPLETE</promise>`. Loop state lives in a `Map` inside the CLI process — `loop list/pause/resume/cancel` only work from the process that started the loop, and the TUI has no visibility at all.

TUI command architecture (dev branch): imperative UI commands are registered in `packages/tui/src/app.tsx` via keymap layers (`name`, `slashName`, `run`); prompt-template commands come from the server (`packages/opencode/src/command/index.ts`) and are invoked via `session.command` with an `arguments` string. Slash input parsing already splits `/cmd rest-of-line` and passes the remainder as arguments (component/prompt/index.tsx).

Related evidence from the skein project (2026-07-02): completion detection that relies *only* on a promise token loops indefinitely when a model answers correctly in prose — a triage stage was re-dispatched 11× because the token never appeared. The loop service must not inherit that failure mode.

## Goals / Non-Goals

**Goals:**
- One loop engine, N clients: CLI and TUI drive the same server-side service.
- `/loop` starts a loop without leaving the TUI; `/loops` manages them.
- Loops are bounded and observable: max iterations, no-progress stop, visible status.

**Non-Goals:**
- Durable loop persistence across server restarts (follow-up).
- Cron-style scheduling, multi-project loops, agent-team semantics.

## Decisions

**D1 — Server-side Loop service, not a TUI-local reimplementation.**
Port the engine from cli/cmd/loop.ts into `packages/opencode/src/loop/` following the existing Effect service/layer pattern (see command/index.ts: `Layer.effect`, `LayerNode.make`). Alternative — reimplement the loop in the TUI process — rejected: it duplicates the engine and repeats the CLI's die-with-the-process flaw.

**D2 — `/loop` as a TUI keymap command with argument parsing, not a server prompt-template command.**
Server commands (`session.command`) expand to prompts for the LLM; `/loop` is imperative (start a background loop), so it belongs in the keymap layer in app.tsx alongside `/models` etc. The prompt component's existing slash path only dispatches server commands with arguments, so the `/loop` entry parses its argument string itself (`--interval`, `--max`, remainder = prompt). Empty prompt → open the `/loops` dialog instead of erroring.

**D3 — Iteration sessions are children of a loop parent session.**
Each iteration today creates an orphan session titled "loop". Instead, create one parent session per loop (title: `loop: <prompt-head>`), with each iteration as a child session, so the TUI session list stays navigable and an iteration's transcript is one click away from the `/loops` dialog.

**D4 — Completion = promise token OR explicit stop conditions; no-progress guard.**
An iteration completes the loop when output contains `<promise>COMPLETE</promise>`. Additionally the service tracks per-iteration signals (assistant output length, tool-call count). `noProgressLimit` (default 3) consecutive iterations with no tool calls and near-identical output stops the loop with status `stalled` and a toast/notification in the TUI. This is the skein lesson: never trust the token alone to terminate a loop.

**D5 — Events over polling.**
The service emits `loop.updated` events on the existing event bus; the `/loops` dialog and the session sidebar subscribe rather than poll. CLI `loop list` does a one-shot fetch.

## Risks / Trade-offs

- [In-memory service state lost on server restart] → acceptable for this change; loops report `startedAt` so clients can detect disappearance; durable store is a named follow-up.
- [Arg parsing in TUI drifts from CLI flags] → share a single `parseLoopArgs` helper in the loop package; both clients import it.
- [Near-identical-output heuristic misfires on legitimately repetitive tasks] → guard is configurable per loop (`--no-progress-limit 0` disables); default conservative (3).
- [Parent/child session semantics differ across SDK versions] → gate on the v2 SDK already used by loop.ts.

# Session start

Plan reliable lifecycle hooks and one-shot context carryover.

## Goal

Implement a server-side `session.start` plugin hook for `startup`, `resume`, and `compact`, with one-shot `additionalContext` injection into the next system prompt.

## Hook shape

```ts
"session.start"?: (
  input: {
    trigger: "startup" | "resume" | "compact"
    sessionID: string
  },
  output: {
    additionalContext: string[]
  }
) => Promise<void>
```

## Architecture

- Trigger only on the server, never from TUI route navigation.
- Add explicit `POST /session/:sessionID/resume`.
- Store pending one-shot context per session in persistent session storage.
- Inject pending context into the next system prompt, then clear it.
- Fail soft: plugin errors log and continue.

## Trigger points

- `startup`: after session creation succeeds.
- `resume`: explicit resume endpoint only.
- `compact`: after successful compaction.

## Storage

- Add `pending_context` to the session schema.
- Provide helpers to read, append, and clear it.

## Client wiring

- TUI session route calls resume API after sync.
- CLI `--continue` and `--session` call resume API before prompting.

## Consumption

- Read pending context before assistant generation.
- Append wrapped block to system prompt.
- Clear after one use.

## Test matrix

- Fresh session -> `startup` fires once, injects once.
- Resume via TUI -> `resume` fires, injects once.
- Resume via CLI -> `resume` fires, injects once.
- Compact -> `compact` fires, injects once.
- Plugin throw -> lifecycle continues.

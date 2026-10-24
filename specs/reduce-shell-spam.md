# Reduce shell output spam in chat

## Problem

When the agent runs shell commands, the full (often very long) command output is
echoed into the chat transcript, spamming the conversation and making progress
hard to follow.

## Desired behavior

- Do not dump the entire shell output into the chat by default.
- While working, show a short status indicator (e.g. `working`, `thinking`,
  `cooking`) instead of raw output.
- Show the final result / a concise summary only when the work is done.
- Keep the full output available on demand (collapsed/expandable) rather than
  inline.

## Notes

This is a work-in-progress feature request tracked on the fork. Implementation
will touch `packages/tui/src/util/collapse-tool-output.ts` and the session
rendering in `packages/tui/src/routes/session`. Requires `bun` to build/test.

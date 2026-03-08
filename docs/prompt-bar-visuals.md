# Prompt Bar Visuals (Defaults vs Source Changes)

## Defaults

- The TUI prompt bar uses state-based tints derived from session status and assistant/tool events.
- The opencode-effects crate provides a Ratatui widget and theme defaults for LLM response notifications.
- If you only need generic notification visuals in a separate TUI, opencode-effects can be used as-is.

## Source Changes

- TUI prompt bar behaviors (idle cycling, typing tint, response-state overlays) require changes in `packages/opencode`.
- These changes live in:
  - `packages/opencode/src/cli/cmd/tui/util/prompt-bar-state.ts`
  - `packages/opencode/src/cli/cmd/tui/util/prompt-bar-visual.ts`
  - `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`

## Verification

- Sandbox harness: `scripts/run-sandbox-tui.sh` (flags preferred; OPENCODE*SANDBOX*\* env vars deprecated)
- Usage: `scripts/run-sandbox-tui.sh --help`
- Evidence checks: `scripts/check-sandbox-evidence.sh`
- E2E captures: `.sisyphus/evidence/task-9-idle-cycle.txt`, `.sisyphus/evidence/task-9-typing-steady.txt`

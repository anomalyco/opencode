## Summary

Adds `tui.input.changed` plugin hook that fires when TUI input text changes. Enables plugins to observe user typing behavior for use cases like intent detection and analytics.

## Changed Files

- `packages/plugin/src/index.ts` - Add `tui.input.changed` hook type
- `packages/opencode/src/server/server.ts` - Add `POST /plugin/input-changed` endpoint
- `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` - Call endpoint on input change
- `packages/opencode/test/server/plugin-input-changed.test.ts` - Endpoint tests

## Test Coverage

3 tests covering valid requests, missing text, and empty text validation.

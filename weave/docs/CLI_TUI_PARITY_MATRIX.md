# CLI/TUI Parity Matrix

This matrix is the acceptance checklist for Gate E.

## Command parity

- [x] Binary identity supports `weave` while keeping `opencode` compatibility.
- [x] Core command tree renders with `weave` script name.
- [ ] Session resume and continue flows validated against upstream behavior.
- [ ] Tool invocation parity validated for all default tools.
- [ ] Thread/task display parity validated in TUI routes.

## Error parity

- [ ] Permission-denied behavior matches upstream user-visible output.
- [ ] Provider/model failures surface equivalent error semantics.
- [ ] Malformed tool outputs are handled without regressions.
- [ ] Interrupted runs (abort/cancel) match expected status transitions.

## Rendering parity

- [ ] Core context panes render without regression.
- [ ] Thread tree and status bars stay stable under streaming output.
- [x] Context sync routes handle Weave state updates.

## 2026-03-26 evidence

- `packages/opencode/src/cli/cmd/tui/context/sync.tsx` now refreshes Weave state on initial sync and message updates.
- `packages/opencode/src/cli/cmd/tui/routes/session/{header,footer,sidebar}.tsx` surface Weave counters in-session.
- `test/config/tui-weave-sync.test.ts` validates graceful fallback when `session.weave` is unavailable or throws.

## State parity

- [ ] Restart/resume consistency verified with persisted session state.
- [ ] Cross-command continuity matches upstream session mutation behavior.

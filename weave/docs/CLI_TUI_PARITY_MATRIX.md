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
- [ ] Context sync routes handle Weave state updates.

## State parity

- [ ] Restart/resume consistency verified with persisted session state.
- [ ] Cross-command continuity matches upstream session mutation behavior.

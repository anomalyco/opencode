# Cutover Scorecard

Use this scorecard for Gate F (`weave_opencode` promotion readiness).

## Engine seam and persistence

- [x] Weave namespace exists at `packages/opencode/src/session/weave/`.
- [x] Prompt assembly routes through Weave runtime seam.
- [x] Dual-store foundation exists (`opencode` DB + Weave storage domain).
- [x] Weave message link mapping and context snapshots are persisted.

## Core Weave features

- [x] Memory tools registered: `weave_grep`, `weave_describe`, `weave_expand`.
- [x] Thread tools registered: `dispatch_thread`, `dispatch_threads`.
- [x] Operator tools registered: `llm_map`, `agentic_map`.
- [x] Episode and summary node recording integrated in session loop.

## Quality checks

- [x] Package typecheck passes (`packages/opencode`).
- [ ] Full package test suite green (currently known baseline failures exist upstream in this fork branch).
- [ ] CLI/TUI parity matrix fully completed.
- [ ] OAuth conformance matrix fully completed with live validation.

## Go / No-Go rule

- **Go** only if all unchecked items above are completed.
- **No-Go** if any parity or OAuth matrix item remains unverified.

## Rollback notes

- Revert branch to pre-Weave integration commit.
- Disable Weave tools from `ToolRegistry` if partial rollback needed.
- Keep data migration additive: no destructive schema changes were introduced in this phase.

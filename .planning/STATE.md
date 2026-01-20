# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-19)

**Core value:** Secure remote access to your opencode instance from anywhere — authenticate once with your system credentials, work on your projects from any device.
**Current focus:** Phase 3 (Auth Broker Core) - Plan 02 Complete

## Current Position

Phase: 3 of 11 (Auth Broker Core)
Plan: 2 of 3 in current phase
Status: In progress
Last activity: 2026-01-20 - Completed 03-02-PLAN.md

Progress: [███░░░░░░░] ~32%

## Performance Metrics

**Velocity:**
- Total plans completed: 7
- Average duration: 4.3 min
- Total execution time: 30 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Configuration Foundation | 3 | 12 min | 4 min |
| 2. Session Infrastructure | 2 | 5 min | 2.5 min |
| 3. Auth Broker Core | 2 | 13 min | 6.5 min |

**Recent Trend:**
- Last 5 plans: 02-01 (2 min), 02-02 (3 min), 03-01 (8 min), 03-02 (5 min)
- Trend: Stable, Rust work slightly longer than TypeScript

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

| Phase | Decision | Rationale |
|-------|----------|-----------|
| 01-01 | Duration strings stored as-is (not transformed) | Matches config pattern - store config value, transform at usage |
| 01-01 | Type assertion for ms package | TypeScript compatibility with template literal types |
| 01-02 | PamServiceNotFoundError in Config namespace | Follows existing pattern - config errors in Config namespace |
| 01-03 | PAM validation after all config merging | Validate final effective config, not intermediate states |
| 01-03 | Startup-only PAM validation | Later deletion handled at auth time, not startup |
| 02-01 | In-memory session storage acceptable | Sessions lost on restart per CONTEXT.md design |
| 02-01 | Secondary index by username | O(1) removeAllForUser for "logout everywhere" |
| 02-02 | Auth middleware after cors, before Instance.provide | Auth happens early but CORS headers still set |
| 02-02 | AuthRoutes as global routes | Logout doesn't require project context |
| 02-02 | Secure cookie only on HTTPS | Allows localhost dev without HTTPS |
| 03-01 | nonstick instead of pam-client | pam-client fails on macOS due to OpenPAM compatibility |
| 03-01 | Password redaction: Debug + skip_serializing | Two-layer protection against password logging |
| 03-02 | AllNumeric check before InvalidFirstChar | More specific error messages for numeric usernames |

### Pending Todos

None yet.

### Blockers/Concerns

From research summary (Phase 2, 3 flags):
- Bun N-API compatibility with PAM libraries needs runtime verification
- PTY ownership with user impersonation via bun-pty needs testing

**Resolved:**
- macOS PAM crate compatibility - resolved by using nonstick instead of pam-client

## Session Continuity

Last session: 2026-01-20
Stopped at: Completed 03-02-PLAN.md (Auth components)
Resume file: None

## Phase 3 Progress

**Auth Broker Core - In Progress:**
- [x] Plan 01: Project init, IPC protocol, config loading (15 tests)
- [x] Plan 02: PAM wrapper, rate limiter, username validation (29 new tests)
- [ ] Plan 03: Unix socket server and request handler

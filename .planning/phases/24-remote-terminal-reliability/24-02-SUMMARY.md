---
phase: 24-remote-terminal-reliability
plan: 02
subsystem: ui
tags: [terminal, ghostty-web, wasm, csp, pty, broker]

# Dependency graph
requires:
  - phase: 24-remote-terminal-reliability/24-01
    provides: Request-scoped PTY error context and retry visibility
provides:
  - Broker-backed PTY lifecycle wiring with session registration alignment
  - UI PTY id reconciliation and reconnect handling
  - Ghostty WASM loading from stable asset URLs under CSP
  - Broker PTY error-mapping tests and UAT checklist
affects: [remote-terminal-reliability, terminal-ui, pty-routing]

# Tech tracking
tech-stack:
  added: []
  patterns: [Ghostty.load with explicit asset URLs, CSP connect-src allowance for wasm fetch]

key-files:
  created: []
  modified:
    - packages/opencode/src/pty/index.ts
    - packages/opencode/src/pty/broker-pty.ts
    - packages/opencode/src/server/routes/pty.ts
    - packages/opencode/src/server/routes/auth.ts
    - packages/opencode/src/server/server.ts
    - packages/app/src/context/terminal.tsx
    - packages/app/src/components/terminal.tsx
    - packages/opencode/test/server/routes/pty-auth.test.ts
    - packages/opencode/test/server/routes/pty-broker.test.ts

key-decisions:
  - "Load Ghostty WASM via Vite-resolved asset URL to avoid relative-path 404s."
  - "Allow data: in connect-src to prevent CSP blocking base64 wasm fetches."

patterns-established:
  - "Terminal bootstrap uses explicit WASM asset URL rather than default resolver."
  - "CSP connect-src includes data: for wasm fallback compatibility."

# Metrics
duration: 15m
completed: 2026-02-01
---

# Phase 24 Plan 02 Summary

**Broker-backed PTY lifecycle alignment with stable Ghostty WASM loading and resilient UI reconnects for remote terminals.**

## Performance

- **Duration:** 15m
- **Started:** 2026-02-01T21:35:00Z
- **Completed:** 2026-02-01T21:50:19Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments
- Wired broker-backed PTY creation/connect paths with session registration alignment
- Updated terminal UI to reconcile PTY ids on reconnect/clone without stale ids
- Added broker PTY error-mapping tests and documented a UAT checklist for terminal flows

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire broker-backed PTY creation/connection** - `68122d7af` (feat)
2. **Task 2: Align session registration lifecycle and UI PTY id handling** - `b801e2f8e` (feat)
3. **Task 3: Add server tests and manual UAT checklist** - `ef96e866a` (test)

**Plan metadata:** (this commit)

## Files Created/Modified
- `packages/opencode/src/pty/index.ts` - broker-backed PTY creation/connection plumbing
- `packages/opencode/src/pty/broker-pty.ts` - broker PTY lifecycle tracking and guardrails
- `packages/opencode/src/server/routes/pty.ts` - broker PTY route wiring and error mapping
- `packages/opencode/src/server/routes/auth.ts` - session registration before PTY spawn
- `packages/opencode/src/server/server.ts` - CSP connect-src allowance for wasm
- `packages/app/src/context/terminal.tsx` - PTY id reconciliation and retry handling
- `packages/app/src/components/terminal.tsx` - Ghostty WASM asset loading
- `packages/opencode/test/server/routes/pty-auth.test.ts` - auth-on PTY create tests
- `packages/opencode/test/server/routes/pty-broker.test.ts` - broker session error mapping tests

## UAT Checklist
1. Open the app at http://localhost:3000 and log in.
2. Open the terminal panel and create a new terminal tab.
3. Verify the terminal renders and browser console shows no CSP violations or 404s for `ghostty-vt.wasm`.
4. Run a command (e.g., `pwd`) and confirm output renders.
5. Refresh the page and ensure the terminal reconnects without /pty 500s.
6. Close the terminal tab and confirm server logs show PTY cleanup.

## Decisions Made
- Loaded Ghostty WASM from a Vite asset URL to keep fetches on stable absolute paths.
- Allowed data: in connect-src to support base64 WASM fetches if bundlers inline the asset.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Ghostty WASM load failed due to CSP + relative path 404s**
- **Found during:** Checkpoint UAT (terminal render verification)
- **Issue:** CSP blocked `data:` wasm fetches and relative path lookups returned 404s.
- **Fix:** Load Ghostty WASM from the Vite-resolved asset URL and allow data: in connect-src.
- **Files modified:** packages/app/src/components/terminal.tsx, packages/opencode/src/server/server.ts
- **Verification:** Pending re-run of UAT checklist (steps 1-4 confirm wasm load + render).
- **Committed in:** 75ad40b35

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Fix required for terminal rendering; no scope creep.

## Issues Encountered
- UAT reported terminal render failure from CSP blocking wasm fetches and 404s for `ghostty-vt.wasm` (resolved by explicit asset URL + CSP adjustment).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Terminal UAT can be re-run to confirm wasm load and reconnect behavior post-fix.

---
*Phase: 24-remote-terminal-reliability*
*Completed: 2026-02-01*

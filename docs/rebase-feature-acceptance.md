# Rebase Feature Acceptance Checklist

This checklist defines the minimum UI/runtime behavior that must be present after replacing fork code with upstream-based `dev`.

## 1) Sidebar recent sessions rail

1. On app start, left rail shows a **Recent sessions** button.
2. Recent sessions panel can be opened from that button at any time.
3. Recent sessions panel lists sessions even when some sessions reference missing parents.
4. Clicking a recent session opens that session.

## 2) Session page core controls

1. Session page header shows model selector control.
2. Session page opens without runtime crash (`vcs.diff is not a function` must not appear).

## 3) Autopilot flow

1. Autopilot mode can be entered from session UI.
2. After `autopilot_exit`, active agent/mode switches back to normal interactive mode.
3. User can continue in the same session without reload.

## 4) Regression guard commands

Run before deploy:

1. `cd packages/app && bun run build`
2. `cd packages/app && bun test src/utils/recent-session.test.ts`
3. `cd packages/opencode && bun typecheck`

## 5) VM deploy verification

1. VM repo `HEAD` equals `origin/dev`.
2. `opencode-serve` is `active`.
3. `~/.local/bin/opencode --version` matches the latest deployed dev build.
4. Manual UI check passes sections 1-3 above.

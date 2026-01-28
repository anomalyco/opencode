---
status: diagnosed
phase: 16-allow-the-user-to-download-git-repos-so-that-they-can-work-on-them-with-their-opencode-sessions
source: [16-01-SUMMARY.md, 16-04-SUMMARY.md, 16-05-SUMMARY.md]
started: 2026-01-28T15:34:50Z
updated: 2026-01-28T15:51:40Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

## Current Test

[testing complete]

## Tests

### 1. Repository manager dialog
expected: Opening the repository manager shows a list of repositories with actions to open a repo or access settings.
result: issue
reported: "I encountered a few side issues in the console, which is probably needing more vite config redirects to the backend: Unexpected agent list shape Object. Unexpected command list shape."
severity: minor

### 2. Add local repository
expected: Choosing "Add local" opens a directory picker and adds the selected repo, which appears in the repo list and can be selected.
result: issue
reported: "I was able to select a local repo, but got console errors: GET /repo/:id/branches 500, plus unexpected agent/command list shape HTML responses."
severity: blocker

### 3. Clone repository workflow
expected: The clone dialog accepts a repo URL (and optional branch), shows progress while cloning, and adds the repo on success.
result: issue
reported: "Clone started but console shows GET /repo/:id/branches 500 and unexpected agent/command list shape HTML responses."
severity: blocker

### 4. Credential retry for private clone
expected: When cloning a private repo, a credential prompt appears and retrying with valid credentials completes the clone.
result: issue
reported: "Clone may have used local credentials; console shows GET /repo/:id/branches 500 and unexpected agent/command list shape HTML responses."
severity: blocker

### 5. Branch switching with dirty warning
expected: Switching branches shows a warning if the working tree is dirty, with an option to force switch.
result: issue
reported: "Nothing happens when I click the \"Select branch\" selector. We should probably be smarter about empty state or default state if that is the issue."
severity: major

### 6. New session repo selector
expected: The new session view shows the repo selector, allows choosing a repo, and updates branches for the selected repo.
result: skipped
reason: "UI visible but behaviors not tested"

## Summary

total: 6
passed: 0
issues: 5
pending: 0
skipped: 1

## Gaps

- truth: "Opening the repository manager shows a list of repositories with actions to open a repo or access settings."
  status: failed
  reason: "User reported: I encountered a few side issues in the console, which is probably needing more vite config redirects to the backend: Unexpected agent list shape Object. Unexpected command list shape."
  severity: minor
  test: 1
  root_cause: "Vite dev proxy is missing /agent and /command, so SDK calls hit the dev server and return HTML instead of arrays."
  artifacts:
    - path: "packages/app/vite.config.ts"
      issue: "No proxy entries for /agent and /command."
    - path: "packages/app/src/context/global-sync.tsx"
      issue: "SDK calls /agent and /command in dev."
  missing:
    - "Proxy /agent and /command to the backend in dev."
  debug_session: ".planning/debug/agent-command-shape.md"
- truth: "Choosing \"Add local\" opens a directory picker and adds the selected repo, which appears in the repo list and can be selected."
  status: failed
  reason: "User reported: I was able to select a local repo, but got console errors: GET /repo/:id/branches 500, plus unexpected agent/command list shape HTML responses."
  severity: blocker
  test: 2
  root_cause: "Branch listing throws CloneError for invalid repo paths and is surfaced as 500; dev proxy missing /agent and /command returns HTML responses."
  artifacts:
    - path: "packages/opencode/src/server/routes/repo.ts"
      issue: "Branches endpoint does not handle CloneError."
    - path: "packages/opencode/src/repo/repo.ts"
      issue: "ensureGitRepo throws CloneError for missing or invalid repos."
    - path: "packages/opencode/src/server/server.ts"
      issue: "Non-NamedError falls back to 500."
    - path: "packages/app/vite.config.ts"
      issue: "Missing /agent and /command proxy entries."
  missing:
    - "Return structured 4xx for invalid repo paths in /repo/:id/branches."
    - "Proxy /agent and /command to backend in dev."
  debug_session: ".planning/debug/repo-branches-500.md"
- truth: "The clone dialog accepts a repo URL (and optional branch), shows progress while cloning, and adds the repo on success."
  status: failed
  reason: "User reported: Clone started but console shows GET /repo/:id/branches 500 and unexpected agent/command list shape HTML responses."
  severity: blocker
  test: 3
  root_cause: "Branch listing returns 500 when repo path validation fails; dev proxy missing /agent and /command returns HTML responses."
  artifacts:
    - path: "packages/opencode/src/server/routes/repo.ts"
      issue: "Branches endpoint does not handle CloneError."
    - path: "packages/opencode/src/repo/repo.ts"
      issue: "ensureGitRepo throws CloneError for invalid worktrees."
    - path: "packages/app/vite.config.ts"
      issue: "Missing /agent and /command proxy entries."
  missing:
    - "Return structured 4xx for invalid repo paths in /repo/:id/branches."
    - "Proxy /agent and /command to backend in dev."
  debug_session: ".planning/debug/clone-branches-500.md"
- truth: "When cloning a private repo, a credential prompt appears and retrying with valid credentials completes the clone."
  status: failed
  reason: "User reported: Clone may have used local credentials; console shows GET /repo/:id/branches 500 and unexpected agent/command list shape HTML responses."
  severity: blocker
  test: 4
  root_cause: "Branches endpoint returns 500 on CloneError for invalid repo paths; dev proxy missing /agent and /command returns HTML responses."
  artifacts:
    - path: "packages/opencode/src/server/routes/repo.ts"
      issue: "Branches endpoint does not handle CloneError."
    - path: "packages/opencode/src/repo/repo.ts"
      issue: "ensureGitRepo throws CloneError for invalid worktrees."
    - path: "packages/app/vite.config.ts"
      issue: "Missing /agent and /command proxy entries."
  missing:
    - "Return structured 4xx for invalid repo paths in /repo/:id/branches."
    - "Proxy /agent and /command to backend in dev."
  debug_session: ".planning/debug/private-clone-branches-500.md"
- truth: "Switching branches shows a warning if the working tree is dirty, with an option to force switch."
  status: failed
  reason: "User reported: Nothing happens when I click the \"Select branch\" selector. We should probably be smarter about empty state or default state if that is the issue."
  severity: major
  test: 5
  root_cause: "Branch list requests fail with 500s, leaving the branch selector empty and unresponsive."
  artifacts:
    - path: "packages/opencode/src/server/routes/repo.ts"
      issue: "Branches endpoint returns 500 on invalid repo paths."
    - path: "packages/opencode/src/repo/repo.ts"
      issue: "ensureGitRepo throws CloneError on missing/invalid repos."
  missing:
    - "Return structured errors for invalid repo paths and surface empty branch states in UI."
  debug_session: ".planning/debug/repo-branches-500.md"

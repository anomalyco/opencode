---
status: diagnosed
phase: 16-allow-the-user-to-download-git-repos-so-that-they-can-work-on-them-with-their-opencode-sessions
source: [16-01-SUMMARY.md, 16-04-SUMMARY.md, 16-05-SUMMARY.md]
started: 2026-01-28T15:34:50Z
updated: 2026-01-28T16:25:39Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

## Current Test

[testing complete]

## Tests

### 1. Repository manager dialog
expected: Opening the repository manager shows a list of repositories with actions to open a repo or access settings.
result: pass

### 2. Add local repository
expected: Choosing "Add local" opens a directory picker and adds the selected repo, which appears in the repo list and can be selected.
result: issue
reported: "The UX is confusing: it shows a text input for a local repo path. Needs a file selector or clearer guidance that the path must be on the host machine."
severity: major

### 3. Clone repository workflow
expected: The clone dialog accepts a repo URL (and optional branch), shows progress while cloning, and adds the repo on success.
result: issue
reported: "Cloning succeeds but branch selector errors: Request Failed GET /repo/:id/branches 500."
severity: blocker

### 4. Credential retry for private clone
expected: When cloning a private repo, a credential prompt appears and retrying with valid credentials completes the clone.
result: skipped
reason: "Test later on fresh machine with no credentials"

### 5. Branch switching with dirty warning
expected: Switching branches shows a warning if the working tree is dirty, with an option to force switch.
result: skipped
reason: "Blocked by broken Select branch selector"

### 6. New session repo selector
expected: The new session view shows the repo selector, allows choosing a repo, and updates branches for the selected repo.
result: issue
reported: "UI renders, but branch selector still errors: GET /repo/:id/branches 500."
severity: major

## Summary

total: 6
passed: 1
issues: 3
pending: 0
skipped: 2

## Gaps

- truth: "Choosing \"Add local\" opens a directory picker and adds the selected repo, which appears in the repo list and can be selected."
  status: failed
  reason: "User reported: The UX is confusing: it shows a text input for a local repo path. Needs a file selector or clearer guidance that the path must be on the host machine."
  severity: major
  test: 2
  root_cause: "Repository manager uses a plain text path input instead of the directory picker, creating inconsistent UX and unclear path requirements."
  artifacts:
    - path: "packages/app/src/components/repo/repository-manager-dialog.tsx"
      issue: "Add local flow uses manual path input only."
  missing:
    - "Add a directory picker button or integrate DialogSelectDirectory/openDirectoryPickerDialog."
    - "Clarify host-machine path requirement in helper copy."
  debug_session: ".planning/debug/add-local-ux.md"
- truth: "The clone dialog accepts a repo URL (and optional branch), shows progress while cloning, and adds the repo on success."
  status: failed
  reason: "User reported: Cloning succeeds but branch selector errors: Request Failed GET /repo/:id/branches 500."
  severity: blocker
  test: 3
  root_cause: "Branches endpoint only handles CloneError; invalid/corrupt repo records or missing repo.path throw non-CloneError exceptions and return 500."
  artifacts:
    - path: "packages/opencode/src/server/routes/repo.ts"
      issue: "Branches endpoint only catches CloneError."
    - path: "packages/opencode/src/repo/repo.ts"
      issue: "Repo.get does not validate records; listBranches assumes repo.path."
    - path: "packages/opencode/src/storage/storage.ts"
      issue: "Malformed JSON errors propagate as generic 500."
  missing:
    - "Validate repo records and map invalid entries to 400/404."
    - "Treat missing repo.path as CloneError/NotFound in branches handler."
  debug_session: ".planning/debug/repo-branches-500-uat2.md"
- truth: "The new session view shows the repo selector, allows choosing a repo, and updates branches for the selected repo."
  status: failed
  reason: "User reported: UI renders, but branch selector still errors: GET /repo/:id/branches 500."
  severity: major
  test: 6
  root_cause: "Same branch list failure as clone workflow; RepoSelector calls /repo/:id/branches and receives 500 when repo record/path is invalid."
  artifacts:
    - path: "packages/app/src/components/repo/repo-selector.tsx"
      issue: "Branch list call fails with 500; UI surfaces generic error."
    - path: "packages/opencode/src/server/routes/repo.ts"
      issue: "Branches endpoint returns 500 for invalid repo records."
  missing:
    - "Return structured 4xx for invalid repo paths."
    - "Surface branch error details in selector copy."
  debug_session: ".planning/debug/new-session-branch-selector.md"

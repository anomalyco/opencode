---
status: complete
phase: 16-allow-the-user-to-download-git-repos-so-that-they-can-work-on-them-with-their-opencode-sessions
source: [16-01-SUMMARY.md]
started: 2026-01-28T14:25:07Z
updated: 2026-01-28T14:34:50Z
---

## Current Test

[testing complete]

## Tests

### 1. Repository manager dialog
expected: Opening the repository manager shows a list of repositories with actions to open a repo or access settings.
result: issue
reported: "The empty state ui seems a bit different; we might need to update our instructions or maybe theres a different way to get to the repo manager?"
severity: minor

### 2. Add local repository
expected: Choosing "Add local" opens a directory picker and adds the selected repo, which appears in the repo list and can be selected.
result: issue
reported: "When I click Add local, I get a dialog box with nothing in it and nothing really actionable: Unexpected find.files response shape {input: {…}}"
severity: blocker

### 3. Clone repository workflow
expected: The clone dialog accepts a repo URL (and optional branch), shows progress while cloning, and adds the repo on success.
result: issue
reported: "I get an error when trying to clone a public repo: GET http://localhost:3001/repo/clone-progress?url=https%3A%2F%2Fgithub.com%2FpRizz%2Fzeckendorf-spiral.git 404 (Not Found). Connection to the server was lost."
severity: blocker

### 4. Credential retry for private clone
expected: When cloning a private repo, a credential prompt appears and retrying with valid credentials completes the clone.
result: issue
reported: "Similar error: GET http://localhost:3001/repo/clone-progress?url=https%3A%2F%2Fgithub.com%2FpRizz%2Fgithub-stats.git 404 (Not Found). Dialog says Connection to the server was lost."
severity: blocker

### 5. Branch switching with dirty warning
expected: Switching branches shows a warning if the working tree is dirty, with an option to force switch.
result: skipped
reason: blocked by other failures

### 6. New session repo selector
expected: The new session view shows the repo selector, allows choosing a repo, and updates branches for the selected repo.
result: issue
reported: "the ui is there but I am blocked from testing the behaviors"
severity: major

## Summary

total: 6
passed: 0
issues: 5
pending: 0
skipped: 1

## Gaps

- truth: "Opening the repository manager shows a list of repositories with actions to open a repo or access settings."
  status: failed
  reason: "User reported: The empty state ui seems a bit different; we might need to update our instructions or maybe theres a different way to get to the repo manager?"
  severity: minor
  test: 1
  artifacts: []
  missing: []
- truth: "Choosing \"Add local\" opens a directory picker and adds the selected repo, which appears in the repo list and can be selected."
  status: failed
  reason: "User reported: When I click Add local, I get a dialog box with nothing in it and nothing really actionable: Unexpected find.files response shape {input: {…}}"
  severity: blocker
  test: 2
  artifacts: []
  missing: []
- truth: "The clone dialog accepts a repo URL (and optional branch), shows progress while cloning, and adds the repo on success."
  status: failed
  reason: "User reported: I get an error when trying to clone a public repo: GET http://localhost:3001/repo/clone-progress?url=https%3A%2F%2Fgithub.com%2FpRizz%2Fzeckendorf-spiral.git 404 (Not Found). Connection to the server was lost."
  severity: blocker
  test: 3
  artifacts: []
  missing: []
- truth: "When cloning a private repo, a credential prompt appears and retrying with valid credentials completes the clone."
  status: failed
  reason: "User reported: Similar error: GET http://localhost:3001/repo/clone-progress?url=https%3A%2F%2Fgithub.com%2FpRizz%2Fgithub-stats.git 404 (Not Found). Dialog says Connection to the server was lost."
  severity: blocker
  test: 4
  artifacts: []
  missing: []
- truth: "The new session view shows the repo selector, allows choosing a repo, and updates branches for the selected repo."
  status: failed
  reason: "User reported: the ui is there but I am blocked from testing the behaviors"
  severity: major
  test: 6
  artifacts: []
  missing: []

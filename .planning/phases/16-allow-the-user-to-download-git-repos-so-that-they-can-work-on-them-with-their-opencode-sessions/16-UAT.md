---
status: complete
phase: 16-allow-the-user-to-download-git-repos-so-that-they-can-work-on-them-with-their-opencode-sessions
source: [16-01-SUMMARY.md, 16-04-SUMMARY.md, 16-05-SUMMARY.md]
started: 2026-01-28T15:34:50Z
updated: 2026-01-28T21:02:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Repository manager dialog

expected: Opening the repository manager shows a list of repositories with actions to open a repo or access settings.
result: pass

### 2. Add local repository

expected: Choosing "Add local" opens a directory picker and adds the selected repo, which appears in the repo list and can be selected.
result: pass

### 3. Clone repository workflow

expected: The clone dialog accepts a repo URL (and optional branch), shows progress while cloning, and adds the repo on success.
result: pass

### 4. Credential retry for private clone

expected: When cloning a private repo, a credential prompt appears and retrying with valid credentials completes the clone.
result: skipped
reason: "skip"

### 5. Branch switching with dirty warning

expected: Switching branches shows a warning if the working tree is dirty, with an option to force switch.
result: pass

### 6. New session repo selector

expected: The new session view shows the repo selector, allows choosing a repo, and updates branches for the selected repo.
result: pass

## Summary

total: 6
passed: 5
issues: 0
pending: 0
skipped: 1

## Gaps

[none]

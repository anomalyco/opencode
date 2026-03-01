# OpenFixer Failure-Takeover and Mongosh Assimilation (2026-02-24)

Decision link: `DECISION_133`

## Why This Pass

OpenFixer was reported as not taking deterministic control when projects fail. In the same pass, MongoDB operational control requested explicit Mongosh assimilation.

## Workflow Hardening Delta

- Added mandatory project-failure takeover lifecycle:
  - `stabilize -> diagnose -> remediate -> verify -> harden`
- Added operator-facing control-note requirement each phase:
  - blocker
  - next deterministic action
  - evidence path
- Added explicit `mongosh` preference for MongoDB data-state and migration investigations.

## Mongosh Assimilation Delta

- Managed mirrors added:
  - `OP3NF1XER/mongosh-source`
  - `OP3NF1XER/mongosh-dev`
- Managed package coverage added:
  - `MongoDB.Shell` in `OP3NF1XER/knowledge/managed-package-lock.json`
- Package installation completed:
  - `winget install -e --id MongoDB.Shell --accept-package-agreements --accept-source-agreements`
- Stack sync automation updated:
  - `OP3NF1XER/assimilate-managed-stack.ps1`
- Command-surface drift remediated:
  - `C:/Users/paulc/bin/mongosh` now targets `C:/Users/paulc/AppData/Local/Programs/mongosh/mongosh.exe`
  - `mongosh --version` resolves to `2.7.0`

## Command Anchors

```powershell
winget search MongoDB
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\P4NTH30N\OP3NF1XER\assimilate-managed-stack.ps1"
```

## Reusable Learning

- Failure recovery degrades when phase ownership is implied; enforce explicit control notes in workflow docs.
- Stack assimilation should include both source mirrors and package policy lock updates in the same pass.

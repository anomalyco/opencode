# Windows Host Full Environment Analysis (2026-02-24)

Decision links: `DECISION_120`, `DECISION_122`, `DECISION_123`, `DECISION_128`

## Scope

- OpenFixer governance of command/runtime behavior.
- Managed stack state (OpenCode, ToolHive, LM Studio, Rancher Desktop).
- Windows host inventory and package/duplicate posture.
- Path-drift and naming-confusion risk analysis.

## Evidence Sources

- `OP3NF1XER/knowledge/runtime-control-audit-2026-02-24T12-41-25.json`
- `OP3NF1XER/knowledge/windows11-inventory-2026-02-24T12-41-25.json`
- `OP3NF1XER/knowledge/managed-package-policy-2026-02-24T12-41-25.json`
- `OP3NF1XER/knowledge/stack-duplicates.json`

## Runtime Command Surface

- `opencode` resolves through controlled shim: `C:\Users\paulc\AppData\Roaming\npm\opencode.ps1`.
- `thv` resolves through wrapper: `C:\Users\paulc\bin\thv.ps1`.
- `lms` resolves through wrapper: `C:\Users\paulc\bin\lms.ps1`.
- `rdctl` resolves through wrapper: `C:\Users\paulc\bin\rdctl.ps1`.

All runtime checks passed in latest audit (`ok=true` for all checks).

## Managed Stack Versions

- OpenCode CLI: `0.0.0-dev-202602241756`
- ToolHive CLI: `0.9.4` (update available: `0.10.0`)
- LM Studio CLI commit: `df81c60`
- Rancher Desktop CLI (`rdctl`) client: `v1.22.0`

## Package Governance

- Managed targets all single-install (`duplicateStatus=single_or_none`).
- Lock versions all matched (`versionMatchesLock=true`).
- Winget pin attempts still report non-effective (`pinEffective=false`) for supported IDs; lock+audit remains enforcement source.

## Host Inventory Snapshot

- Machine: `CATH3DR4L-01`
- OS product string: `Windows 10 Enterprise`
- Build: `26100` (modern Windows platform build line)
- CPU: AMD Ryzen 9 3900X (12c/24t)
- Memory (visible/free KB): `134135320 / 113291540`
- Disk free:
  - `C:` ~1.40 TB free
  - `D:` ~2.53 TB free

## Drift and Confusion Findings

Initial analysis pass found operational scripts still hardcoded to `C:\P4NTHE0N\...` while active workspace is `C:\P4NTH30N\...`.

Impacts observed before remediation:

- Inventory export failed (directory not found)
- Runtime audit export failed (directory not found)
- Package policy failed (lock file path not found)

## Remediation Applied

- Converted operational scripts to use `$PSScriptRoot`-relative paths:
  - `OP3NF1XER/windows11-inventory.ps1`
  - `OP3NF1XER/audit-runtime-control.ps1`
  - `OP3NF1XER/enforce-managed-package-policy.ps1`
  - `OP3NF1XER/assimilate-managed-stack.ps1`
  - `OP3NF1XER/update-opencode-dev.ps1`
- Updated guidance docs to current root path:
  - `OP3NF1XER/knowledge/WINDOWS11_CONTROL_PLANE.md`
  - `OP3NF1XER/knowledge/RUNTIME_CONTROL_BASELINE.md`
  - `OP3NF1XER/knowledge/STACK_ASSIMILATION.md`

## Behavioral Hardening

- OpenFixer role now explicitly includes full environment oversight and confusion reduction.
- Added clarity loop pattern:
  - `OP3NF1XER/patterns/ENVIRONMENT_CLARITY_LOOP.md`
- Updated OpenFixer profile to reflect governance posture:
  - `OP3NF1XER/index.md`

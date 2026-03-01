# Windows 11 Control Plane (OpenFixer)

Decision link: `DECISION_120`

## Scope of Responsibility

- Maintain deterministic inventory of host OS and managed packages.
- Maintain package/update governance for OpenCode, Rancher Desktop, ToolHive, and LM Studio.
- Preserve reproducible environment state artifacts for fast troubleshooting.

## Inventory Command

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\P4NTH30N\OP3NF1XER\windows11-inventory.ps1"
```

Output:

- `OP3NF1XER/knowledge/windows11-inventory-<timestamp>.json`

## Mandatory Cadence

- Run inventory after major upgrades.
- Run inventory before/after duplicate-removal operations.
- Attach inventory paths to deployment journals.

## Path-Drift Guardrail

- Operational scripts resolve output roots from `$PSScriptRoot` to avoid repo-name drift (`P4NTH30N` vs `P4NTHE0N`).
- If the script path changes, keep `knowledge/` colocated under `OP3NF1XER`.

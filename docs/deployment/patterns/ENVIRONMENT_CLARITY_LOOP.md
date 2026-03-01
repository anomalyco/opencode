# Pattern: Environment Clarity Loop

## Trigger

Any full-environment analysis, post-restart drift check, or command-path confusion event.

## Mandatory Sequence

1. Run runtime command-source audit.
2. Run Windows host inventory export.
3. Run managed package policy and duplicate check.
4. Fix path drift by replacing hardcoded repo roots with `$PSScriptRoot` in operational scripts.
5. Enforce user-path policy and machine-path policy (when elevated) for deterministic command precedence.
6. Re-run all audits and publish evidence paths.
7. Verify canonical executable artifact paths include dependency assemblies required at launch (artifact parity check).

## Required Outputs

- `OP3NF1XER/knowledge/runtime-control-audit-<timestamp>.json`
- `OP3NF1XER/knowledge/windows11-inventory-<timestamp>.json`
- `OP3NF1XER/knowledge/managed-package-policy-<timestamp>.json`
- `OP3NF1XER/knowledge/stack-duplicates.json`

## Closure Rule

Do not close if any operational script still depends on a hardcoded repo root path.
Do not close if the operator-facing executable path fails artifact parity (missing runtime dependencies).

# DECISION_149 Learning Delta: Machine PATH Governance

Decision link: `DECISION_149`

## What changed

- Extended `enforce-runtime-path-policy.ps1` with machine-path persistence (`-PersistMachinePath`) and explicit machine update/error evidence.
- Extended `assimilate-managed-stack.ps1` with `-PersistMachinePathPolicy` so developmental assimilation can harden machine runtime PATH in the same pass.
- Extended `audit-runtime-control.ps1` with explicit user-path and machine-path order assertions for OpenSSH precedence.

## Reusable pattern

- Assimilation-to-runtime continuity should enforce command precedence on both user and machine surfaces.
- Runtime audit should validate:
  1. command resolution (`where ssh`),
  2. path-order policy (user + machine),
  3. development parity (`*-source` == `*-dev`).

## Query anchors

- `DECISION_149`
- `machine path policy governance`
- `assimilation runtime continuity`
- `openssh user machine path audit`

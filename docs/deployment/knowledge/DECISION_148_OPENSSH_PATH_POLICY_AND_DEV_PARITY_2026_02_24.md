# DECISION_148 Learning Delta: OpenSSH PATH Policy + Dev Parity

Decision link: `DECISION_148`

## What changed

- Added `OP3NF1XER/enforce-runtime-path-policy.ps1` to force Windows OpenSSH precedence and demote Git SSH directories in runtime PATH ordering.
- Updated `OP3NF1XER/assimilate-managed-stack.ps1` to run PATH policy enforcement each assimilation pass.
- Extended `OP3NF1XER/audit-runtime-control.ps1` with explicit PATH policy and OpenSSH source/dev parity assertions.

## Reusable pattern

- For tooling with multiple binary providers, audit both controls independently:
  1. Runtime command-source policy (`where <cmd>` first candidate).
  2. Development mirror parity (`*-source` HEAD equals `*-dev` HEAD).
- Integrate runtime path policy enforcement into the assimilation script itself so governance is not optional in normal update flows.

## Query anchors

- `DECISION_148`
- `openssh path policy`
- `development parity audit`
- `assimilation runtime continuity protocol`

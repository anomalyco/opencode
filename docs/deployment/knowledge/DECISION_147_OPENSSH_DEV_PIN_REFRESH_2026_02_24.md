# DECISION_147 Learning Delta: OpenSSH Dev Pin Refresh

Decision link: `DECISION_147`

## What changed

- Re-executed managed stack assimilation with OpenSSH in scope and confirmed no drift between `OP3NF1XER/openssh-source` and `OP3NF1XER/openssh-dev`.
- Refreshed pin evidence ownership to current decision in `OP3NF1XER/knowledge/openssh-source-lock.json`.
- Exported fresh runtime control evidence in `OP3NF1XER/knowledge/runtime-control-audit-2026-02-24T23-07-55.json`.

## Reusable pattern

- For OpenSSH control audits in mixed shell contexts, use `ssh -V` directly when running from Bash wrappers and keep `cmd /c "ssh -V 2>&1"` inside PowerShell-native audit scripts.
- Treat `openssh-source` commit parity and runtime `where ssh` path parity as separate controls; both must pass to claim full oversight.

## Query anchors

- `DECISION_147`
- `openssh dev pin refresh`
- `ssh control audit`
- `openssh-source-lock`

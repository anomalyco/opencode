# DECISION_146 Learning Delta: OpenSSH Client Assimilation

Decision link: `DECISION_146`

## What changed

- OpenSSH is now an explicit managed stack member in `OP3NF1XER/assimilate-managed-stack.ps1` (`openssh-source` + `openssh-dev`, upstream `openssh/openssh-portable`, branch `master`).
- Runtime control audit now captures `ssh`/`sshd` command sources plus `ssh -V` and Windows OpenSSH capability state.
- Source/runtime lock artifact added at `OP3NF1XER/knowledge/openssh-source-lock.json` for deterministic pin tracking.

## Reusable pattern

- For Windows-native tools without reliable winget package IDs, treat control as dual-surface:
  1. Source governance (`*-source` and `*-dev` mirrors + pinned commit).
  2. Runtime governance (binary version probe + `Get-WindowsCapability` state snapshot).
- For `ssh -V` in strict PowerShell audit wrappers, run through `cmd /c "ssh -V 2>&1"` to avoid false negatives from stderr/native-command semantics.
- Always capture `where ssh` to detect path drift between Git-for-Windows SSH and Windows capability SSH.

## Query anchors

- `openssh assimilation`
- `ssh client pin`
- `OpenSSH.Client~~~~0.0.1.0`
- `openssh-source-lock`
- `DECISION_146`

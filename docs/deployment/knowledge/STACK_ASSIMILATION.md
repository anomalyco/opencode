# OpenFixer Stack Assimilation

Decision link: `DECISION_120`

## Managed Platforms

- OpenCode (`SST.OpenCodeDesktop`) - managed via local source/dev mirrors and wrapper control.
- Rancher Desktop (`SUSE.RancherDesktop`) - managed via source/dev mirrors and scripted sync.
- ToolHive (`stacklok/toolhive`) - managed via source/dev mirrors and scripted sync.
- OpenSSH (`openssh/openssh-portable`) - managed via source/dev mirrors and scripted sync.
- Mongosh (`mongodb-js/mongosh`) - managed via source/dev mirrors and scripted sync.
- MongoDB Shell package (`MongoDB.Shell`) - managed via Windows package lifecycle and duplicate policy checks.
- LM Studio stack:
  - Desktop package (`ElementLabs.LMStudio`) managed via Windows package lifecycle.
  - CLI source (`lmstudio-ai/lms`) managed via source/dev mirrors and scripted sync.

## Assimilation Standard

For each managed stack:

1. Maintain `*-source` (upstream mirror) and `*-dev` (local working/build copy).
2. Sync source from upstream branch.
3. Fast-forward dev from source via `source-local` remote.
4. Capture inventory + duplicates report.
5. Record evidence in deployment journal and linked decision.

## Primary Command

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\P4NTH30N\OP3NF1XER\assimilate-managed-stack.ps1"
```

Optional full builds:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\P4NTH30N\OP3NF1XER\assimilate-managed-stack.ps1" -FullBuild
```

Package policy command:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\P4NTH30N\OP3NF1XER\enforce-managed-package-policy.ps1"
```

Version lock file:

- `OP3NF1XER/knowledge/managed-package-lock.json`
- `OP3NF1XER/knowledge/openssh-source-lock.json`

## Duplicate Policy

- Duplicate detection report: `OP3NF1XER/knowledge/stack-duplicates.json`.
- If duplicates are detected, do not silently remove; record exact package IDs and remove only redundant installations with evidence in journal.

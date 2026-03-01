# DECISION_144 Learning Delta (2026-02-24)

## Decision Link

- `STR4TEG15T/memory/decisions/DECISION_144_RAILWAY_TEMPLATE_LOCALIZATION_AND_SSH_PREFLIGHT_ONLY.md`

## Assimilated Truth

- When Nexus pivots to local-only prep, Railway project/service scaffolds must be rolled back immediately and validated with `railway list` evidence.
- Template localization for ownership includes removing inherited `.git` and `.github` surfaces before new repo initialization.
- SSH-first prep is stable when both layers exist:
  - runtime image includes `openssh-client`,
  - operator-side preflight script validates env vars, key path, and SSH client availability.

## Reusable Anchors

- `railway undo project local prep only`
- `template ownership strip inherited git metadata`
- `ssh preflight env var gate railway operator`

## Evidence Paths

- `OP3NF1XER/nate-alma/deploy/Dockerfile`
- `OP3NF1XER/nate-alma/deploy/scripts/railway-ssh-probe.sh`
- `OP3NF1XER/nate-alma/deploy/ops/ssh/ssh_config.template`
- `OP3NF1XER/nate-alma/deploy/ops/ssh/README.md`
- `OP3NF1XER/nate-alma/deploy/ops/railway-target.json`

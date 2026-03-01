# DECISION_145 Learning Delta (2026-02-24)

## Decision Link

- `STR4TEG15T/memory/decisions/DECISION_145_OPENCLAW_LOCAL_CLONE_AND_NATE_ALMA_DEPLOY_PIN_REFRESH.md`

## Assimilated Truth

- Nate-Alma operations are clearer when source mirror and deployment lane are both explicit in local paths (`openclaw/` + `deploy/`).
- Deploy pin drift is easiest to control with a single lock artifact carrying tag + commit + local mirror path.
- For OpenClaw deploy stability, prefer stable release tags over moving `main` in Docker build args.

## Reusable Anchors

- `openclaw local clone nate alma control plane`
- `nate alma deploy pin refresh stable tag`
- `openclaw source lock tag commit deploy provenance`

## Evidence Paths

- `OP3NF1XER/nate-alma/openclaw`
- `OP3NF1XER/nate-alma/deploy/Dockerfile`
- `OP3NF1XER/nate-alma/deploy/ops/openclaw-source-lock.json`
- `OP3NF1XER/deployments/JOURNAL_2026-02-24_DECISION_145_OPENCLAW_LOCAL_CLONE_DEPLOY_PIN.md`

# DECISION_150 Learning Delta (2026-02-25)

## Decision Link

- `STR4TEG15T/memory/decisions/DECISION_150_NATE_ALMA_DEPLOY_AUDIT_AGENT_MANIFEST_AND_RAILWAY_RELEASE.md`

## Assimilated Truth

- Railway `requiredMountPath` is an enforceable gate; first deploy can fail before runtime if `/data` volume is missing.
- On Windows Git Bash, Railway mount-path arguments can be mutated unless `MSYS2_ARG_CONV_EXCL='*'` is set for `/data` style paths.
- Deployment auditability improves when `ops/railway-target.json` is updated with live project/service/environment IDs immediately after successful deploy.
- A deploy-root `AGENTS.MD` marker supports SSH pull audits and quick identity confirmation for remote operators.

## Reusable Anchors

- `railway required mount path /data deploy failed`
- `windows git bash railway volume add msys2 arg conv excl`
- `openclaw alma v1 railway target id lock`
- `deploy root agents md ssh audit marker`

## Evidence Paths

- `OP3NF1XER/nate-alma/deploy/AGENTS.MD`
- `OP3NF1XER/nate-alma/deploy/ops/railway-target.json`
- `OP3NF1XER/deployments/JOURNAL_2026-02-25_DECISION_150_NATE_ALMA_DEPLOY_AUDIT_AND_RELEASE.md`
- Railway deployment ids:
  - `e595291e-da0a-4c26-aa42-25cac2d445c3` (failed pre-remediation)
  - `3ce198a2-3363-45dd-afcd-46765464cf54` (successful post-remediation)

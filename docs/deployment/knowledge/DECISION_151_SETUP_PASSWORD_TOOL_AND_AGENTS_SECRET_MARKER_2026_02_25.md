# DECISION_151 Learning Delta (2026-02-25)

## Decision Link

- `STR4TEG15T/memory/decisions/DECISION_151_SETUP_PASSWORD_TOOL_AND_AGENTS_SECRET_MARKER.md`

## Assimilated Truth

- A dedicated setup-password generator script is useful in the deploy lane for deterministic operator handoff (`scripts/generate-setup-password.js`).
- When Nexus explicitly requests secret placement in AGENTS documentation, align deployment variable state in the same pass to avoid split-brain credentials.
- Post-secret update validation should prove both auth-gate behavior (`401` unauthenticated) and authenticated health (`200` with Basic auth).

## Reusable Anchors

- `openclaw setup password tool deploy script`
- `agents md password marker railway setup password alignment`
- `setup auth gate verify 401 then 200 basic auth`

## Evidence Paths

- `OP3NF1XER/nate-alma/deploy/scripts/generate-setup-password.js`
- `OP3NF1XER/nate-alma/deploy/package.json`
- `OP3NF1XER/nate-alma/deploy/AGENTS.MD`
- `OP3NF1XER/deployments/JOURNAL_2026-02-25_DECISION_151_SETUP_PASSWORD_TOOL_AND_AGENTS_SECRET_MARKER.md`

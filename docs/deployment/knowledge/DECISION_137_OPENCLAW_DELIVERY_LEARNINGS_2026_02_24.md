# DECISION_137 OpenClaw Delivery Learnings (2026-02-24)

## Decision Links

- Primary: `DECISION_137`
- Related control-plane context: `DECISION_052`, `DECISION_053`, `DECISION_054`, `DECISION_055`

## What Worked

- OpenClaw workspace accepts large corpus packaging cleanly through git commit boundaries.
- Doctrine artifacts can be versioned as first-class workspace memory under `memory/substack/doctrine/`.
- Required intro note can be enforced through a dedicated immutable artifact file.

## What Blocked Deployment

- Railway CLI installation succeeded, but deployment login failed due missing valid auth session/token.
- Historical tokens in decisions were no longer usable for current CLI auth flow.
- Endpoint status can be green while route intent is still wrong (`/textbook/` returned OpenClaw SPA shell title).

## Reusable Automation Opportunity

- Add an OpenFixer preflight script for Railway deployment passes:
  1. verify CLI installed,
  2. verify active auth,
  3. verify project link,
  4. abort fast with explicit blocker message before packaging/deploy phase.
- Extend endpoint probe to classify textbook route body so route-mapping drift is detected early.

## Pass-2 Delta (Doctrine + Endpoint Hardening)

- Added doctrine retrieval skill chain and citation/provenance scripts in workspace (`skills/doctrine-engine/`).
- Added endpoint probe skill for operator handoff (`skills/openclaw-endpoint-kit/`).
- Added route-kind detection (`textbook-static` vs `openclaw-spa-shell`) to prevent false-positive textbook exposure checks.
- Captured new reusable pattern: `OP3NF1XER/patterns/RAILWAY_DEPLOY_PREFLIGHT_AND_ROUTE_PROBE.md`.

## Query Anchors

- `openclaw railway auth blocker`
- `decision_137 delivery manifest`
- `substack doctrine package workspace`
- `openclaw textbook route kind probe`
- `railway deploy preflight whoami status`

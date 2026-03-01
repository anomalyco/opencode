# DECISION_138 Restore Delta (2026-02-25)

## Decision Link

- `STR4TEG15T/memory/decisions/DECISION_138_OPENCLAW_RESTORE_MODE_AGENT_SOUL_AND_GATEWAY_TOKEN.md`

## Assimilated Truth

- Restore mode must preserve `_tmpbuild/clawdbot-railway-template` as a read-only anchor.
- Agent soul continuity can be preserved while adding runtime hardening by additive merge in workspace AGENTS.
- `1008 unauthorized: gateway token missing` can occur even when runtime is healthy; this is often client-side Control UI token state drift.

## Operational Evidence Anchors

- Railway deployment status: `3206cdc5-b7ba-4d19-a77a-c686a3530c5c` = `SUCCESS`.
- Gateway/channel health: `openclaw.health` reports `Telegram: ok (@Almastockbot)`.
- Token path verified: `gateway.auth.mode=token` and `gateway.remote.token` present.

## Query Anchors

- `openclaw restore mode read-only backup`
- `control ui 1008 gateway token missing`
- `gateway.remote.token paste in dashboard settings`
- `decision 138 soul merge runtime guard`

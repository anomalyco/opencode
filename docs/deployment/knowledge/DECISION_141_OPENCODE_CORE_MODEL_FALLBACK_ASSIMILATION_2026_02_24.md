# DECISION_141 OpenCode Core Model Fallback Assimilation (Learning Capture)

## What Changed

- OpenCode core now supports model-chain fallback directly in session execution.
- Agent config can define fallback chains via `agent.<name>.models`.
- Global fallback controls are now available under `fallback.*`.
- Runtime fallback actions are audit-logged to JSONL for forensic review.

## Reusable Deltas

1. **Core-first fallback pattern**
   - Put failover logic in core session loop (`SessionPrompt.loop`) instead of plugin-only background manager.
2. **Chain usability pattern**
   - Support both agent-local chains and global chain map to reduce config friction.
3. **Auditability pattern**
   - Log each fallback attempt as structured JSONL entry with action, model, attempt, and error type.
4. **Preferred-model rotation**
   - Promote last successful fallback model to chain head for faster subsequent recovery.

## Evidence Paths

- Core fallback module: `OP3NF1XER/opencode-dev/packages/opencode/src/session/model-fallback.ts`
- Core loop integration: `OP3NF1XER/opencode-dev/packages/opencode/src/session/prompt.ts`
- Config schema uplift: `OP3NF1XER/opencode-dev/packages/opencode/src/config/config.ts`
- Agent runtime uplift: `OP3NF1XER/opencode-dev/packages/opencode/src/agent/agent.ts`
- Tests:
  - `OP3NF1XER/opencode-dev/packages/opencode/test/session/model-fallback.test.ts`
  - `OP3NF1XER/opencode-dev/packages/opencode/test/config/config.test.ts`
  - `OP3NF1XER/opencode-dev/packages/opencode/test/agent/agent.test.ts`

## Query Anchors

- `opencode core model fallback chain`
- `session prompt failover audit log jsonl`
- `agent models fallback chains config`
- `decision 141 fallback assimilation`

## Decision Links

- Primary: `DECISION_141`
- Related: `DECISION_037`, `DECISION_100`, `DECISION_118`, `DECISION_121`, `DECISION_126`

# chat.model Hook — Progress & Testing Report

## Feature: Dynamic Model Routing via Plugin Hook

**PR**: [#18845](https://github.com/anomalyco/opencode/pull/18845)
**Issue**: [#18844](https://github.com/anomalyco/opencode/issues/18844)
**Branch**: `feat/plugin-chat-model-hook`
**Status**: Implementation complete, testing pending

---

## What's Implemented

### Core Infrastructure (3 files, 55 lines)

| File | Change | Status |
|------|--------|--------|
| `packages/plugin/src/index.ts` | Added `chat.model` hook type with `{ sessionID, agent, proposedModel, message }` | ✅ Complete |
| `packages/opencode/src/session/prompt.ts` | Fire hook before model resolution, persist routed model, extract message text | ✅ Complete |
| `packages/opencode/src/tool/task.ts` | Subagent model inheritance checks routed model before parent message model | ✅ Complete |

### Reference Plugin (1 file, 172 lines)

| File | Description | Status |
|------|-------------|--------|
| `packages/opencode/examples/plugins/token-optimizer.ts` | Cascading confidence router with 3-stage routing | ✅ Complete |

### Plugin Features

| Feature | Description | Status |
|---------|-------------|--------|
| Zero-cost heuristics | Regex catches greetings, short queries → free model | ✅ Implemented |
| Complexity estimation | Keyword scoring with 30min cache | ✅ Implemented |
| Config-based routing | Env vars: `TOKEN_OPTIMIZER_FREE_MODEL`, `TOKEN_OPTIMIZER_PREMIUM_MODEL` | ✅ Implemented |
| Per-prompt overrides | `!premium`, `!free`, `!think` prefixes | ✅ Implemented |
| De-escalation | Simple tasks on premium → route to free | ✅ Implemented |
| Escalation | Complex tasks on free → route to premium (opt-in) | ✅ Implemented |
| Subagent inheritance | Task tool inherits routed model from parent session | ✅ Implemented |
| Session persistence | Routed model persists across turns within session | ✅ Implemented |

---

## Testing Status

### Unit Tests

| Test | Status | Notes |
|------|--------|-------|
| `bun turbo typecheck` | ✅ Passes | 13/13 packages, no errors from our changes |

### Manual Testing

| Test | Status | Notes |
|------|--------|-------|
| Plugin loads without error | ✅ Verified | Logs show `loading plugin ...token-optimizer.ts` |
| `chat.model` hook fires before `chat.message` | ✅ Verified | Correct hook ordering confirmed |
| Hook receives correct `sessionID`, `agent`, `proposedModel`, `message` | ✅ Verified | All fields populated correctly |
| De-escalation: simple task on premium → free | ✅ Verified | "hello" on Claude → routed to Ollama |
| Escalation: complex task on free → premium | ✅ Verified | "implement JWT auth" → routed to Claude via OpenRouter |
| `!premium` override skips routing | ✅ Verified | Selected model used as-is |
| `!free` override forces free model | ✅ Verified | Routes to configured free model |
| Subagent model inheritance | ✅ Verified | Task tool uses routed model |
| Session model persistence | ✅ Verified | Routed model persists across turns |
| Hook receives message text for content-based routing | ✅ Verified | `message` field populated with user's prompt |

### Testing Pending

| Test | Status | Notes |
|------|--------|-------|
| `bun turbo typecheck` on CI | ⏳ Pending | Push to fork, CI runs automatically |
| E2E tests on CI | ⏳ Pending | Pre-existing flaky test in `session-review.spec.ts` (unrelated) |
| Heartbeat fallback (Ollama slow → Zen/OpenRouter free) | ⏳ Pending | Phase 3 feature |
| Copilot license integration | ⏳ Pending | Phase 4 feature |
| Savings tracking & display | ⏳ Pending | Phase 4 feature |
| Subagent orchestration (task decomposition) | ⏳ Pending | Phase 5 feature |

---

## Architecture

```
User Prompt
    │
    ▼
┌─────────────────────────────────────────────┐
│  OpenCode (packages/opencode/src/)           │
│                                              │
│  prompt.ts: fire chat.model hook             │
│    ├─ receives: { sessionID, agent,          │
│    │   proposedModel, message }              │
│    ├─ plugin returns: { model?: {            │
│    │   providerID, modelID } } or undefined  │
│    └─ persists routed model in session       │
│                                              │
│  task.ts: subagent model inheritance         │
│    └─ checks routedModel before parent       │
│       message model                          │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│  Plugin (user's .opencode/plugins/)          │
│                                              │
│  token-optimizer.ts: cascading router        │
│    ├─ Stage 1: Zero-cost heuristics (60%)    │
│    ├─ Stage 2: Complexity scoring (35%)      │
│    ├─ Stage 3: Config routing (5%)           │
│    └─ Overrides: !premium, !free, !think     │
└─────────────────────────────────────────────┘
    │
    ▼
LLM Response (from routed model)
```

---

## Configuration

```bash
# Required
export TOKEN_OPTIMIZER_FREE_MODEL=ollama/gpt-oss:20b-cloud
export TOKEN_OPTIMIZER_PREMIUM_MODEL=openrouter/anthropic/claude-sonnet-4

# Optional
export TOKEN_OPTIMIZER_DEESCALATE=true      # default: true
export TOKEN_OPTIMIZER_ESCALATE=false       # default: false
export TOKEN_OPTIMIZER_ENABLED=true         # default: true
export TOKEN_OPTIMIZER_COMPLEXITY_THRESHOLD=0.75  # default: 0.75
```

---

## Related Issues

- #18844 — This feature request
- #18667 — Plugin can change active model and have it stick
- #18666 — Plugin hook to update active model and have subagents inherit it
- #18644 — Dynamic Model Routing via Plugin Hook (closed as not planned — this PR implements it)
- #17870 — Subagent spawned via Task tool uses global config model instead of inheriting
- #6928 — Subtask commands do not inherit model

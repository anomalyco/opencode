# Architecture: Jules Provider Integration (DECISION_120 + DECISION_121)

## 0) Why Jules Does NOT Fit the Zen ProviderHelper Pattern

The existing Zen handler (`handler.ts:57`) assumes a **single HTTP request → token stream/response** flow:

1. Client sends chat completion body (Anthropic/OpenAI/OA-Compatible format)
2. `createBodyConverter` transforms between formats via `CommonRequest`
3. Single `fetch()` POST to provider endpoint
4. Stream chunks or parse JSON response
5. `createResponseConverter` transforms back to client format
6. Normalize usage for billing

Jules breaks every assumption:

| Zen Pattern | Jules Reality |
|---|---|
| Single request/response | Multi-step session lifecycle (create → poll → approve → poll → complete) |
| Token streaming via SSE | No token streaming; state changes via polling |
| Body format conversion (CommonRequest) | Not an LLM chat completion; task + repo + branch |
| Usage normalization for billing | No per-token billing; session-level cost (if any) |
| `ProviderHelper` interface | Needs `IJulesClient` with 6 distinct operations |
| `streamSeparator` / `createUsageParser` | Timeline events, not stream chunks |

**Decision**: Jules lives **alongside** the Zen adapter, not inside it. The `jules.ts` file in `provider/` contains shared types, the client interface, and the `normalizeJulesToRun()` pipeline. Separate route files handle the HTTP endpoints.

---

## 1) File Structure (Phase 1: Core Client)

```
packages/console/app/src/routes/
├── zen/
│   ├── util/
│   │   ├── handler.ts              # Existing Zen handler (unchanged)
│   │   └── provider/
│   │       ├── provider.ts          # Existing ProviderHelper + converters
│   │       ├── anthropic.ts         # Existing
│   │       ├── google.ts            # Existing
│   │       ├── openai.ts            # Existing
│   │       ├── openai-compatible.ts # Existing
│   │       └── jules.ts             # NEW: Types + Client + Normalizer
│   └── v1/
│       ├── messages.ts              # Existing (format: "anthropic")
│       ├── responses.ts             # Existing (format: "openai")
│       └── chat/completions.ts      # Existing (format: "oa-compat")
└── jules/                           # NEW: Jules-specific routes (Phase 1)
    ├── sessions.ts                  # POST /jules/sessions (create)
    ├── sessions/
    │   └── [id].ts                  # GET /jules/sessions/:id
    │   └── [id]/
    │       ├── activities.ts        # GET /jules/sessions/:id/activities
    │       ├── approve.ts           # POST /jules/sessions/:id/approve
    │       ├── reject.ts            # POST /jules/sessions/:id/reject
    │       └── cancel.ts            # POST /jules/sessions/:id/cancel
    └── watch.ts                     # Phase 2: POST/DELETE /jules/watch
```

---

## 2) jules.ts — Domain Module Contents

The `jules.ts` provider file contains **four concerns**, all pure/stateless:

### A. Jules API Types (wire format)
- `JulesStatus`: `QUEUED | PLANNING | AWAITING_PLAN_APPROVAL | IN_PROGRESS | COMPLETED | FAILED | CANCELLED`
- `JulesSessionResponse`, `JulesActivityResponse`, `JulesArtifactResponse`, `JulesPlan`

### B. IDE Run Model (normalized)
- `Run`, `RunPhase`, `RunEvent`, `RunPlanStep`, `Artifact`
- Maps Jules lifecycle to IDE-friendly states

### C. Client Interface (`IJulesClient`)
- `createSession(repoUrl, task, branch?, apiKey)` → `JulesSessionResponse`
- `getSession(sessionId, apiKey)` → `JulesSessionResponse`
- `listActivities(sessionId, apiKey)` → `JulesActivityResponse[]`
- `approvePlan(sessionId, apiKey)` → `JulesSessionResponse`
- `rejectPlan(sessionId, feedback, apiKey)` → `JulesSessionResponse`
- `cancelSession(sessionId, apiKey)` → `JulesSessionResponse`

### D. Normalizer Pipeline
- `normalizeJulesToRun(prev, input)` → `{ run, newEvents, changed }`
- Deduped timeline events, plan-to-todo mapping, artifact extraction
- Step evidence matcher (`upgradeStepsWithEvidence`)
- Keepalive generator (`generateTruthfulKeepalive`)

---

## 3) Polling Architecture (Phase 1: Client-Driven)

```
┌─────────────┐     POST /jules/sessions      ┌──────────────┐
│  IDE Client  │ ──────────────────────────────▶│  Jules Proxy │
│  (opencode)  │                                │  (stateless) │
│              │◀──────────────────────────────│              │
│              │     { id, status: QUEUED }      │              │
│              │                                │              │
│  Truth Loop  │     GET /jules/sessions/:id    │              │    GET sessions/:id
│  (poll every │ ──────────────────────────────▶│              │ ──────────────────▶ Jules API
│   5-10s)     │◀──────────────────────────────│              │◀──────────────────
│              │     { status, plan, artifacts } │              │
│              │                                └──────────────┘
│  normalizeJulesToRun(prev, session)
│  upgradeStepsWithEvidence(run)
│  generateTruthfulKeepalive(run, now)
│              │
│  Perception  │  (local 250-600ms ticker, no network)
│  Loop        │
└─────────────┘
```

### Poll cadence (from ADR):
- After create: `initialDelay = 2000ms`
- While `QUEUED/PLANNING`: `planningInterval = 5000ms`
- While `IN_PROGRESS`: `executionInterval = 10000ms`
- Hard caps: `maxDuration = 1h`, `maxPolls = 360`

---

## 4) Phase 2: SSE-Native Watcher (Future)

Phase 2 adds server-side polling with bus event publishing:

- `POST /jules/watch` → starts in-memory watcher
- Watcher polls Jules, diffs state, publishes `jules.*` bus events
- Client subscribes to `/event` SSE stream (existing OpenCode infrastructure)
- Events: `jules.run.created`, `jules.run.status`, `jules.run.plan`, `jules.run.activity`, `jules.run.artifact`, `jules.run.terminal`, `jules.run.warning`, `jules.run.error`
- No persistence: watchers are ephemeral (survive in memory only)

---

## 5) Truth-First UX Constraints (Hard Rules)

1. Timeline = truth stream only (status transitions, activities, artifacts)
2. Keepalive = UI-only, explicitly labeled "Status (UI)"
3. Never claim actions unless proven by artifact/activity event
4. `done_confirmed` only with evidence (artifact match or explicit activity)
5. `done_estimated` must be visually distinct from confirmed
6. Schema drift → `jules.run.warning` event with raw payload (never hide)

---

## 6) Relationship to Existing Codebase

| Concern | Existing Pattern | Jules Approach |
|---|---|---|
| Route entry | `zen/v1/messages.ts` calls `handler(input, {format})` | `jules/sessions.ts` calls Jules client directly |
| Auth | `handler.ts:authenticate()` via DB | Reuse same auth; Jules API key from user's BYOK credentials |
| Billing | `calculateCost()` per token | Phase 1: no per-token billing (session-level if needed) |
| Format conversion | `createBodyConverter` / `createResponseConverter` | N/A — Jules has its own request/response shapes |
| Streaming | `ReadableStream` + `pump()` in handler | N/A — polling produces `Run` snapshots, not stream chunks |
| Provider selection | `selectProvider()` hash-based load balancing | Direct — Jules is a single endpoint, no pool |

---

## 7) Implementation Order

### Phase 1 (this PR)
1. **`jules.ts`** — Types + Client interface + Normalizer + Keepalive generator
2. **Route stubs** — Stateless proxy routes (can be added incrementally)
3. **Tests** — Normalizer pipeline tests with mock Jules responses

### Phase 2 (follow-up)
1. **Watcher** — In-memory poll → bus event publisher
2. **SSE integration** — `jules.*` events over `/event`
3. **IDE panel** — Agentic Run UI consuming SSE events

---

## 8) References

- Specs 01-07 in `docs/specs/`
- GitHub Issues: #6627, #9649, #9650
- DECISION_120: Jules holds state; client drives lifecycle
- DECISION_121: Jules Agentic Run via OpenCode SSE
- Codemap: AI Provider Architecture (Unified Adapter Pattern)

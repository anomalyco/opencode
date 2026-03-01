# ARCHITECTURE: DECISION_120 — Google Jules AI Agent Integration

> **Decision**: DECISION_120_Google_Jules_Integration
> **From**: Pyxis (Strategist)
> **To**: Designer (Aegis)
> **Author**: Designer (Aegis)
> **Date**: 2026-03-01
> **Status**: INITIAL PROPOSAL — Awaiting Oracle Review

---

## Overview

Google Jules is a session-based AI coding agent (alpha) that operates on GitHub repositories. Unlike the existing streaming AI providers (Anthropic, OpenAI, Google Gemini, OA-Compatible), Jules uses a **REST + polling** model with **stateful sessions** following a defined lifecycle:

```
QUEUED → PLANNING → AWAITING_PLAN_APPROVAL → IN_PROGRESS → COMPLETED
```

This document addresses three architecture questions from Pyxis and recommends a file structure targeting `C0MMON/Infrastructure/Jules/`.

---

## Question 1: Client Pattern Fit — ProviderHelper Adapter vs. Standalone Client

### Analysis

The existing `ProviderHelper` interface (Trace 2e in the codemap) is designed around:

| ProviderHelper Assumption | Jules Reality |
|--------------------------|---------------|
| Single HTTP POST request/response | Session creation + multiple polling requests |
| Streaming via ReadableStream + chunk parsing | No streaming; REST polling with state transitions |
| `modifyUrl()` builds one endpoint | Multiple endpoints: create, get status, approve plan, list activities |
| `modifyBody()` transforms a chat completion body | Session body has repo URL, task description, not messages/tools |
| `normalizeUsage()` extracts token counts | Jules has no token-level usage; billing is session-based |
| `createUsageParser()` parses SSE chunks | No SSE; usage is per-session from final status |
| `streamSeparator` splits chunks | Not applicable |
| `createBinaryStreamDecoder()` for Bedrock | Not applicable |
| Stateless: one request → one response | Stateful: session persists across multiple requests |

### Recommendation: **Standalone Client (not ProviderHelper)**

**Rationale**: The ProviderHelper contract assumes streaming chat completions. Forcing Jules into this shape would require:
- Faking a `ReadableStream` that polls internally (leaky abstraction)
- Ignoring 6 of 8 ProviderHelper methods
- No natural place for session lifecycle management
- The `handler.ts` flow (authenticate → selectProvider → fetch → stream/respond) doesn't map to Jules' multi-step lifecycle

The ProviderHelper is excellent for what it does — format-agnostic streaming AI. Jules is a **task execution agent**, not a chat completion provider. Different domain, different client.

### What to Reuse from the Existing Architecture

| Reusable Component | How |
|-------------------|-----|
| **Authentication** (`handler.ts:458-580`) | Jules still needs workspace auth + API key validation |
| **BYOK pattern** (`handler.ts:406, 748-751`) | Users may bring their own Google API key for Jules |
| **Billing/cost tracking** (`handler.ts:762-808, 815-988`) | Adapt for session-based cost (not per-token) |
| **Provider config from KV** (`model.ts:85-128`) | Add Jules provider entry to KV config |
| **Error types** (`error.ts`) | Reuse `AuthError`, `CreditsError`, `ModelError` |

---

## Question 2: Session Polling Design

### Options Analysis

| Option | Pros | Cons |
|--------|------|------|
| **A) Blocking poll in JulesSessionManager** | Simple; caller waits for result | Blocks request; Cloudflare Worker timeout (30s); terrible UX |
| **B) Background service with event callbacks** | Non-blocking; real-time updates | Requires persistent compute (not CF Workers); complex state management |
| **C) Agent-driven explicit poll per decision lifecycle step** | Maps to Pantheon decision flow; no persistent infra; client controls pace | More round-trips; client must manage polling |

### Recommendation: **Option C — Agent-Driven Explicit Polling**

**Rationale**:

1. **Infrastructure fit**: Cloudflare Workers are stateless with 30s timeout. Jules sessions run for minutes to hours. No Worker can block that long.

2. **Decision lifecycle alignment**: Jules states map naturally to Pantheon decision steps:
   ```
   QUEUED          → Decision created, awaiting processing
   PLANNING        → Decision in analysis phase
   AWAITING_PLAN   → Decision requires Oracle/user approval
   IN_PROGRESS     → Decision executing
   COMPLETED       → Decision resolved with artifacts
   ```

3. **Client control**: The orchestrating agent (or user) polls when ready, handles approval gates explicitly, and can abort/timeout as needed.

4. **No new infrastructure**: Uses existing HTTP request patterns — just different endpoints per lifecycle step.

### Polling Flow

```
Agent                    Jules API Gateway              Google Jules API
  │                            │                              │
  ├── POST /jules/sessions ───►│── createSession() ──────────►│
  │◄── { sessionId, status } ──│◄── { id, status: QUEUED } ──│
  │                            │                              │
  │  (wait N seconds)          │                              │
  │                            │                              │
  ├── GET /jules/sessions/:id ►│── getSession() ─────────────►│
  │◄── { status: PLANNING }  ──│◄── { status, plan } ────────│
  │                            │                              │
  ├── GET /jules/sessions/:id ►│── getSession() ─────────────►│
  │◄── { status: AWAITING }  ──│◄── { status, plan } ────────│
  │                            │                              │
  ├── POST /jules/sessions/:id/approve ►│── approvePlan() ───►│
  │◄── { status: IN_PROGRESS } │◄── { status } ──────────────│
  │                            │                              │
  │  (poll until complete)     │                              │
  │                            │                              │
  ├── GET /jules/sessions/:id ►│── getSession() ─────────────►│
  │◄── { status: COMPLETED,    │◄── { artifacts, patches } ──│
  │     artifacts, patches }   │                              │
```

### Recommended Polling Parameters

```typescript
const POLL_CONFIG = {
  initialDelay: 2000,       // 2s after creation
  planningInterval: 5000,   // 5s while QUEUED/PLANNING
  executionInterval: 10000, // 10s while IN_PROGRESS
  maxDuration: 3600000,     // 1 hour hard timeout
  maxPolls: 360,            // safety cap
}
```

---

## Question 3: Entity Mapping — Jules Data Storage

### Options Analysis

| Option | Pros | Cons |
|--------|------|------|
| **A) Store full Jules JSON in MongoDB as-is** | Simple; no data loss; flexible queries | No Pantheon entity linkage; duplicate data model; hard to query across decisions |
| **B) Map to Pantheon entities** | Clean integration; queryable; linked to decisions | Lossy mapping; maintenance burden when Jules API changes |
| **C) Hybrid: Jules data + Pantheon wrapper** | Best of both; raw data preserved; linked to decisions | Slightly more complex; two layers to maintain |

### Recommendation: **Option C — Hybrid Storage**

**Rationale**:

1. **Preserve raw Jules data**: Jules is alpha. Their API will change. Storing raw JSON means we never lose data during schema evolution.

2. **Pantheon metadata wrapper**: Link Jules sessions to Decisions, track lifecycle, enable cross-entity queries.

3. **Layered access**: Raw data for debugging/replay, Pantheon entities for orchestration.

### Entity Model

```
┌─────────────────────────────────┐
│ JulesSession (Pantheon Wrapper) │
├─────────────────────────────────┤
│ id: string (Pantheon ID)        │
│ decisionId: string              │  ← Links to DECISION_XXX
│ workspaceId: string             │
│ julesSessionId: string          │  ← Google's session ID
│ status: JulesStatus             │
│ repoUrl: string                 │
│ taskDescription: string         │
│ createdAt: Date                 │
│ updatedAt: Date                 │
│ completedAt: Date | null        │
│ rawResponse: JSON               │  ← Full Jules API response
│ artifacts: JulesArtifact[]      │  ← Extracted for quick access
│ cost: number                    │  ← Session cost
└─────────────────────────────────┘
         │
         │ 1:N
         ▼
┌─────────────────────────────────┐
│ JulesActivity (Pantheon)        │
├─────────────────────────────────┤
│ id: string                      │
│ sessionId: string               │  ← FK to JulesSession
│ julesActivityId: string         │
│ type: string                    │
│ status: string                  │
│ rawData: JSON                   │  ← Full activity JSON
│ createdAt: Date                 │
└─────────────────────────────────┘
         │
         │ 1:N
         ▼
┌─────────────────────────────────┐
│ JulesArtifact (Pantheon)        │
├─────────────────────────────────┤
│ id: string                      │
│ activityId: string              │  ← FK to JulesActivity
│ type: "git_patch" | "pull_req"  │
│ title: string                   │
│ rawData: JSON                   │  ← Full artifact JSON
│ patchUrl: string | null         │
│ prUrl: string | null            │
│ createdAt: Date                 │
└─────────────────────────────────┘
```

---

## File Structure: `C0MMON/Infrastructure/Jules/`

```
C0MMON/Infrastructure/Jules/
├── IJulesClient.ts              # Interface: session CRUD + polling
├── JulesClient.ts               # Implementation: HTTP client for Jules API
├── JulesSessionManager.ts       # Lifecycle orchestration: create → poll → complete
├── JulesTypes.ts                # Type definitions: session, activity, artifact, status
├── JulesConfig.ts               # Configuration: API endpoints, polling params, timeouts
├── JulesEntityMapper.ts         # Maps Jules API responses → Pantheon entities
├── JulesAuthAdapter.ts          # Reuses existing auth/BYOK for Google credentials
└── README.md                    # Integration guide
```

---

## Interface Signatures

### IJulesClient.ts

```typescript
type JulesStatus = "QUEUED" | "PLANNING" | "AWAITING_PLAN_APPROVAL" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED"

type CreateSessionInput = {
  repoUrl: string
  task: string
  branch?: string
  apiKey: string
}

type JulesSessionResponse = {
  id: string
  status: JulesStatus
  plan?: JulesPlan
  activities?: JulesActivityResponse[]
  artifacts?: JulesArtifactResponse[]
  error?: string
}

type JulesPlan = {
  summary: string
  steps: string[]
}

type JulesActivityResponse = {
  id: string
  type: string
  status: string
  data: Record<string, unknown>
}

type JulesArtifactResponse = {
  id: string
  type: "git_patch" | "pull_request"
  title: string
  url?: string
  patch?: string
}

interface IJulesClient {
  createSession(input: CreateSessionInput): Promise<JulesSessionResponse>
  getSession(sessionId: string, apiKey: string): Promise<JulesSessionResponse>
  approvePlan(sessionId: string, apiKey: string): Promise<JulesSessionResponse>
  rejectPlan(sessionId: string, feedback: string, apiKey: string): Promise<JulesSessionResponse>
  cancelSession(sessionId: string, apiKey: string): Promise<void>
  listActivities(sessionId: string, apiKey: string): Promise<JulesActivityResponse[]>
}
```

### JulesSessionManager.ts

```typescript
type PollOptions = {
  initialDelay?: number
  interval?: number
  maxDuration?: number
  onStatusChange?: (status: JulesStatus) => void
  onPlanReady?: (plan: JulesPlan) => Promise<"approve" | "reject">
  planFeedback?: string
}

type SessionResult = {
  session: JulesSessionResponse
  artifacts: JulesArtifactResponse[]
  duration: number
  pollCount: number
}

interface IJulesSessionManager {
  executeSession(input: CreateSessionInput, opts?: PollOptions): AsyncGenerator<JulesSessionResponse, SessionResult>
  pollUntilStatus(sessionId: string, target: JulesStatus[], opts?: PollOptions): Promise<JulesSessionResponse>
}
```

### JulesAuthAdapter.ts

```typescript
// Reuses existing auth flow from handler.ts
// Extracts Google BYOK credentials from ProviderTable
// Falls back to system Jules API key from KV config

interface IJulesAuthAdapter {
  resolveApiKey(workspaceId: string, userId?: string): Promise<string>
  validateCredentials(apiKey: string): Promise<boolean>
}
```

### JulesEntityMapper.ts

```typescript
// Maps Jules API responses to Pantheon entity wrappers
// Preserves raw JSON in rawData/rawResponse fields

interface IJulesEntityMapper {
  toSession(response: JulesSessionResponse, decisionId: string, workspaceId: string): JulesSession
  toActivities(activities: JulesActivityResponse[], sessionId: string): JulesActivity[]
  toArtifacts(artifacts: JulesArtifactResponse[], activityId: string): JulesArtifact[]
}
```

---

## Integration with Existing Architecture

### How Jules Connects to the Provider Architecture

```
                 Existing Flow (Streaming AI)              Jules Flow (Task Agent)
                 ═══════════════════════════              ══════════════════════════

Client ──► /v1/messages ──► handler.ts          Client ──► /jules/sessions ──► JulesSessionManager
                │                                                │
          selectProvider()                                 JulesAuthAdapter
                │                                     (reuses authenticate() pattern)
          ProviderHelper                                       │
      (modifyUrl, modifyBody,                            JulesClient
       streaming, usage)                              (createSession, poll,
                │                                      approve, artifacts)
          fetch() → stream                                     │
                │                                        JulesEntityMapper
          normalizeUsage()                              (raw → Pantheon entities)
                │                                              │
          calculateCost()                               Cost tracking
          trackUsage()                                  (session-based)
```

### Shared Infrastructure

- **Authentication**: Same `KeyTable` + `BillingTable` + `ProviderTable` joins
- **BYOK**: Same `ProviderTable.credentials` for Google API keys (byokProvider: "google")
- **KV Config**: Add Jules provider entry alongside existing providers
- **Billing**: Adapt `trackUsage()` for flat session cost instead of per-token
- **Error types**: Reuse `AuthError`, `CreditsError`, `ModelError`

### What NOT to Share

- **ProviderHelper interface**: Wrong abstraction for Jules
- **Streaming infrastructure**: `ReadableStream`, `pump()`, `streamSeparator`
- **Format converters**: `createBodyConverter()`, `createResponseConverter()` — Jules doesn't speak Anthropic/OpenAI format
- **Usage parsing**: `createUsageParser()` — Jules doesn't emit SSE usage chunks

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Jules API is alpha — breaking changes likely | **High** | Hybrid storage preserves raw JSON; client interface abstracts API details |
| Session timeouts on long tasks | **Medium** | Configurable maxDuration; agent-driven polling means no Worker timeout |
| Google rate limits on polling | **Medium** | Exponential backoff in poll intervals; respect Retry-After headers |
| BYOK key scope — Jules may need different OAuth scopes | **Medium** | JulesAuthAdapter validates credentials separately from Gemini BYOK |
| Cost tracking without token granularity | **Low** | Session-based flat cost; can refine when Jules provides token usage |
| No streaming means slower perceived UX | **Low** | Status change callbacks provide progress indicators |

---

## Implementation Phases

### Phase 1: Core Client (Complexity: Medium)
- `JulesTypes.ts` — type definitions
- `JulesConfig.ts` — configuration
- `IJulesClient.ts` + `JulesClient.ts` — HTTP client
- **Dependencies**: None (standalone)
- **Estimated effort**: 3 units

### Phase 2: Session Management (Complexity: Medium)
- `JulesSessionManager.ts` — lifecycle orchestration with AsyncGenerator
- **Dependencies**: Phase 1
- **Estimated effort**: 3 units

### Phase 3: Pantheon Integration (Complexity: High)
- `JulesAuthAdapter.ts` — wire into existing auth
- `JulesEntityMapper.ts` — entity mapping
- API routes for Jules endpoints
- KV config entries for Jules provider
- **Dependencies**: Phase 1, Phase 2, existing auth infrastructure
- **Estimated effort**: 5 units

### Phase 4: Billing Integration (Complexity: Medium)
- Adapt `trackUsage()` for session-based costs
- Add Jules cost entries to `UsageTable`
- **Dependencies**: Phase 3
- **Estimated effort**: 2 units

### Parallel Workstreams

```
Stream A: Phase 1 → Phase 2     (Client + SessionManager)
Stream B: Phase 3                (Auth + Entity mapping — can start types early)
          ↓
       Merge A+B → Phase 4      (Billing)
```

---

## Summary of Recommendations

| Question | Answer | Rationale |
|----------|--------|-----------|
| **Q1: ProviderHelper or standalone?** | **Standalone client** | ProviderHelper assumes streaming chat completions; Jules is a stateful task agent |
| **Q2: Polling approach?** | **C) Agent-driven explicit polling** | Maps to decision lifecycle; no persistent infra; CF Worker compatible |
| **Q3: Entity storage?** | **C) Hybrid** | Raw Jules JSON preserved + Pantheon metadata wrapper for linkage |

---

RESEARCH SUMMARY:
- Full codemap analysis of existing provider architecture (9 traces, 45 locations)
- ProviderHelper interface has 8 methods, 6 are inapplicable to Jules
- Google's existing provider (google.ts) is streaming-oriented, not a precedent for Jules
- Existing auth/BYOK/billing infrastructure is reusable with minor adaptation

ARCHITECTURE PROPOSAL:
- Standalone Jules client at C0MMON/Infrastructure/Jules/
- 8 files: client interface, implementation, session manager, types, config, entity mapper, auth adapter, README
- AsyncGenerator-based polling with configurable intervals
- Hybrid entity storage preserving raw API responses

IMPLEMENTATION PLAN:
- 4 phases, 2 parallel streams, ~13 effort units total
- Phase 1+2 (client) independent of Phase 3 (integration)
- Phase 4 (billing) depends on merge

ORACLE CONSULTATION NEEDED:
- Approval % on standalone vs adapter approach
- Validation of hybrid storage vs pure Pantheon entity mapping
- Risk assessment on Jules alpha API stability

RISKS & CONSIDERATIONS:
- Jules API instability (alpha) — mitigated by hybrid storage + abstraction layer
- No streaming UX — mitigated by status callbacks
- CF Worker timeout — mitigated by agent-driven polling (no long-running Workers)

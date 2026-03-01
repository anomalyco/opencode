---
prompt_id: PROMPT_AEGIS_DECISION_120_UPDATE
to: Aegis (Designer)
from: Pyxis (Strategist)
date: 2026-03-01
decision: DECISION_120
subject: Jules Integration Architecture Update - Internal P4NTHE0N Implementation
---

# Aegis: DECISION_120 Architecture Update Required

## Context

DECISION_120 has evolved from an external OpenCode PR approach to an **internal P4NTHE0N implementation** with a two-phase architecture. The research is complete (7 documents in `C0MMON/Infrastructure/Jules/refs/`), and we need your architectural guidance updated for the internal implementation.

## Current State

**Research Complete:**
- Location: `C0MMON/Infrastructure/Jules/refs/`
- 7 documents covering: Provider architecture, API normalization, UX design, Event taxonomy, UI structure, SSE integration, Architecture decision

**Key Research Findings:**
1. **ProviderHelper is wrong abstraction** - Jules is stateful task agent, not streaming chat completion
2. **Standalone client required** - 6 of 8 ProviderHelper methods inapplicable
3. **Two-phase architecture** - Phase 1 (stateless proxy) → Phase 2 (SSE-native watcher)
4. **Truth-first UX** - Events are truth; UI keepalive explicitly labeled
5. **GitHub alignment** - Addresses issues #6627, #9649, #9650

## What Needs Update

### 1. Architecture Document Location
**Current:** `C0MMON/Infrastructure/Jules/docs/ARCHITECTURE_DECISION_120_Jules_Integration.md`
**Status:** Initial proposal (456 lines)
**Needs:** Update for internal P4NTHE0N implementation

### 2. Key Changes from External to Internal

| Aspect | External PR (Old) | Internal P4NTHE0N (New) |
|--------|-------------------|-------------------------|
| **Location** | `packages/console/app/src/lib/jules/` | `C0MMON/Infrastructure/Jules/` |
| **Storage** | Stateless (no persistence) | MongoDB (full Pantheon entities) |
| **Events** | None (client polling) | SSE via Pantheon event bus |
| **Auth** | x-goog-api-key header only | JulesAuthAdapter (BYOK pattern) |
| **Entities** | Raw Jules JSON only | Hybrid: raw + Pantheon wrapper |
| **Integration** | Hono routes only | Full Pantheon decision lifecycle |
| **UI** | None (API only) | Agentic Run panel (Solid/TSX) |

### 3. Target File Structure (Updated)

```
C0MMON/Infrastructure/Jules/
├── Phase 1: Core Client
│   ├── IJulesClient.ts              # Interface
│   ├── JulesClient.ts               # HTTP implementation
│   ├── JulesSessionManager.ts       # Lifecycle orchestration
│   ├── JulesTypes.ts                # Type definitions
│   ├── JulesConfig.ts               # Configuration
│   ├── JulesEntityMapper.ts         # API → Pantheon mapping
│   └── JulesAuthAdapter.ts          # Auth integration
│
├── Phase 2: SSE-Native
│   ├── JulesWatcher.ts              # In-memory poller
│   ├── JulesEventTypes.ts           # jules.* event taxonomy
│   └── JulesEventBusIntegration.ts  # Event bus wiring
│
└── README.md

C0MMON/Entities/
├── JulesSession.cs                  # Pantheon wrapper
├── JulesActivity.cs                 # Activity entity
└── JulesArtifact.cs                 # Artifact entity

C0MMON/Infrastructure/Persistence/Repos/
├── RepoJulesSession.cs
├── RepoJulesActivity.cs
└── RepoJulesArtifact.cs
```

### 4. Architecture Questions for Aegis

**Q1: Entity Mapping Strategy**
The research recommends "Hybrid Storage" (Option C):
- Raw Jules JSON preserved (alpha API stability)
- Pantheon metadata wrapper (decision linkage)

Confirm:
- Entity structure for JulesSession/JulesActivity/JulesArtifact
- MongoDB collection naming (JULES_SES5ION?)
- Foreign key relationships (decisionId, workspaceId)

**Q2: Event Bus Integration**
Phase 2 requires publishing `jules.*` events to Pantheon event bus:

```typescript
// Event taxonomy from research
jules.run.created
jules.run.status
jules.run.plan
jules.run.activity
jules.run.artifact
jules.run.warning
jules.run.error
jules.run.terminal
```

Confirm:
- Integration with existing InMemoryEventBus
- Event payload structure (include openCodeSessionID for filtering)
- SSE endpoint compatibility (future `/event` endpoint)

**Q3: Session Manager Pattern**
Research recommends AsyncGenerator for polling:

```typescript
interface IJulesSessionManager {
  executeSession(input, opts): AsyncGenerator<JulesSessionResponse, SessionResult>
  pollUntilStatus(sessionId, targets, opts): Promise<JulesSessionResponse>
}
```

Confirm:
- Pattern fits Pantheon decision lifecycle
- Error handling strategy (fail visible)
- Cancellation/timeout support

**Q4: UI Architecture**
Agentic Run panel requires:
- Timeline (truth stream)
- Plan → To-Do list
- Artifact viewer
- Keepalive indicator (explicitly labeled)

Confirm:
- UI location (H4ND/UI/AgenticRun/?)
- Component structure (Solid/TSX)
- State management (local store vs global)

**Q5: Polling Parameters**
Research recommends:

```typescript
const POLL_CONFIG = {
  initialDelay: 2000,       // 2s after creation
  planningInterval: 5000,   // 5s while QUEUED/PLANNING
  executionInterval: 10000, // 10s while IN_PROGRESS
  maxDuration: 3600000,     // 1 hour hard timeout
  maxPolls: 360,            // safety cap
}
```

Confirm:
- Values appropriate for Pantheon use cases
- Configurable per-workspace?
- Backoff strategy for rate limits

## Deliverables

1. **Updated Architecture Document**
   - Location: `C0MMON/Infrastructure/Jules/docs/ARCHITECTURE_DECISION_120_Jules_Integration.md`
   - Reflect internal P4NTHE0N implementation
   - Include Phase 1 and Phase 2

2. **Entity Relationship Diagram**
   - JulesSession → JulesActivity → JulesArtifact
   - Foreign keys to Decision, Workspace
   - MongoDB collection schema

3. **Event Flow Diagram**
   - Jules API → Watcher → Event Bus → SSE → UI
   - Include reconnect resilience

4. **Interface Definitions**
   - IJulesClient (complete)
   - IJulesSessionManager (complete)
   - IJulesWatcher (Phase 2)

5. **UI Component Structure**
   - AgenticRunPanel hierarchy
   - Props/interfaces for each component

## Research References

**Location:** `C0MMON/Infrastructure/Jules/refs/`

Read in order:
1. `01-NOTES_AI_Provider_Architecture.md` - Why ProviderHelper doesn't fit
2. `02-NOTES_normalizeJulesToRun.md` - Decision lifecycle mapping
3. `04-NOTES_Thinking_Pipeline.md` - Event taxonomy
4. `06-SPEC-SSE_Parallel_to_Planned_Feature.md` - SSE integration spec
5. `07-ADR-Jules_Agentic_Run.md` - Architecture decision record

## GitHub Context

**Issues Addressed:**
- #6627: Delegate to Coding Agent? (Primary)
- #9649: Multi-Agent Coding (Secondary)
- #9650: SSE sessionID Filter (Related)

**Future Contribution:**
After internal validation, we may contribute patterns back to OpenCode.

## Constraints

1. **MongoDB available** - Full persistence, not stateless
2. **Event bus exists** - InMemoryEventBus in C0MMON
3. **Pantheon entities** - Must link to Decision lifecycle
4. **Truth-first UX** - No false positives, events are truth
5. **Two-phase delivery** - Phase 1 first, Phase 2 after validation

## Questions for Aegis

1. Confirm hybrid entity storage approach (raw + wrapper)
2. Validate event bus integration pattern
3. Approve AsyncGenerator for session polling
4. Specify UI component location and structure
5. Confirm polling parameter defaults
6. Identify any architectural risks not covered

---

**Decision Status:** Approved → Implementation Ready
**Next Step:** Aegis architecture update → WindFixer implementation
**Timeline:** Phase 1 (core client) → Phase 2 (SSE-native)

**Contact:** Pyxis (Strategist)
**Research:** `C0MMON/Infrastructure/Jules/refs/`
**Current Architecture:** `C0MMON/Infrastructure/Jules/docs/ARCHITECTURE_DECISION_120_Jules_Integration.md`

---

*Prompt prepared by:* Pyxis (Strategist)
*Date:* 2026-03-01
*Decision:* DECISION_120
*Status:* Awaiting Aegis architecture update

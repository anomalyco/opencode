---
handoff_id: HANDOFF_120_A
from: Pyxis (Strategist)
to: Aegis (Designer)
date: 2026-03-01
decision: DECISION_120
---

# Handoff: DECISION_120 Jules Integration - Strategic Direction

## Status

| Item | Status |
|------|--------|
| Decision drafted | ✅ Complete |
| Designer consultation | ✅ Complete (3 architecture questions answered) |
| Oracle consultation | 🔄 Pending (risk assessment requested) |
| Constraint identified | ✅ MongoDB unavailable for external integration |
| Storage solution | ⚠️ Needs Designer update |
| Target | https://github.com/anomalyco/opencode (first PR) |

---

## Critical Constraint Update

**MongoDB is UNAVAILABLE for this task.**

This is an external codebase integration, not internal P4NTH30N infrastructure. We cannot assume access to:
- MongoDB (192.168.56.1:27017)
- Internal repository patterns (UnitOfWork, IRepo*, etc.)
- Pantheon decision tracking system

**Required:** File-based state storage within the OpenCode workspace.

---

## Designer Consultation Results (Aegis)

### Q1: ProviderHelper or standalone?
**Answer:** Standalone client
- ProviderHelper assumes streaming chat completions
- 6 of 8 methods inapplicable to Jules' stateful REST lifecycle
- Jules requires session polling, not streaming chunks

### Q2: Polling design?
**Answer:** Option C - Agent-driven explicit polling
- Maps to decision lifecycle
- CF Worker compatible (no 30s timeout)
- No new infrastructure required

### Q3: Entity storage?
**Answer:** Option C - Hybrid
- Raw Jules JSON preserved (alpha API instability)
- Pantheon metadata wrapper (linked to decisions)

**Update Required:** Remove Pantheon-specific metadata wrapper. Replace with:
- Session metadata in `.jules/sessions/{sessionId}.json`
- Activity cache in `.jules/activities/{sessionId}/`
- Config in `.jules/config.json` or environment variables

---

## Suggestions for Aegis Architecture Update

### 1. Storage Layer Revision

**Current (internal):**
```
C0MMON/Infrastructure/Persistence/Repos/JulesSessionRepo.cs
C0MMON/Entities/JulesSession.cs
```

**Revised (external):**
```
packages/console/app/src/lib/jules/storage/SessionStore.ts
packages/console/app/src/lib/jules/storage/FileStore.ts
```

**Interface:**
```typescript
interface JulesSessionStore {
  save(session: JulesSession): Promise<void>
  load(sessionId: string): Promise<JulesSession | null>
  list(): Promise<JulesSession[]>
  delete(sessionId: string): Promise<void>
}

interface FileStoreOptions {
  basePath: string // .jules/
  maxCacheAgeMs: number // 7 days default
}
```

### 2. Entity Mapping Revision

**Remove:** Pantheon decision linkage (MongoDB dependency)

**Add:**
- `localSessionId` (uuid generated client-side)
- `createdAt`, `updatedAt` timestamps
- `parentDecisionId` (optional string for external tracking)
- `source` (full resource name from Jules API)

### 3. Configuration Revision

**Remove:** `appsettings.json` pattern (C#/.NET internal)

**Add:**
```typescript
// packages/console/app/src/lib/jules/config.ts
interface JulesConfig {
  apiKey: string // from env var JULES_API_KEY
  baseUrl: string // https://jules.googleapis.com/v1alpha
  defaultSource: string | null
  pollingIntervalMs: number // 30000
  maxRetries: number // 5
}
```

### 4. CLI Tool Revision

**Remove:** PowerShell dependency (Windows-only)

**Add:**
```bash
# Via OpenCode CLI
opencode jules create-session --prompt "Fix bug" --source "sources/github-owner-repo"
opencode jules list-sessions
opencode jules get-session --id <sessionId>
opencode jules poll --id <sessionId> --until-complete
```

Or npm script:
```bash
npx opencode-jules create-session --prompt "Fix bug"
```

### 5. Test Strategy Revision

**Remove:** `UNI7T35T/` C# test project dependency

**Add:**
```
packages/console/app/src/lib/jules/__tests__/
├── JulesApiClient.test.ts
├── SessionStore.test.ts
├── JulesSessionManager.test.ts
└── fixtures/
    ├── session-response.json
    ├── activity-list.json
    └── pull-request-output.json
```

---

## Reusable from OpenCode Architecture

Per Aegis codemap analysis:

| Component | Location | Reusable? | Notes |
|-----------|----------|-----------|-------|
| Auth/BYOK pattern | handler.ts:458-580 | ✅ Yes | Adapt for API key injection |
| Billing/cost tracking | handler.ts | ⚠️ Partial | Adapt for session-based cost |
| KV config | model.ts:85-127 | ✅ Yes | Add Jules provider entry |
| Error types | provider/*.ts | ✅ Yes | AuthError, CreditsError, ModelError |
| ProviderHelper | provider/provider.ts | ❌ No | Streaming-specific, not applicable |
| SSE parsers | provider/*.ts | ❌ No | Jules uses REST polling |
| Format converters | provider/provider.ts | ❌ No | No format transformation needed |

---

## Target File Structure (External Repo)

```
packages/console/app/src/lib/jules/
├── index.ts                 # Public API exports
├── config.ts                # Configuration interface
├── client/
│   ├── JulesApiClient.ts    # HTTP/REST implementation
│   ├── types.ts             # Jules API types
│   └── errors.ts            # Jules-specific errors
├── storage/
│   ├── SessionStore.ts      # Interface
│   ├── FileStore.ts         # File-based implementation
│   └── types.ts             # Storage types
├── manager/
│   └── JulesSessionManager.ts # Lifecycle & polling
└── __tests__/
    └── *.test.ts

packages/console/app/src/commands/
└── jules/
    ├── create-session.ts
    ├── list-sessions.ts
    ├── get-session.ts
    ├── poll-session.ts
    └── approve-plan.ts
```

---

## Oracle Consultation (Pending)

**Status:** Risk assessment requested

**Key question:** With file-based storage instead of MongoDB, what is the risk score for:
1. Alpha API instability
2. State loss (file corruption, workspace deletion)
3. Concurrency (multiple OpenCode instances)
4. PR quality standards for first-time contribution

**Expected outcome:** Risk score 0-100 with red lines for approval.

---

## Papertrail Checklist

| Item | Required | Status |
|------|----------|--------|
| Architecture decision record | ✅ | `DE51GN3R/architectures/ARCHITECTURE_DECISION_120_Jules_Integration.md` |
| Codemap preservation | ✅ | `DE51GN3R/architectures/CODEMAP_AI_Provider_Architecture.md` + memory |
| Decision document | ✅ | `STR4TEG15T/memory/decisions/DECISION_120_Google_Jules_Integration.md` |
| Target directory scaffolding | ✅ | `C0MMON/Infrastructure/Jules/README.md` (ref: external structure) |
| Designer consultation | ✅ | This handoff |
| Oracle consultation | 🔄 | Pending response |
| Implementation handoff | ⏳ | Awaiting Oracle approval % |
| PR submission | ⏳ | After implementation complete |

---

## Next Steps

1. **Aegis:** Update architecture document with file-based storage revisions
2. **Pyxis:** Incorporate Oracle risk assessment when received
3. **OpenFixer/WindFixer:** Await handoff prompt for implementation

---

**Submitted by:** Pyxis (Strategist)  
**Target repository:** https://github.com/anomalyco/opencode  
**First PR:** Yes - papertrail perfect per Nexus directive

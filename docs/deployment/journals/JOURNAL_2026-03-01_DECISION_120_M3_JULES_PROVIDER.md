# Deployment Journal: DECISION_120 Milestone 3 — Jules Provider Implementation

**Date**: 2026-03-01  
**Agent**: OpenFixer (Designer role)  
**Decision**: DECISION_120 — Google Jules AI Agent Integration  
**Milestone**: 3 (Phase 1 Core Implementation)  
**Status**: ✅ Complete  
**Branch**: `chasing-jules`

---

## Summary

Implemented the Jules provider domain module (`jules.ts`) — the core TypeScript file containing all types, the client interface, the normalizer pipeline, the evidence matcher, and the keepalive generator. This is a pure, zero-dependency module (no external imports) that forms the foundation for all Phase 1 proxy routes and Phase 2 SSE watcher.

---

## Deliverables Completed

### 1. Jules API Wire Types (lines 14-50)

Exported types matching the Jules REST API surface:

- `JulesStatus` — 7-member union: `QUEUED | PLANNING | AWAITING_PLAN_APPROVAL | IN_PROGRESS | COMPLETED | FAILED | CANCELLED`
- `JulesPlan` — `{ summary, steps[] }`
- `JulesActivityResponse` — `{ id, type, status, data }`
- `JulesArtifactResponse` — `{ id, type: "git_patch" | "pull_request", title, url?, patch? }`
- `JulesSessionResponse` — `{ id, status, plan?, activities?, artifacts?, error? }`

### 2. IDE Run Model (lines 56-105)

Provider-agnostic normalized model for the IDE:

- `RunPhase` — 7 phases mapping 1:1 from `JulesStatus`
- `RunEvent` — `{ eventId, at, source, level, title, detail?, raw? }`
- `Artifact` — discriminated union: `git_patch | pull_request`
- `RunPlanStep` — `{ text, state: "pending" | "active" | "done_confirmed" | "done_estimated", evidence? }`
- `Run` — full session state: phase, providerState, timestamps, plan, timeline, artifacts

### 3. Poll Configuration (lines 111-117)

ADR-aligned constants:

- `initialDelay`: 2000ms
- `planningInterval`: 5000ms
- `executionInterval`: 10000ms
- `maxDuration`: 3,600,000ms (1 hour)
- `maxPolls`: 360

### 4. Client Interface (lines 130-137)

`IJulesClient` with 6 operations:

- `createSession(args)` → `JulesSessionResponse`
- `getSession(sessionId, apiKey)` → `JulesSessionResponse`
- `listActivities(sessionId, apiKey)` → `JulesActivityResponse[]`
- `approvePlan(sessionId, apiKey)` → `JulesSessionResponse`
- `rejectPlan(sessionId, feedback, apiKey)` → `JulesSessionResponse`
- `cancelSession(sessionId, apiKey)` → `JulesSessionResponse`

### 5. Normalizer Pipeline — `normalizeJulesToRun()` (lines 158-240)

Core transformation function: `(prev: Run | undefined, input: NormalizeInput) → NormalizeOutput`

5-step pipeline:
1. **Status → phase**: Detects transitions, emits status events, sets `endedAt` on terminal
2. **Plan → to-do list**: Upserts plan steps, preserves prior step states across updates
3. **Activities → timeline**: Dedupes by `act:{id}`, normalizes title/detail/level from `data`
4. **Artifacts → artifacts list**: Dedupes by `art:{id}`, creates typed `Artifact` entries
5. **Active step heuristic**: Prefers `stepIndex` from activity data, falls back to first pending

All changes tracked via `changed` flag and `newEvents` array for downstream consumers.

### 6. Evidence Matcher — `upgradeStepsWithEvidence()` (lines 246-269)

Confirms plan steps only with proof:

- Extracts files from `git_patch` artifacts (`diff --git a/... b/...` parsing)
- Scores step text against artifact texts (token overlap: 3 pts per hit)
- Scores step text against activity texts (same algorithm, threshold 12)
- Scores file matches: exact filename = 10 pts, directory match = 6 pts
- Upgrades to `done_confirmed` only when score ≥ 10 with evidence ID

### 7. Keepalive Generator — `generateTruthfulKeepalive()` (lines 288-406)

Phase-aware UI keepalive with truth-only confidence:

- Always emits: poll countdown, truth age, run metadata
- Phase-specific lines: queued (task display), planning (plan draft), awaiting_approval (review prompt), executing (active step or plan summary), completed (artifact count), failed (error), cancelled
- Rotation cadence: planning 1300ms, executing 1200ms, awaiting_approval 1800ms, default 2000ms
- Deduplication by line ID

### 8. Internal Helpers (lines 412-754)

23 internal functions supporting the pipeline:

- `initOrClone` — deep-clones `Run` for immutable updates
- `statusToPhase`, `statusTitle`, `statusToLevel` — status mapping
- `isTerminal` — terminal phase detection
- `appendEvent` — deduplicated event insertion
- `upsertPlan`, `findStep` — plan lifecycle with step state preservation
- `normalizeActivityEvent`, `activityLevel`, `readString` — activity normalization
- `upsertArtifact` — artifact dedup + event emission
- `setActiveStep`, `activityStepIndex` — step tracking heuristic
- `extractFilesFromPatches` — git diff header parsing
- `scoreAgainstArtifacts`, `scoreAgainstTexts`, `scoreFileMatch` — evidence scoring
- `overlapScore`, `tokenize`, `norm`, `containsToken` — text analysis
- `dedupeStrings`, `dedupeById` — collection utilities
- `getActiveStepText`, `shortRepo`, `truncate` — keepalive helpers

### 9. Exported Utilities (lines 760-767)

- `computeNextPollAt(status, now)` — returns next poll timestamp based on status
- `isTerminalPhase(phase)` — boolean check for terminal phases

---

## Code Quality

- **Zero external imports** — pure TypeScript, no dependencies
- **2-space indentation** — matches project convention (google.ts, provider.ts, etc.)
- **No `any` types** — single cast to `Record<string, unknown>` for artifact URL access
- **No `try`/`catch`** — pure functions, no error swallowing
- **Early returns** — no `else` blocks, per AGENTS.md style guide
- **`const` only** — no `let` reassignment except loop counters and accumulator flags
- **813 lines** — comprehensive but focused on a single domain module

---

## Files Created

| File | Size | Purpose |
|------|------|---------|
| `packages/console/app/src/routes/zen/util/provider/jules.ts` | 813 lines | Jules provider domain module |

---

## Dependencies on Prior Milestones

- **M1 (Specs)**: Types and contracts from specs 01-04 implemented verbatim
- **M2 (Architecture)**: Standalone client decision; `jules.ts` lives in `provider/` without implementing `ProviderHelper`

---

## What's Next (Not in This Milestone)

### Phase 1 Remaining
- Stateless proxy route stubs under `routes/jules/`
- Normalizer pipeline unit tests with mock Jules responses
- Keepalive forbidden-verb scan test

### Phase 2 (Follow-up PR)
- In-memory watcher: poll → diff → bus event publisher
- SSE integration: `jules.*` events over `/event`
- Agentic Run IDE panel consuming SSE events

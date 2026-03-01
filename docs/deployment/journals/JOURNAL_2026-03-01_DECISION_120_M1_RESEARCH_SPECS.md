# Deployment Journal: DECISION_120 Milestone 1 — Research & Specifications

**Date**: 2026-03-01  
**Agent**: OpenFixer (Designer role)  
**Decision**: DECISION_120 — Google Jules AI Agent Integration  
**Milestone**: 1 (Research & Specifications)  
**Status**: ✅ Complete  
**Branch**: `chasing-jules`

---

## Summary

Completed the research and specification phase for Jules integration into OpenCode. Produced 7 specification documents covering the full domain: data model, normalization pipeline, keepalive generator, thinking pipeline UI, TSX skeleton, SSE event spec, and the ADR. These documents define the canonical contracts that all subsequent implementation milestones depend on.

---

## Deliverables Completed

### 1. Canonical IDE Data Model (`docs/specs/01-NOTES_AI_Provider_Architecture.md`)

- Defined `Run`, `RunPhase`, `RunEvent`, `Artifact`, `RunPlanStep` types
- Mapped `JulesStatus` → `RunPhase` (7 states → 7 phases)
- Specified polling algorithm (truth loop) with ADR-aligned cadence
- Defined plan-to-todo list mapping and activity normalization
- Established minimal integration contract for the IDE

### 2. Normalizer Pipeline (`docs/specs/02-NOTES_normalizeJulesToRun.md`)

- Full TypeScript implementation spec for `normalizeJulesToRun()`
- Defined `JulesSessionResponse`, `JulesActivityResponse`, `JulesArtifactResponse` wire types
- Specified deduplication strategy (eventId-based for timeline, id-based for artifacts)
- Helper functions: `statusToPhase`, `appendEvent`, `upsertPlan`, `normalizeActivityEvent`, `upsertArtifact`, `setActiveStep`
- Utility functions: `arrayEq`, `activityTitle`, `readString`, `artifactFromJules`

### 3. Keepalive Generator (`docs/specs/03-NOTES_keepalive copy generator.md`)

- Contract for `generateTruthfulKeepalive()` — UI-only perception loop
- `KeepaliveLine` and `KeepaliveOutput` type definitions
- Hard rules: allowed facts vs forbidden claims (no "success theater")
- Phase-aware line generation with rotation cadence per phase
- Reference implementation with truth-only confidence

### 4. Thinking Pipeline UI (`docs/specs/04-NOTES_Thinking_Pipeline.md`)

- UI layout: run header, plan/to-do split, timeline, action bar, keepalive lane
- "Truthy, agentic, zero theater" copy style guide
- Step evidence matcher spec (`upgradeStepsWithEvidence()`)
- Scoring: file match (10 pts), directory match (6 pts), token overlap (3 pts/hit)
- Component tree and page state diagram
- Controller pseudo-code wiring truth loop + perception loop

### 5. Agentic Run TSX Skeleton (`docs/specs/05-NOTES_agentic_run_page_jules_tsx_skeleton.md`)

- Full single-file TSX skeleton (1431 lines) with mock Jules client
- `MockJulesClient` with state progression (QUEUED → COMPLETED lifecycle)
- `useJulesRunController` hook: start, poll, approve, reject, cancel, reset
- UI components: Badge, RunHeader, PlanPanel, TimelinePanel, ActionBar, KeepaliveBar
- Two-loop UX demo: truth polling + perception keepalive ticker

### 6. SSE Event Specification (`docs/specs/06-SPEC-SSE_Parallel_to_Planned_Feature.md`)

- Two-loop design: truth loop (server watcher → SSE) + perception loop (client keepalive)
- Endpoint definitions: Phase 1 proxy routes + Phase 2 watcher control
- Event taxonomy: `jules.run.created/status/plan/terminal` + `jules.run.activity/artifact` + `jules.run.warning/error`
- Common event properties: `openCodeSessionID`, `julesSessionID`, `watchID`, `directory`
- Watcher behavior: polling cadence, diffing/dedupe rules, failure modes
- Client responsibilities: SSE subscription, store model, UI rendering rules

### 7. Architecture Decision Record (`docs/specs/07-ADR-Jules_Agentic_Run.md`)

- Phased approach: Phase 1 (stateless proxy) → Phase 2 (SSE-native watcher)
- Truth-first UX rules codified
- References to GitHub issues: #6627, #9649, #9650
- Acceptance criteria for both phases

---

## Research References Consumed

- Jules API docs: authentication, sessions, activities, sources, types
- OpenCode provider architecture: handler.ts, provider.ts, anthropic/google/openai helpers
- OpenCode SSE event system: `/event` endpoint, bus event publishing
- GitHub issues: #6627 (SSE bandwidth), #9649 (reconnect gaps), #9650 (sessionID filter)

---

## Key Decisions Made

1. **Jules is NOT a ProviderHelper** — session-based polling lifecycle doesn't fit token-streaming adapter pattern
2. **Truth-first UX** — timeline = truth events only; keepalive = UI-only, explicitly labeled
3. **Two-loop architecture** — truth loop (server polls Jules) + perception loop (client rotates keepalive)
4. **Evidence-based confirmation** — plan steps only marked `done_confirmed` with artifact/activity proof
5. **Phased delivery** — Phase 1 stateless proxy first, Phase 2 SSE watcher second

---

## Files Created

| File | Size | Purpose |
|------|------|---------|
| `docs/specs/01-NOTES_AI_Provider_Architecture.md` | 243 lines | Canonical IDE data model |
| `docs/specs/02-NOTES_normalizeJulesToRun.md` | 451 lines | Normalizer pipeline spec |
| `docs/specs/03-NOTES_keepalive copy generator.md` | 314 lines | Keepalive generator contract |
| `docs/specs/04-NOTES_Thinking_Pipeline.md` | 557 lines | UI layout + evidence matcher |
| `docs/specs/05-NOTES_agentic_run_page_jules_tsx_skeleton.md` | 1431 lines | Full TSX skeleton with mock |
| `docs/specs/06-SPEC-SSE_Parallel_to_Planned_Feature.md` | 264 lines | SSE event specification |
| `docs/specs/07-ADR-Jules_Agentic_Run.md` | 66 lines | Architecture Decision Record |

**Total**: 3,326 lines of specification

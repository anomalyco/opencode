# Deployment Journal: DECISION_120 Milestone 2 — Architecture & Integration Design

**Date**: 2026-03-01  
**Agent**: OpenFixer (Designer role)  
**Decision**: DECISION_120 + DECISION_121 — Jules Provider Architecture  
**Milestone**: 2 (Architecture)  
**Status**: ✅ Complete  
**Branch**: `chasing-jules`

---

## Summary

Completed the architecture design for integrating Jules into the OpenCode console. The key finding: Jules fundamentally does not fit the existing `ProviderHelper` adapter pattern used by Anthropic, Google, OpenAI, and OA-Compatible providers. Jules is a session-based polling lifecycle, not a token-streaming LLM. This milestone produced the integration architecture document and confirmed the standalone client approach recommended in DECISION_120.

---

## Deliverables Completed

### 1. Integration Architecture Document (`docs/specs/08-ARCH-Jules_Provider_Integration.md`)

177-line architecture document covering:

- **Section 0**: Why Jules does NOT fit the Zen ProviderHelper pattern — comparison table of 6 assumption mismatches
- **Section 1**: File structure for Phase 1 (Core Client) and Phase 2 (SSE routes)
- **Section 2**: `jules.ts` domain module contents (4 concerns: wire types, IDE model, client interface, normalizer)
- **Section 3**: Polling architecture diagram with Phase 1 client-driven flow
- **Section 4**: Phase 2 SSE-native watcher design (future)
- **Section 5**: Truth-first UX constraints (6 hard rules)
- **Section 6**: Relationship to existing codebase — comparison table of 6 concerns
- **Section 7**: Implementation order (Phase 1 → Phase 2)
- **Section 8**: References (specs, issues, decisions, codemap)

### 2. Architecture Analysis of Existing Codebase

Read and analyzed the full provider stack to validate the standalone client decision:

| File Analyzed | Lines | Key Finding |
|---|---|---|
| `handler.ts` | 1021 | Assumes single-request token streaming; `selectProvider()` + `pump()` don't map to Jules |
| `provider.ts` | 212 | `ProviderHelper` interface requires `modifyUrl`, `modifyBody`, `streamSeparator` — all N/A for Jules |
| `anthropic.ts` | 754 | Bedrock binary stream decoder — confirms streaming-first design |
| `google.ts` | 77 | `x-goog-api-key` header + usage parser — format adapter pattern |
| `openai.ts` | 633 | `/responses` endpoint + `createUsageParser` — single POST/stream |
| `openai-compatible.ts` | 16423 | Most complex adapter; still single-request paradigm |
| `model.ts` | FormatSchema | `z.enum(["anthropic", "google", "openai", "oa-compat"])` — Jules not in the format enum |

### 3. DECISION_120 Architecture Document (`docs/deployment/ARCHITECTURE_DECISION_120_Jules_Integration.md`)

457-line architecture decision document (produced in prior session, validated in this milestone):

- Question 1: Client Pattern Fit → Standalone Client (not ProviderHelper)
- Question 2: Reusable components (auth, BYOK, billing, error types)
- Question 3: Session lifecycle management approach

---

## Architecture Decisions Confirmed

### Decision: Jules Lives Alongside Zen, Not Inside It

| Concern | Zen Handler | Jules |
|---|---|---|
| Route entry | `zen/v1/messages.ts` → `handler(input, {format})` | `jules/sessions.ts` → `IJulesClient` directly |
| Request shape | Chat completion body (messages, tools, model) | Task + repo + branch |
| Response shape | Token stream or JSON completion | Session snapshot (status, plan, artifacts) |
| Auth | `handler.ts:authenticate()` via DB | Reuse same auth; BYOK for Jules API key |
| Billing | `calculateCost()` per input/output tokens | Session-level cost (no token granularity) |
| Provider selection | `selectProvider()` with hash-based load balancing | Direct — single Jules endpoint |

### Decision: Domain Module in `provider/` Directory

The `jules.ts` file lives in `provider/` for colocation with other provider modules, but does NOT implement the `ProviderHelper` interface. It contains pure, stateless domain logic that any route or watcher can consume.

### Decision: Phase 1 Client-Driven Polling

Phase 1 uses stateless proxy routes. The IDE client drives the polling loop directly. No server-side watcher, no bus events, no SSE integration yet. This enables shipping sooner and validating the normalizer pipeline before adding complexity.

---

## Files Created

| File | Size | Purpose |
|------|------|---------|
| `docs/specs/08-ARCH-Jules_Provider_Integration.md` | 177 lines | Integration architecture |

---

## Dependencies on Prior Milestones

- **M1 (Specs)**: Architecture references specs 01-07 for type definitions, polling parameters, event taxonomy
- **DECISION_120**: Validates and extends the standalone client recommendation
- **DECISION_121**: References the SSE event model for Phase 2 design

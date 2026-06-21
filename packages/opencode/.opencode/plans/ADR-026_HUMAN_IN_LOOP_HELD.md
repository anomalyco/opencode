# ADR-026 — Human-in-the-Loop & HELD State

- **Status**: ACCEPTED (Sprint F)
- **Author**: Principal Engineer
- **Date**: 2026-06-19
- **Classification**: Specification ADR — pre-implementation for F-04/F-06
- **Motivation**: EV-FATAL-004 (concurrent invocation), CR-002 (confidence calibration), Phase 6 authorization requirement

---

## Motivation

Phase 4 reconciliation currently produces binary outcomes: accept or reject. The system has no mechanism to:

1. Pause a proposal for human review when advisors raise critical concerns
2. Distinguish between low-risk (auto-executable) and high-risk (human-approval-required) decisions
3. Prevent concurrent activation while a reconciliation is in-flight

ADR-026 addresses all three gaps to enable safe Phase 6 autonomous operation.

---

## Definitions

### HELD (Intermediate State)

HELD is an **intermediate** proposal state — the proposal is paused awaiting human review. It is NOT terminal:

```
SUBMITTED → VALIDATING → HELD → ACCEPTED
                              → REJECTED
```

HELD can transition to either ACCEPTED (human approves) or REJECTED (human rejects, or auto-expiry).

### ProposalStatus enum (after F-04)

```typescript
type ProposalStatus = "SUBMITTED" | "VALIDATING" | "ACCEPTED" | "REJECTED" | "HELD"
```

### Auto-Execute Categories

Decisions that can be executed without human approval:

| Category | Rationale |
|---|---|
| CONFIG_THRESHOLD | Numeric parameter tuning, bounded risk |
| CONFIG_BUDGET | Resource allocation, reversible |
| AGENT_INSTRUCTION | Prompt refinement, no architectural impact |

### Require-Approval Categories

Decisions that MUST pause for human review:

| Category | Rationale |
|---|---|
| MODE_ADJUSTMENT | Changes mode (assist ↔ autonomous), behavioral impact |
| Architecture changes | Structural decisions, irreversible without migration |

These categories apply to the SuggestionCategory in the Improver pipeline (see `improver.ts`), not the ReconciliationStrategy itself.

---

## HELD Trigger Definition

HELD is triggered by a **RiskAgent disagreement signal**. The trigger is narrow to avoid false positives:

**HELD triggered ONLY when BOTH conditions are true:**
- `RiskAgent.output.overallSeverity === "critical"`
- `RiskAgent.output.recommendationCategory === "REJECT"`

### Rules

- **PlanningAgent NEVER triggers HELD** — it produces implementation plans, not approval signals
- `overallSeverity === "high"` does NOT trigger HELD — only `"critical"` warrants human intervention
- `recommendationCategory` must be explicitly `"REJECT"` — advisory nudges (`"MODIFY"`) are not sufficient

### Required RiskAgent Schema Changes

Current (`risk.ts`):

```typescript
overallSeverity: "low" | "medium" | "high"
// no recommendationCategory field
```

Required:

```typescript
overallSeverity: "low" | "medium" | "high" | "critical"
recommendationCategory: "APPROVE" | "REJECT" | "MODIFY"
```

---

## ReconciliationStrategy AdvisorContext

F-04 introduces a breaking change to `ReconciliationStrategy.reconcile()` signature:

```typescript
interface AdvisorContext {
  riskAssessment?: {
    overallSeverity: "low" | "medium" | "high" | "critical"
    recommendationCategory: "APPROVE" | "REJECT" | "MODIFY"
    rationale: string
    risks: readonly { description: string; severity: string; category: string }[]
  }
}
```

---

## ActivationBusyError

| Field | Value |
|---|---|
| **Class** | `Schema.TaggedErrorClass("EvolutionActivationBusyError")` |
| **Category** | Domain Error |
| **Source** | `src/evolution/decision/activation/index.ts` |
| **Constructor** | `new ActivationBusyError({ message })` — direct |
| **Fields** | `message: String` |
| **Boundary** | ✅ Boleh keluar ke consumer |
| **When triggered** | `invoke()` called while another invocation is in-flight |

Separate from `ActivationError` (contract validation) so consumers can discriminate:

```typescript
Effect.catchTag("EvolutionActivationBusyError", () => Effect.succeed(skip))
Effect.catchTag("EvolutionActivationError", () => Effect.fail(realError))
```

### Lock Semantics

```
Ref<boolean> created at Layer initialization (not per-call)
  → Effect.ensuring wraps Effect.timeout (not inside it)
  → 60-second timeout
  → Flag reset guaranteed by Effect.ensuring, even on timeout/die
```

---

## HELD Lifecycle

### Entry

```
engine.reconcile(input)
  → strategy detects HELD condition (riskAgent veto)
  → outcome = "HELD_FOR_REVIEW"
  → proposal created with status "HELD" (not "SUBMITTED")
  → audit entry appended
  → caller receives outcome + proposalId
  → proposal NOT submitted as decision
```

### Resolution

Human reviews via CLI:

```
opencode evolution review <proposalId> approve
opencode evolution review <proposalId> reject
```

| Command | Effect |
|---|---|
| `approve` | Proposal transitions HELD → ACCEPTED |
| `reject` | Proposal transitions HELD → REJECTED |
| No action for 7 days | Auto-reject (configurable, default 7d) |

### State Machine

```
SUBMITTED → VALIDATING → ACCEPTED  (happy path, auto-execute)
SUBMITTED → VALIDATING → REJECTED  (validation failure)

SUBMITTED → VALIDATING → HELD → ACCEPTED  (human approves)
SUBMITTED → VALIDATING → HELD → REJECTED  (human rejects or auto-expiry)
```

HELD does not appear in auto-execute reconciliation outcomes — only when the strategy decides human review is required.

---

## Reconciliation Outcome Changes

### Current (`reconciliation-log.ts`)

```typescript
type ReconciliationOutcome = "PROPOSAL_SUBMITTED" | "BELOW_THRESHOLD" | "NO_CANDIDATES"
type ReconciliationReason = "HIGHEST_CONFIDENCE" | "BELOW_THRESHOLD" | "NO_CANDIDATES"
```

### After F-04

```typescript
type ReconciliationOutcome = "PROPOSAL_SUBMITTED" | "BELOW_THRESHOLD" | "NO_CANDIDATES" | "HELD_FOR_REVIEW"
type ReconciliationReason = "HIGHEST_CONFIDENCE" | "BELOW_THRESHOLD" | "NO_CANDIDATES" | "HELD_FOR_REVIEW"
```

### ReconcileOutput Changes

```typescript
// After F-04: 4 outcomes
"PROPOSAL_SUBMITTED" | "BELOW_THRESHOLD" | "NO_CANDIDATES" | "HELD_FOR_REVIEW"
```

Engine handling for HELD_FOR_REVIEW:
- Log to audit (same as BELOW_THRESHOLD)
- Create proposal with status "HELD" (not "SUBMITTED")
- Return outcome + proposalId to caller
- Do NOT submit as decision

---

## Implementation Order

1. **F-06**: ADR-026 (this document) — definition complete
2. **F-01**: Lock Flag — ActivationBusyError, Ref, ensuring-outside-timeout
3. **F-02**: Metrics error propagation
4. **F-03**: Minimum data guards
5. **F-05**: Dual-store TTL (90-day default)
6. **F-04**: RiskAgent schema + AdvisorContext + HELD state + consensus strategy

---

## Open Questions (Phase 6)

- CLI command for `opencode evolution review` — implementation scope?
- Auto-expiry timer — background fiber or checked on CLI invocation?
- Human notification mechanism — polling? Push notification?

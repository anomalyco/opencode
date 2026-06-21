# Error Registry â€” Evolution Layer

**Maintained**: 2026-06-16 (Sprint F4)
**Purpose**: Track all typed errors, their categories, and boundary status (AD-003 compliance)

---

## Classification

| Category | Definition | Boundary Status |
|---|---|---|
| **Domain Error** | Business domain failure (e.g., entity not found, invalid state) | **Boleh keluar** ke consumer |
| **Storage Error** | Storage layer failure (e.g., file not found, permission denied, disk full) | **Boleh keluar** setelah diterjemahkan via translator |
| **Integration Error** | External service failure (e.g., LLM API, git, filesystem) | **Harus diterjemahkan** sebelum boundary |
| **Programming Defect** | Developer mistake (e.g., null ref, invariant violation) | **Tidak boleh typed** â€” panic/defect |

---

## Registered Errors

### EvolutionStorageError

| Field | Value |
|---|---|
| **Class** | `Schema.TaggedErrorClass("EvolutionStorageError")` |
| **Category** | Storage Error |
| **Source** | `src/evolution/error.ts` |
| **Constructor** | `toEvolutionStorageError(e, operation, path?)` â€” single constructor path âœ… |
| **Fields** | `message: String`, `operation: "read" \| "write" \| "exists"`, `path?: String`, `cause?: Defect` |
| **Boundary** | âœ… Boleh keluar ke consumer |
| **CLI handling** | `status.ts` menangkap dengan `catchTag("EvolutionStorageError", ...)` â†’ degradasi ke disabled state |
| **Consumer impact** | CLI mendapat disabled display; programmatic consumer mendapat error |

**Provenance** â€” 11 call sites:

| File | Line | Operation | Path |
|---|---|---|---|
| `brain/memory.ts` | 97 | read | (derived from storage) |
| `brain/memory.ts` | 102 | write | (derived from storage) |
| `brain/decisions.ts` | 116 | read | json path |
| `brain/decisions.ts` | 149 | write | json path |
| `brain/decisions.ts` | 152 | write | markdown path |
| `brain/decisions.ts` | 224 | write | ADR file path |
| `brain/project.ts` | 103 | exists | git directory |
| `brain/project.ts` | 113 | read | package.json |
| `brain/project.ts` | 156 | read | workspace package.json |
| `brain/project.ts` | 253 | read | cache file |
| `brain/project.ts` | 270 | write | cache file |

---

### EvolutionNotEnabledError

| Field | Value |
|---|---|
| **Class** | `Schema.TaggedErrorClass("EvolutionMemoryNotEnabledError")` (memory) |
| | `Schema.TaggedErrorClass("EvolutionDecisionsNotEnabledError")` (decisions) |
| **Category** | Domain Error |
| **Source** | `brain/memory.ts:10`, `brain/decisions.ts:10` |
| **Constructor** | `new EvolutionNotEnabledError({ message })` â€” direct |
| **Fields** | `message: String` |
| **Boundary** | âœ… Boleh keluar ke consumer |
| **When triggered** | Evolution not enabled in config, but brain method called |

---

### AdrNotFoundError

| Field | Value |
|---|---|
| **Class** | `Schema.TaggedErrorClass("EvolutionAdrNotFoundError")` |
| **Category** | Domain Error |
| **Source** | `brain/decisions.ts:14` |
| **Constructor** | `new AdrNotFoundError({ id, message })` â€” direct |
| **Fields** | `id: String`, `message: String` |
| **Boundary** | âœ… Boleh keluar ke consumer |
| **When triggered** | `supersede()` called with nonexistent ADR ID |

---

### ContextBudgetError

| Field | Value |
|---|---|
| **Class** | `Schema.TaggedErrorClass("EvolutionContextBudgetError")` |
| **Category** | Domain Error |
| **Source** | `src/evolution/context/budget.ts` |
| **Constructor** | `new ContextBudgetError({ message })` â€” direct |
| **Fields** | `message: String` |
| **Boundary** | âœ… Boleh keluar ke consumer |
| **When triggered** | Context budget exceeded â€” total demand > available tokens |
| **Consumer impact** | Consumer should reduce context / trim data, not retry or crash |

### InvariantViolationError

| Field | Value |
|---|---|
| **Class** | `class InvariantViolationError` (plain class, not Schema) |
| **Category** | Programming Defect |
| **Source** | `src/evolution/error.ts` |
| **Constructor** | `new InvariantViolationError({ message, operation })` â€” direct |
| **Fields** | `message: String`, `operation: String` |
| **Boundary** | âŒ **Tidak boleh typed** â€” panic/defect via `Effect.die()` |
| **When triggered** | `ProposalStore.submit()` / `updateStatus()` called without `proposal` capability (CR-001 invariant) |

**Consumer impact**: Caller receives a `RuntimeException` defect. Non-proposal agents (RiskAgent, PlanningAgent) cannot write proposals â€” architectural invariant enforced at storage layer.

---

### EvolutionMemoryLimitError

| Field | Value |
|---|---|
| **Class** | `Schema.TaggedErrorClass("EvolutionMemoryLimitError")` |
| **Category** | Domain Error |
| **Source** | `src/evolution/error.ts` |
| **Constructor** | `new EvolutionMemoryLimitError({ message, count, limit? })` â€” direct |
| **Fields** | `message: String`, `limit?: Int`, `count: Int` |
| **Boundary** | âœ… Boleh keluar ke consumer |
| **When triggered** | Memory write rejected because count exceeds maxMemoriesPerSession limit |

---

### SchemaValidationError

| Field | Value |
|---|---|
| **Class** | `Schema.TaggedErrorClass("EvolutionSchemaValidationError")` |
| **Category** | Domain Error |
| **Source** | `src/evolution/brain/decisions.ts` |
| **Constructor** | `new SchemaValidationError({ message, detail })` â€” direct |
| **Fields** | `message: String`, `detail: String` |
| **Boundary** | âœ… Boleh keluar ke consumer |
| **When triggered** | Proposal input fails schema validation before submission |

---

### ActivationError

| Field | Value |
|---|---|
| **Class** | `Schema.TaggedErrorClass("EvolutionActivationError")` |
| **Category** | Domain Error |
| **Source** | `src/evolution/decision/activation/index.ts` |
| **Constructor** | `new ActivationError({ message })` â€” direct |
| **Fields** | `message: String` |
| **Boundary** | âœ… Boleh keluar ke consumer |
| **When triggered** | Activation contract validation fails (G4 contract enforcement) |

---

### DecisionEngineError

| Field | Value |
|---|---|
| **Class** | `Schema.TaggedErrorClass("EvolutionDecisionEngineError")` |
| **Category** | Domain Error |
| **Source** | `src/evolution/decision/engine.ts:6` |
| **Constructor** | `new DecisionEngineError({ message })` â€” direct |
| **Fields** | `message: String` |
| **Boundary** | âœ… Boleh keluar ke consumer |
| **When triggered** | Decision Engine submission to DecisionsBrain fails (unexpected error during `submit()` call) |

---

## Error Boundary Audit

| Item | Result |
|---|---|
| FileSystemError leaked to consumer? | âŒ No â€” all mapped via `toEvolutionStorageError()` |
| PlatformError leaked to consumer? | âŒ No â€” caught at FSUtil boundary |
| JSON parse error leaked to consumer? | âŒ No â€” caught locally in read helpers (returns `[]`) |
| Unknown exception (Error / unknown / any) leaked? | âŒ No â€” all public signatures use typed error classes |
| All EvolutionStorageError via single constructor path? | âœ… Yes â€” only `toEvolutionStorageError()` |
| Direct `new FooError(...)` outside error module? | âœ… Only: `new EvolutionNotEnabledError(...)`, `new AdrNotFoundError(...)`, `new DecisionEngineError(...)` (domain errors, acceptable) |

---

## Current Error Family (9 errors)

```
Evolution Layer Errors
â”œâ”€â”€ Programming Defect
â”‚   â””â”€â”€ InvariantViolationError     (brain/proposal-store) â€” CR-001, Sprint F
â”œâ”€â”€ Domain Error
â”‚   â”œâ”€â”€ EvolutionNotEnabledError    (memory/decisions)
â”‚   â”œâ”€â”€ EvolutionMemoryLimitError   (error) â€” memory compaction
â”‚   â”œâ”€â”€ AdrNotFoundError            (decisions)
â”‚   â”œâ”€â”€ ContextBudgetError          (context/budget) â€” Phase 2
â”‚   â”œâ”€â”€ SchemaValidationError       (decisions) â€” validation
â”‚   â”œâ”€â”€ ActivationError             (decision/activation) â€” G4 contract
â”‚   â””â”€â”€ DecisionEngineError         (decision/engine) â€” Phase 3, Sprint F4
â””â”€â”€ Storage Error
    â””â”€â”€ EvolutionStorageError       (memory/decisions/project) â€” via toEvolutionStorageError()
```

---

## Phase 3+ Warning

Without AD-003 (Error Taxonomy Governance), Phase 3 modules will produce:

- RetrieverError
- ContextError
- ComposerError
- RoutingError
- AgentError

**Each new error must pass classification** before entering registry.
---

### ActivationBusyError

| Field | Value |
|---|---|
| **Class** | `Schema.TaggedErrorClass("EvolutionActivationBusyError")` |
| **Category** | Domain Error |
| **Source** | `src/evolution/decision/activation/index.ts` |
| **Constructor** | `new ActivationBusyError({ message })` -- direct |
| **Fields** | `message: String` |
| **Boundary** | âœ… Boleh keluar ke consumer |
| **When triggered** | `invoke()` called while another invocation is in-flight |

Separate from `ActivationError` so consumers can discriminate.



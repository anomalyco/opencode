# Error Registry — Evolution Layer

**Maintained**: 2026-06-13
**Purpose**: Track all typed errors, their categories, and boundary status (AD-003 compliance)

---

## Classification

| Category | Definition | Boundary Status |
|---|---|---|
| **Domain Error** | Business domain failure (e.g., entity not found, invalid state) | **Boleh keluar** ke consumer |
| **Storage Error** | Storage layer failure (e.g., file not found, permission denied, disk full) | **Boleh keluar** setelah diterjemahkan via translator |
| **Integration Error** | External service failure (e.g., LLM API, git, filesystem) | **Harus diterjemahkan** sebelum boundary |
| **Programming Defect** | Developer mistake (e.g., null ref, invariant violation) | **Tidak boleh typed** — panic/defect |

---

## Registered Errors

### EvolutionStorageError

| Field | Value |
|---|---|
| **Class** | `Schema.TaggedErrorClass("EvolutionStorageError")` |
| **Category** | Storage Error |
| **Source** | `src/evolution/error.ts` |
| **Constructor** | `toEvolutionStorageError(e, operation, path?)` — single constructor path ✅ |
| **Fields** | `message: String`, `operation: "read" \| "write" \| "exists"`, `path?: String`, `cause?: Defect` |
| **Boundary** | ✅ Boleh keluar ke consumer |
| **CLI handling** | `status.ts` menangkap dengan `catchTag("EvolutionStorageError", ...)` → degradasi ke disabled state |
| **Consumer impact** | CLI mendapat disabled display; programmatic consumer mendapat error |

**Provenance** — 11 call sites:

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
| **Constructor** | `new EvolutionNotEnabledError({ message })` — direct |
| **Fields** | `message: String` |
| **Boundary** | ✅ Boleh keluar ke consumer |
| **When triggered** | Evolution not enabled in config, but brain method called |

---

### AdrNotFoundError

| Field | Value |
|---|---|
| **Class** | `Schema.TaggedErrorClass("EvolutionAdrNotFoundError")` |
| **Category** | Domain Error |
| **Source** | `brain/decisions.ts:14` |
| **Constructor** | `new AdrNotFoundError({ id, message })` — direct |
| **Fields** | `id: String`, `message: String` |
| **Boundary** | ✅ Boleh keluar ke consumer |
| **When triggered** | `supersede()` called with nonexistent ADR ID |

---

### ContextBudgetError

| Field | Value |
|---|---|
| **Class** | `Schema.TaggedErrorClass("EvolutionContextBudgetError")` |
| **Category** | Domain Error |
| **Source** | `src/evolution/context/budget.ts` |
| **Constructor** | `new ContextBudgetError({ message })` — direct |
| **Fields** | `message: String` |
| **Boundary** | ✅ Boleh keluar ke consumer |
| **When triggered** | Context budget exceeded — total demand > available tokens |
| **Consumer impact** | Consumer should reduce context / trim data, not retry or crash |

---

## Error Boundary Audit

| Item | Result |
|---|---|
| FileSystemError leaked to consumer? | ❌ No — all mapped via `toEvolutionStorageError()` |
| PlatformError leaked to consumer? | ❌ No — caught at FSUtil boundary |
| JSON parse error leaked to consumer? | ❌ No — caught locally in read helpers (returns `[]`) |
| Unknown exception (Error / unknown / any) leaked? | ❌ No — all public signatures use typed error classes |
| All EvolutionStorageError via single constructor path? | ✅ Yes — only `toEvolutionStorageError()` |
| Direct `new FooError(...)` outside error module? | ✅ Only: `new EvolutionNotEnabledError(...)`, `new AdrNotFoundError(...)` (domain errors, acceptable) |

---

## Current Error Family (4 errors)

```
Evolution Layer Errors
├── Domain Error
│   ├── EvolutionNotEnabledError    (memory/decisions)
│   ├── AdrNotFoundError            (decisions)
│   └── ContextBudgetError          (context/budget) — Phase 2
└── Storage Error
    └── EvolutionStorageError       (memory/decisions/project) — via toEvolutionStorageError()
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

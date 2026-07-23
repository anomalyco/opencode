# Design: token-management — Fase 2 (Budget Enforcement & Free-First Routing)

## Technical Approach

Two Effect seam injections — pre-request and post-request — into the existing LLM pipeline. The `Budget.Service` real layer replaces the Fase 1 no-op stub. All changes gated behind `OPENCODE_TOKEN_MGMT`.

## Architecture Decisions

### Decision: Free model detection

**Choice**: `model.providerID.startsWith("opencode")` = free Zen model
**Alternatives considered**: (a) explicit free list in config — too brittle, (b) `cost === 0` — ambiguous for models without cost data
**Rationale**: Zen models use `opencode` as providerID prefix. Simple string check matches the existing convention.

### Decision: Model mapping for zero-balance fallback

**Choice**: Map paid models to Zen equivalents by `model.family` or `model.name` substring match
**Rationale**: No fixed mapping table needed. Query available models from `Provider.Service`, filter by `providerID.startsWith("opencode")`, pick closest match by family.
**Alternatives considered**: (a) static mapping table — needs maintenance, (b) always use one global Zen model — too inflexible.

### Decision: Deduction timing

**Choice**: Deduct after `Session.getUsage()` returns real usage, in `step-finish` handler
**Rationale**: Real usage data is available at that point. Pre-deduction is estimation-only and would require refund logic for cancelled/warnings.

### Decision: Negative balance allowed

**Choice**: Deduct even when balance goes negative (no hard block)
**Rationale**: Prevent infinite loops. Deduction is append-only and auditable. Admin can credit later.

## Data Flow

```
User → LLM.run(input.model)
  │
  ▼
Budget.Service.resolveModel(currentUserID, input.model)
  │
  ├─ Free model? → pass through (no-op)
  ├─ Paid, balance > 0 → pass through
  └─ Paid, balance ≤ 0 → lookup Zen model → swap or BudgetExhaustedError
  │
  ▼
provider.getLanguage(resolvedModel)  ← may have been swapped
  │
  ▼
[LLM request executes]
  │
  ▼
processor.ts step-finish
  │
  ▼
Session.getUsage() → cost, tokens
  │
  ▼
Budget.Service.deduct({ userId, amount: -cost, model, tokensUsed, costUsd, sessionId })
  │
  ▼
TokenBalanceTable.balance ← balance - cost
TokenTransactionTable ← { amount: -cost, model, tokensUsed, costUsd }
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/opencode/src/provider/budget.ts` | Modify | Replace stub resolveModel, check, deduct. Add `defaultLayerReal` |
| `packages/opencode/src/session/llm.ts` | Modify | Add `Budget.Service` to live layer. Pre-request `resolveModel` before `provider.getLanguage` |
| `packages/opencode/src/session/processor.ts` | Modify | Add `Budget.Service` to processor layer. Call `deduct` after `getUsage` in step-finish |
| `packages/opencode/src/session/retry.ts` | Modify | Handle `BudgetExhaustedError` case → `GO_UPSELL_MESSAGE` |

## Budget.Service Real Implementation

```typescript
// resolveModel: check balance → swap paid→Zen if exhausted
resolveModel: (userId: string, modelID: string) =>
  Effect.gen(function* () {
    if (!isEnabled() || modelID.startsWith("opencode"))
      return { costPerToken: 0 }

    const balance = yield* getBalance(userId)
    const cost = modelCost(modelID) // from model's cost.input+output
    if (balance <= 0) {
      const zen = yield* findZenModel(modelID)
      if (zen) return { costPerToken: 0, swappedFrom: modelID, swappedTo: zen }
      return yield* new BudgetExhaustedError({ message: GO_UPSELL_MESSAGE })
    }
    return { costPerToken: cost }
  })

// deduct: append tx, update balance atomically
deduct: (input) =>
  Effect.gen(function* () {
    if (!isEnabled()) return
    yield* db.transaction((tx) =>
      tx.update(TokenBalanceTable)
        .set({ balance: sql`balance + ${input.amount}`, updatedAt: Date.now() })
        .where(eq(TokenBalanceTable.userId, input.userId))
        .run()
        .pipe(
          Effect.flatMap(() =>
            tx.insert(TokenTransactionTable)
              .values({ ...input, amount: input.amount })
              .run()
          ),
        )
    )
  })
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Budget.Service.resolveModel (free, paid, exhausted, Zen swap) | `testEffect` with in-memory DB |
| Unit | Budget.Service.deduct (happy, negative balance) | `testEffect` with in-memory DB |
| Unit | Pre-request: model swap in LLM.run | Mock Budget, assert model changed |
| Unit | Post-request: deduct called in step-finish | Mock Budget, assert deduct called |

## Open Questions

- [ ] Determine which specific Zen model to map for each paid model family (e.g., Claude → DeepSeek V4 Pro, GPT → Qwen3.7 Max)

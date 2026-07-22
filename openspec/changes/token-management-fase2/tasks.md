# Tasks: token-management — Fase 2 (Budget Enforcement & Free-First Routing)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~300–400 (5 files modified) |
| 400-line budget risk | **Medium** |
| Chained PRs recommended | **No** |
| Delivery strategy | `single-pr` |
| Chain strategy | `pending` |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

## Phase 1 — Budget Service Real Implementation

- [x] **1.1** `budget.ts` — Implement `isFreeModel(modelID)` helper: `modelID.startsWith("opencode")`. Gated by `isEnabled()`.
- [x] **1.2** `budget.ts` — Implement `resolveModel` real logic: check user balance via `TokenBalanceTable`, return `{ costPerToken }`. If balance ≤ 0 and paid → lookup Zen model via `Provider.Service.getProvider` → filter `opencode*` models. If none → fail with `BudgetExhaustedError`.
- [x] **1.3** `budget.ts` — Implement `deduct` real logic: `db.transaction(IMMEDIATE)` — update balance, insert `TokenTransactionTable` row with `amount` (negative), `model`, `tokensUsed`, `costUsd`, `sessionId`.
- [x] **1.4** `budget.ts` — Implement `check` real: same resolveModel without swap — just gate on balance > 0. Fail with `BudgetExhaustedError` if not.

## Phase 2 — Pre-Request Injection (LLM.run)

- [x] **2.1** `llm.ts` — Add `Budget.Service` to live layer's required services type signature.
- [x] **2.2** `llm.ts` — In `LLM.run`, before `provider.getLanguage(input.model)`, yield `Budget.Service.resolveModel(currentUserID, input.model.id)`. If `swappedTo` returned, patch `input.model` to the Zen model.
- [x] **2.3** `llm.ts` — Ensure Zen models skip the swap logic entirely (already handled by resolveModel).

## Phase 3 — Post-Request Injection (processor.ts)

- [x] **3.1** `processor.ts` — Add `Budget.Service` to processor layer required services (alongside existing).
- [x] **3.2** `processor.ts` — After `Session.getUsage()` returns in `step-finish` (line 700), if model is paid: yield `Budget.Service.deduct({ userId, amount: -usage.cost, model: ctx.model.id, tokensUsed: usage.tokens.total, costUsd: usage.cost, sessionId: ctx.sessionID })`.
- [x] **3.3** `processor.ts` — Wrap deduct call with `isEnabled()` guard and `Effect.catch` (log warning, never break the session).

## Phase 4 — Error Integration

- [x] **4.1** `retry.ts` — Add `BudgetExhaustedError` check in `retryable()`: return `{ message: GO_upsell_MESSAGE, action: { reason: "free_tier_limit", ... } }`.

## Phase 5 — Testing

- [x] **5.1** Unit: `resolveModel` with free model → no-op.
- [x] **5.2** Unit: `resolveModel` with paid + sufficient balance → passes.
- [x] **5.3** Unit: `resolveModel` with paid + zero balance + Zen available → model swap.
- [x] **5.4** Unit: `resolveModel` with paid + zero balance + no Zen → `BudgetExhaustedError`.
- [x] **5.5** Unit: `deduct` decreases balance and records transaction.
- [x] **5.6** Unit: deduct with insufficient balance still records negative balance.
- [x] **5.7** Integration: LLM test with mocked Budget — verify model swap occurs (covered by llm.test.ts mockBudget layers).

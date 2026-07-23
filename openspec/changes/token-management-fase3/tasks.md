# Tasks: token-management Fase 3

**Estimated total**: ~250 lines added/changed across 6 files
**Delivery strategy**: single PR (under 400-line budget)

## ~~Task 1: Add `lastAllowanceMonth` column to TokenBalanceTable~~ ✅

- File: `packages/core/src/account/sql.ts`
- Add `lastAllowanceMonth: text().$default(() => "")` field
- Add Drizzle migration for `ALTER TABLE token_balance ADD COLUMN last_allowance_month TEXT NOT NULL DEFAULT '';`
- **Est**: ~5 lines schema + migration file

## ~~Task 2: Create utility for UTC month string~~ ✅

- File: `packages/opencode/src/identity/index.ts` (or new helper)
- Create `getCurrentUTCMonth()` returning `"YYYY-MM"` via `new Date().toISOString().slice(0, 7)`
- Create `monthAllowanceDue(currentMonth, lastMonth)` returning boolean (lexicographic compare)
- **Est**: ~8 lines

## ~~Task 3: Implement auto-recharge in upsertFromAuth~~ ✅

- File: `packages/opencode/src/identity/index.ts`
- Inside existing transaction block in `upsertFromAuth`, after insert/upsert:
  1. Read `OPENCODE_MONTHLY_ALLOWANCE` env var (default 50000)
  2. Read current month and `lastAllowanceMonth` from token_balance row
  3. If due, UPDATE balance + lastAllowanceMonth, INSERT token_transaction
- **Est**: ~25 lines

## ~~Task 4: Add low-balance warning mechanism~~ ✅

- File: `packages/opencode/src/provider/budget.ts`
- Define `BudgetWarning` interface and module-level getWarning/setWarning functions
- **Est**: ~10 lines

## ~~Task 5: Low-balance check in deduct()~~ ✅

- File: `packages/opencode/src/provider/budget.ts`
- In `deduct()`, after SQL update, read new balance from updated row
- Read `OPENCODE_LOW_BALANCE_THRESHOLD` env var or compute as `max(5000, allowance * 0.2)`
- If `newBalance > 0 && newBalance < threshold` → set warning
- **Est**: ~25 lines

## ~~Task 6: Surface low-balance warning in processor.ts step-finish~~ ✅

- File: `packages/opencode/src/session/processor.ts`
- In step-finish handler, after `budget.deduct()` call:
  - Read warning via `getWarning()`
  - If present, inject warning message as a text part
- **Est**: ~15 lines

## ~~Task 7: Add stats() method to Identity.Service~~ ✅

- File: `packages/opencode/src/identity/index.ts`
- Add `stats` method to `Interface` and implement:
  - `SELECT COUNT(*) FROM user_identity` → totalUsers
  - `SELECT COALESCE(SUM(balance), 0) FROM token_balance` → totalBalance
  - Monthly consumption via token_transaction aggregation
- Update `Service.of({ ... })` constructor
- **Est**: ~40 lines

## ~~Task 8: Add usageStats() method to Identity.Service~~ ✅

- File: `packages/opencode/src/identity/index.ts`
- Add `usageStats` method to `Interface` and implement:
  - Query token_transaction with date range, grouped by date + userId
  - JOIN user_identity for email
  - Only negative amounts (consumption), SUM tokensUsed, costUsd, COUNT as requestCount
- Update `Service.of({ ... })` constructor
- **Est**: ~40 lines

## ~~Task 9: Add stats HTTP endpoint schemas and group~~ ✅

- File: `packages/opencode/src/server/routes/instance/httpapi/groups/admin.ts`
- Add `AdminStatsResponse` and `AdminUsageStatsResponse` schemas
- Add `StatsPaths` with `/admin/stats` and `/admin/stats/usage`
- Add `GET stats` and `GET usageStats` endpoints to `AdminApi` group
- **Est**: ~35 lines

## ~~Task 10: Implement admin stats handlers~~ ✅

- File: `packages/opencode/src/server/routes/instance/httpapi/handlers/admin.ts`
- Add `stats` handler: admin check → `identity.stats()` → return response
- Add `usageStats` handler: admin check → parse query params `from`, `to` → `identity.usageStats()` → return response
- Wire handlers with `handle("stats", ...).handle("usageStats", ...)`
- **Est**: ~35 lines

## ~~Task 11: Tests for auto-recharge logic~~ ✅

- File: `packages/opencode/test/identity/identity.test.ts` (added to existing)
- Create test using `testEffect()`:
  - Insert user → verify allowance credited on first call
  - Call upsertFromAuth again same month → verify no double-credit
  - Call next month (advance clock) → verify second allowance
  - Verify disabled when OPENCODE_TOKEN_MGMT unset
- **Est**: ~60 lines

## ~~Task 12: Tests for low-balance warning and stats~~ ✅

- File: `packages/opencode/test/budget/warning.test.ts` (new)
- Create tests:
  - Deduct below threshold → verify warning set
  - Deduct above threshold → verify no warning
  - stats() returns correct totals
  - usageStats() with date range returns correct aggregation
- **Est**: ~60 lines

---

## Summary

| # | Task | File(s) | Est. Lines |
|---|------|---------|------------|
| 1 | ✅ Add lastAllowanceMonth column | `sql.ts` + migration | 5 |
| 2 | ✅ UTC month utility | `index.ts` | 8 |
| 3 | ✅ Auto-recharge in upsertFromAuth | `index.ts` | 25 |
| 4 | ✅ Budget.Warning context service | `budget.ts` | 10 |
| 5 | ✅ Low-balance check in deduct | `budget.ts` | 25 |
| 6 | ✅ Surface warning in processor | `processor.ts` | 15 |
| 7 | ✅ stats() method | `index.ts` | 40 |
| 8 | ✅ usageStats() method | `index.ts` | 40 |
| 9 | ✅ Stats HTTP schemas/group | `admin.ts` (groups) | 35 |
| 10 | ✅ Stats handlers | `admin.ts` (handlers) | 35 |
| 11 | ✅ Auto-recharge tests | new test file | 60 |
| 12 | ✅ Warning + stats tests | new test file | 60 |
| | **Total** | | **~358** |

**Review workload guard**: Under 400-line budget. Single PR. No chained PRs needed.

**Decision needed before apply**: No — scope is well-defined.
**Chained PRs recommended**: No
**400-line budget risk**: Low (estimated 358, likely ~300 after dedup)

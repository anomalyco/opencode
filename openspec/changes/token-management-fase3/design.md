# Design: token-management Fase 3 — Auto-Recharge & Notifications

## 1. Data Model Changes

### TokenBalanceTable (packages/core/src/account/sql.ts)

Add column:

```ts
lastAllowanceMonth: text().$default(() => ""),  // "YYYY-MM" or ""
```

Migration: ALTER TABLE token_balance ADD COLUMN last_allowance_month TEXT NOT NULL DEFAULT '';

## 2. Auto-Recharge Flow (Identity.upsertFromAuth)

```
upsertFromAuth(input)
  └─ if !isEnabled() → return
  └─ transaction(IMMEDIATE):
       1. INSERT user_identity ... ON CONFLICT DO UPDATE
       2. INSERT token_balance ... ON CONFLICT DO NOTHING
       3. READ current month: getNowUTC() → "YYYY-MM"
       4. READ token_balance.lastAllowanceMonth
       5. IF lastAllowanceMonth < currentMonth (lexicographic compare, "2026-06" < "2026-07"):
            UPDATE token_balance
              SET balance = balance + OPENCODE_MONTHLY_ALLOWANCE (default 50000)
                  lastAllowanceMonth = currentMonth
                  updatedAt = now
            INSERT token_transaction (userId, amount=+allowance, description="Monthly allowance YYYY-MM")
       6. ELSE → skip (already credited this month)
```

Key properties:
- Idempotent: month string comparison prevents double-credit
- Atomic: wrapped in same transaction as user upsert
- Configurable allowance via `OPENCODE_MONTHLY_ALLOWANCE` env var
- UTC month boundary via `new Date().toISOString().slice(0, 7)`

### Integration into upsertFromAuth

The allowance check runs AFTER the identity upsert and balance row ensure, inside the same transaction block. No new DB round-trips outside the existing transaction.

## 3. Low-Balance Warning (Budget.deduct)

After successful deduction in `Budget.deduct()`:

```typescript
const threshold = Number(process.env["OPENCODE_LOW_BALANCE_THRESHOLD"]) ||
  Math.max(5000, monthlyAllowance * 0.2)

// Read new balance after update
const newBalance = /* from the updated row */
if (newBalance > 0 && newBalance < threshold) {
  // Store warning — attach to response context
  yield* Budget.Warning.set({
    remaining: newBalance,
    threshold,
    message: `⚠️ Low balance: ~${newBalance.toLocaleString()} tokens remaining. Contact admin for top-up.`
  })
}
```

### Warning Surface

The warning is read by the processor.ts step-finish handler and appended to the assistant message or system context. A new `Budget.Warning` context service (scoped to the request) carries it from `deduct()` to the response assembly point.

Implementation sketch:
- Add `Budget.Warning` — a `Context.Tag<{ remaining: number; threshold: number; message: string } | null>`
- In `deduct()`, after update, `yield* Budget.Warning.set(warningObject)` if below threshold
- In `processor.ts` step-finish, after deduct: `yield* Budget.Warning.getOption` → if present, append warning to the message text or system prompt context

## 4. Admin Stats Endpoints

### Identity.Service — new methods

```typescript
interface Interface {
  // ... existing methods ...
  readonly stats: Effect.Effect<{
    totalUsers: number
    totalBalance: number
    totalUsedThisMonth: number
  }>
  readonly usageStats: (input: {
    from: string  // YYYY-MM-DD
    to: string    // YYYY-MM-DD
  }) => Effect.Effect<Array<{
    date: string
    userId: string
    email: string
    tokensUsed: number
    costUsd: number
    requestCount: number
  }>>
}
```

#### stats() — aggregated queries

```sql
-- totalUsers
SELECT COUNT(*) FROM user_identity

-- totalBalance
SELECT COALESCE(SUM(balance), 0) FROM token_balance

-- totalUsedThisMonth (from token_transaction where amount < 0)
SELECT COALESCE(SUM(ABS(amount)), 0)
FROM token_transaction
WHERE amount < 0
  AND createdAt >= strftime('%s', date('now', 'start of month'))
```

#### usageStats(from, to) — daily breakdown

```sql
SELECT
  date(t.createdAt / 1000, 'unixepoch') as date,
  t.userId,
  u.email,
  COALESCE(SUM(ABS(t.tokensUsed)), 0) as tokensUsed,
  COALESCE(SUM(ABS(t.costUsd)), 0) as costUsd,
  COUNT(*) as requestCount
FROM token_transaction t
LEFT JOIN user_identity u ON u.id = t.userId
WHERE t.amount < 0
  AND t.createdAt >= :fromTs
  AND t.createdAt <= :toTs
GROUP BY date, t.userId
ORDER BY date DESC, tokensUsed DESC
```

### HTTP API — group additions

In `AdminApi` group (groups/admin.ts):

| Method | Path | Response |
|--------|------|----------|
| GET | `/admin/stats` | `{ totalUsers, totalBalance, totalUsedThisMonth }` |
| GET | `/admin/stats/usage?from=YYYY-MM-DD&to=YYYY-MM-DD` | `[{ date, userId, email, tokensUsed, costUsd, requestCount }]` |

Both endpoints reuse the `Authorization` middleware for admin-only access.

## 5. Config Values

| Env Var | Default | Description |
|---------|---------|-------------|
| `OPENCODE_MONTHLY_ALLOWANCE` | 50000 | Tokens credited per month |
| `OPENCODE_LOW_BALANCE_THRESHOLD` | max(5000, 20% of allowance) | Warning threshold |

## 6. Key Design Decisions

1. **UTC month comparison**: Lexicographic compare of "YYYY-MM" strings works correctly because month numbers are zero-padded — no date library needed
2. **Warning in deduct context**: Using a scoped Context service avoids threading state through the entire call chain while keeping it Effect-native
3. **Stats query over token_transaction**: Single table hit with indexed columns; date range required to prevent full-table scans
4. **No cron**: Login-triggered recharge is simpler and correct for single-user/team deployments typical of opencode

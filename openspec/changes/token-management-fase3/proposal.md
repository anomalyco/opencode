# Proposal: token-management — Fase 3 (Auto-Recharge & Notifications)

## Intent

Fases 1+2 built identity, balance tracking, and budget enforcement. Fase 3 automates budget management: monthly allowance credits on login, low-balance warnings during LLM usage, and aggregated consumption data for the admin dashboard.

## Scope

### In Scope
- Monthly auto-recharge: credit `OPENCODE_MONTHLY_ALLOWANCE` (default 50000) on first login each UTC month
- Low balance warning: check threshold after deduct, inject warning message into response
- `GET /admin/stats` — current totals (users, tokens, used this month)
- `GET /admin/stats/usage?from=&to=` — daily usage breakdown per user
- `last_allowance_month` column on `token_balance` table

### Out of Scope
- Scheduled cron-based recharge (login-triggered only)
- Email/webhook notifications for low balance
- Per-user allowance override API (deferred to later phase)
- Payment/Stripe integration

## Capabilities

### New Capabilities
- `token-auto-recharge`: Monthly allowance credit — tracks last credited month, idempotent per-user per-month
- `token-stats`: Admin stats endpoints — aggregated usage queries from token_transaction

### Modified Capabilities
- `token-budget`: Post-deduct low-balance warning — emits warning when balance drops below threshold

## Approach

1. Add `lastAllowanceMonth` (string, YYYY-MM) to `TokenBalanceTable` via Drizzle migration
2. In `Identity.upsertFromAuth`, after upsert, check if `lastAllowanceMonth < current UTCMonth` → call `credit()` with allowance amount + update `lastAllowanceMonth`
3. In `Budget.deduct()`, after successful deduction, check if new balance < threshold → store warning state
4. Surface warning via existing message flow (inject into system message or response)
5. New `Identity.stats()` + `Identity.usageStats(from, to)` methods, exposed as admin HTTP endpoints

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/core/src/account/sql.ts` | Modified | Add `lastAllowanceMonth` column |
| `packages/opencode/src/identity/index.ts` | Modified | Auto-recharge in upsertFromAuth; new stats methods |
| `packages/opencode/src/provider/budget.ts` | Modified | Low-balance check in deduct() |
| `server/routes/instance/httpapi/groups/admin.ts` | Modified | Add stats endpoints |
| `server/routes/instance/httpapi/handlers/admin.ts` | Modified | Implement stats handlers |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Double-credit on concurrent logins | Low | SQLite tx with IMMEDIATE; idempotent month check |
| Large token_transaction table on stats query | Med | Indexed on (userId, createdAt); date-range filter required |
| Admin API exposure without auth | Low | Reuse existing Authorization middleware |

## Rollback Plan

- Unset `OPENCODE_TOKEN_MGMT` — gates all token management
- Revert migration for `lastAllowanceMonth` column
- No data loss: transactions are append-only, allowance is a credit entry

## Dependencies

- Fase 1+2 complete (Identity.Service, Budget.Service, token_balance/transaction tables)
- Drizzle migration step for column addition

## Success Criteria

- [ ] First login each month credits allowance; second login same month does not
- [ ] Balance below threshold triggers warning in LLM response
- [ ] `GET /admin/stats/usage?from=2026-07-01&to=2026-07-23` returns daily per-user breakdown
- [ ] All gated behind `OPENCODE_TOKEN_MGMT`

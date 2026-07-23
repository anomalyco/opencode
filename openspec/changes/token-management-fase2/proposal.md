# Proposal: token-management — Fase 2 (Budget Enforcement & Free-First Routing)

## Intent

Fase 1 built the identity layer and Budget stub. Fase 2 makes budget enforcement real: block paid model requests when balance is zero, auto-fallback to free Zen models, and deduct actual usage from the user's token balance.

## Scope

### In Scope
- Budget.Service real implementation (resolveModel, check, deduct)
- Pre-request model resolution in LLM.run — check balance, swap paid→Zen when exhausted
- Post-request deduction in processor.ts step-finish
- Free-first routing: Zen models (providerID starts with `"opencode"`) bypass deduction
- Zero-balance fallback: auto-route to closest available Zen model
- BudgetExhaustedError → GO_UPSELL_MESSAGE integration

### Out of Scope
- Admin UI for manual credit management
- Usage analytics dashboard
- Auto-recharge or payment integration
- Per-model or per-context pricing tiers
- Notification emails

## Capabilities

### New Capabilities
- `token-budget`: Budget enforcement — pre-check balance, deduct usage, free-first model routing, zero-balance fallback

### Modified Capabilities
- None

## Approach

Two injection points: (1) pre-request in `LLM.run` — call `Budget.Service.resolveModel(currentUserID, input.model)` before `provider.getLanguage`, swap model if needed; (2) post-request in `processor.ts` step-finish — call `Budget.Service.deduct()` with real usage. Add `Budget.Service` to both LLM and processor live layers. Gate behind `OPENCODE_TOKEN_MGMT`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/opencode/src/provider/budget.ts` | Modified | Replace stub with real resolveModel, check, deduct |
| `packages/opencode/src/session/llm.ts` | Modified | Pre-request resolveModel call; add Budget to layer |
| `packages/opencode/src/session/processor.ts` | Modified | Post-request deduct call; add Budget to layer |
| `packages/opencode/src/session/retry.ts` | Modified | Integrate BudgetExhaustedError with upsell |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Deducting before actual provider usage confirmed | Low | Deduct only after `getUsage` returns real tokens |
| Model swap breaks user session expectations | Med | Log swapped model; user sees Zen model in UI |
| Race condition on concurrent requests | Low | SQLite tx with `IMMEDIATE` for balance ops |

## Rollback Plan

- Unset `OPENCODE_TOKEN_MGMT` env var — Budget.Service falls back to no-op defaultLayer
- Revert the llm.ts and processor.ts changes
- No data migration needed (deduct writes append-only tx log)

## Dependencies

- Fase 1 Identity.Service (getCurrent + getByID) — complete
- Fase 1 Budget.Service interface — complete
- Fase 1 TokenBalanceTable + TokenTransactionTable — complete

## Success Criteria

- [ ] Pre-request: paid model with zero balance is blocked or swapped to Zen
- [ ] Post-request: real usage deducted from balance and recorded in TokenTransactionTable
- [ ] Zen models (`opencode*` providerID) never trigger deduction
- [ ] BudgetExhaustedError surfaces as upsell message to user
- [ ] All gated behind `OPENCODE_TOKEN_MGMT`; unset = no behavioral change

---
name: trial-balance
description: Use this when reviewing a trial balance, investigating out-of-balance conditions, flagging anomalies, or preparing a working trial balance.
---

## Use this when
- The user asks to review or analyze a trial balance
- A trial balance does not balance (debits != credits)
- Analytical review or variance analysis is needed on GL balances
- The user needs a working trial balance with adjustments
- Anomalies or unexpected balances need investigation
- Preparing for audit fieldwork or management reporting

## Workflow
1. **Determine TB type**: unadjusted (pre-AJE), adjusted (post-AJE), or post-closing (after closing entries zeroed out temporary accounts). Ask if unclear.
2. **Pull account data**: call `pennylane_ledger_accounts_list` to get the full chart of accounts with current balances for the target period.
3. **Pull entry detail for investigation**: call `pennylane_ledger_entries_list` filtered by period to get the journal entries behind the balances. Use this for drill-down on anomalies.
4. **Validate the fundamental equation**: total debits must equal total credits. If they do not, this is a system-level error — investigate immediately before any analytical work.
5. **Perform analytical procedures**:
   - **Period-over-period (POP)**: compare each account balance to the same account in the prior period. Calculate the dollar change and percentage change.
   - **Budget-to-actual**: if budget data is available, compare actual to budget. Flag variances >10% or >$5,000 (whichever is lower).
   - **Reasonableness test**: do balance sheet accounts make sense? (e.g., cash should be positive, accumulated depreciation should be negative, retained earnings should roll forward correctly).
   - **Trend analysis**: for P&L accounts, is the run-rate consistent with prior months? Flag spikes or drops.
6. **Flag anomalies**: apply the anomaly detection rules (below) to every account. Present flagged items prominently.
7. **Recommend adjustments**: for each flagged item, recommend an action — investigate, post AJE, reclassify, or accept with explanation.
8. **Prepare the working trial balance**: if this is for audit or close, present the TB in a three-column format: unadjusted balance, adjustments, adjusted balance.

## Accounting Judgment
- **Anomaly detection thresholds** (flag any account meeting these criteria):
  - **Wrong-direction balance**: asset or expense account with a credit balance, or liability/equity/revenue account with a debit balance. Common legitimate exceptions: accumulated depreciation (credit in an asset category), contra-revenue accounts (debit in revenue category). All others require investigation.
  - **Dormant account with new activity**: an account with zero balance for 3+ months that suddenly has a balance. Could indicate misposting.
  - **Magnitude spike**: balance changed by >20% AND >$5,000 compared to prior period, with no known business reason. Both conditions must be met to flag.
  - **New accounts**: accounts created during the period that were not in the prior-period chart of accounts. Verify proper authorization and classification.
  - **Round-number balances**: expense accounts with exact round-number balances (e.g., $50,000.00) over $10,000 suggest an estimate or accrual rather than actual transactions. Verify support exists.
  - **Unusual account relationships**: depreciation expense changed but fixed assets did not (or vice versa). Interest expense exists but no debt on the balance sheet. Revenue increased but AR did not change proportionally.
- **Balance sheet reasonableness checks**:
  - Cash: should tie to bank reconciliation.
  - AR: aging should not have significant amounts >90 days unless an allowance exists. AR turnover should be consistent with payment terms.
  - Inventory: compare to COGS for implied turnover. Stagnant inventory may need a write-down.
  - Fixed assets: net book value should decrease over time (depreciation) unless new purchases offset. Verify additions/disposals.
  - AP: should reflect actual outstanding invoices. A declining AP with constant purchases may indicate cash flow strain.
  - Accrued liabilities: should reset monthly if auto-reversing. An accrued liability that only grows is stale.
  - Retained earnings: opening balance must equal prior-year ending balance. Any difference indicates a prior-period adjustment or error.
- **P&L reasonableness checks**:
  - Revenue: should correlate with industry seasonality, contract schedule, or historical pattern.
  - COGS: gross margin should be stable. A sudden margin change requires explanation (pricing, mix, cost change).
  - Payroll: should be stable month-to-month unless there were hires/terminations. Compare headcount to expense.
  - Rent/occupancy: fixed costs that should not change unless a lease started/ended.
  - Depreciation: should be stable month-to-month unless assets were added/disposed.

## Output Format
- **Conclusion**: "Trial balance for [Period] balances / does not balance. X anomalies flagged for investigation."
- **Summary**:

| Category | Debit Total | Credit Total |
|----------|-------------|--------------|
| Assets | $XXX,XXX | |
| Liabilities | | $XXX,XXX |
| Equity | | $XXX,XXX |
| Revenue | | $XXX,XXX |
| Expenses | $XXX,XXX | |
| **Total** | **$XXX,XXX** | **$XXX,XXX** |

- **Anomaly Report**:

| # | Account | Balance | Flag | Prior Period | Variance | Recommended Action |
|---|---------|---------|------|-------------|----------|-------------------|
| 1 | 1200 - AR | $150,000 | Spike +35% | $111,000 | $39,000 | Investigate — verify new invoices |
| 2 | 5400 - Misc Expense | ($2,300) | Credit balance | $1,800 | ($4,100) | Reclassify — likely credit memo misposted |

- **Working Trial Balance** (if preparing adjusted TB):

| Account | Unadjusted | AJE Debits | AJE Credits | Adjusted |
|---------|-----------|------------|-------------|----------|

- **Risks**: balances that may indicate misstatement, fraud, or control failure.
- **Missing Info**: prior-period data not available, budget not provided, etc.
- **Next Action**: single most important follow-up.

## Edge Cases
- **Out-of-balance TB**: this should never happen in a double-entry system. Common causes: direct database edits bypassing the accounting engine, incomplete data import, system migration errors, one-sided entries posted by integrations. Do not attempt analytical review until the imbalance is resolved.
- **Post-closing TB**: only balance sheet accounts should have balances. If any P&L account has a non-zero balance, the closing entry was incomplete or incorrect.
- **Multi-entity consolidation TB**: ensure intercompany eliminations have been posted before reviewing the consolidated TB. Un-eliminated IC balances will inflate assets/liabilities.
- **Currency translation**: if the entity reports in a currency different from its functional currency, the translation adjustment (CTA) must appear in other comprehensive income (equity). A TB without CTA when foreign operations exist is incomplete.
- **Interim vs. annual TB**: interim TBs may have less precision in estimates (tax provision, bonus accrual). Note that interim balances are estimates and may be adjusted at year-end.
- **Chart of accounts changes**: if accounts were renumbered or consolidated during the period, prior-period comparison requires mapping. Flag if the mapping is not available.
- **Suspense accounts**: any balance in a suspense or clearing account at period-end must be reclassified. These accounts should be zero at close.

## Guardrails
- **Never present a TB that does not balance without prominently flagging the imbalance**. This is a critical error.
- **Never accept "it's always been that way" as an explanation for an anomaly**. If a wrong-direction balance has persisted for months, it is an error that has been ignored, not a feature.
- **Always compare to prior period**. A TB without context is useless. The variance is where the insights are.
- **Do not adjust balances without a journal entry**. Every proposed change must have a corresponding JE with full documentation.
- **Flag suspense account balances**: any balance remaining in suspense, clearing, or "to-be-classified" accounts at period-end is a control failure. These must be cleared before close.
- **Verify retained earnings rollforward**: opening retained earnings + net income - dividends = closing retained earnings. If this does not hold, a prior-period adjustment was made — find it and document it.

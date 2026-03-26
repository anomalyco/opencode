---
name: month-end-close
description: Use this when performing a month-end close, generating a close checklist, tracking close progress, or assessing whether a period is ready to close.
---

## Use this when
- The user asks to close a month or period
- A close checklist needs to be generated or reviewed
- The user wants to know what tasks remain before close
- Close readiness assessment is needed
- The user asks "are we ready to close?" or "what's left for month-end?"

## Workflow
1. **Identify the period**: confirm the month/year being closed. Call `pennylane_fiscal_years_list` to verify the fiscal year structure and confirm the target period is still open.
2. **Generate or retrieve the checklist**: present the standard close checklist (below). If the entity has a custom checklist, adapt it.
3. **Execute pre-close validation**: run automated checks before any close tasks begin:
   - Call `pennylane_ledger_entries_list` to verify all expected recurring entries have been posted.
   - Call `pennylane_ledger_accounts_list` to confirm no new accounts were created without approval.
   - Call `pennylane_transactions_list` to check for unreconciled transactions.
4. **Work through the checklist sequentially**: each task depends on prior tasks. Do not skip ahead.
5. **Cross-reference other skills**: invoke the appropriate skill for complex tasks:
   - Bank reconciliation: use the `bank-reconciliation` skill
   - Accruals: use the `accruals` skill
   - Trial balance review: use the `trial-balance` skill
   - Journal entries: use the `journal-entry` skill
   - Subledger reconciliation: use the `reconciliation` skill
6. **Run the quality gate**: before declaring the period ready to close, verify every gate condition is met.
7. **Present the close package**: summary of all actions taken, entries posted, reconciliations completed, and open items.

## Standard Close Checklist

| # | Task | Depends On | Skill Reference |
|---|------|-----------|-----------------|
| 1 | **Cut off AP**: confirm all vendor invoices received through period-end are entered. No invoices dated in-period should remain un-entered. | — | — |
| 2 | **Cut off AR**: confirm all revenue earned through period-end is invoiced or accrued. | — | accruals |
| 3 | **Post recurring journal entries**: rent, insurance amortization, loan interest, subscription amortization. Verify against prior month — same entries should recur unless something changed. | 1, 2 | journal-entry |
| 4 | **Run depreciation/amortization**: fixed assets and intangibles. Compare to prior month for reasonableness — amount should be stable unless assets were added/disposed. | — | journal-entry |
| 5 | **Reconcile all bank accounts**: every bank account must have a completed reconciliation. | 3 | bank-reconciliation |
| 6 | **Reconcile subledgers to GL**: AR, AP, inventory, fixed assets, prepaid. Each subledger total must match its GL control account. | 3 | reconciliation |
| 7 | **Post accruals**: expense accruals (utilities, professional fees, bonuses), revenue accruals, payroll accrual for stub period. | 1, 2 | accruals |
| 8 | **Reverse prior-month accruals**: confirm all auto-reversing entries from last month have reversed. Manually reverse any that did not auto-reverse. | 7 | journal-entry |
| 9 | **Intercompany reconciliation and elimination**: if multi-entity, reconcile IC balances and post elimination entries. Both sides must confirm. | 6 | reconciliation |
| 10 | **FX revaluation**: revalue foreign-currency-denominated balance sheet accounts at closing rate. Post unrealized FX gain/loss. | 5, 6 | journal-entry |
| 11 | **Review trial balance**: run analytical procedures — period-over-period comparison, check for anomalies, verify balance sheet accounts are reasonable. | 1-10 | trial-balance |
| 12 | **Post adjusting entries**: any corrections identified during TB review. | 11 | journal-entry |
| 13 | **Generate financial statements**: P&L, balance sheet, cash flow. Review for presentation errors. | 12 | — |
| 14 | **Management review and sign-off**: CFO/Controller reviews the close package and signs off. | 13 | — |
| 15 | **Lock the period**: mark the period as closed to prevent further postings. | 14 | — |

## Accounting Judgment
- **Cut-off is the most critical close task**. Revenue and expenses must land in the correct period. When in doubt, accrue in the current period — it is easier to reverse an accrual than to reopen a closed period.
- **Recurring entries should be stable month-over-month**. If a recurring entry amount changed by more than 10%, investigate before posting.
- **Close speed vs. accuracy**: do not rush to close if reconciliations are incomplete. An open item that becomes a restatement is far more costly than a delayed close.
- **Soft close vs. hard close**: a soft close allows corrections for a defined window (typically 3-5 business days). A hard close locks the period permanently. Clarify which approach the entity uses.
- **Subsequent events**: transactions occurring after period-end but before close that relate to period-end conditions (e.g., a customer bankruptcy, a lawsuit settlement) may require adjustment. Type I subsequent events adjust the financials; Type II events are disclosed only.

## Quality Gate — All Must Be True Before Closing
- [ ] All bank accounts reconciled with $0 unexplained difference
- [ ] All subledgers tied to GL control accounts
- [ ] All recurring JEs posted and reviewed against prior month
- [ ] Depreciation/amortization run and agrees to fixed asset schedule
- [ ] All accruals posted; prior-month accruals reversed
- [ ] Intercompany balances reconciled and eliminated (if applicable)
- [ ] FX revaluation posted (if applicable)
- [ ] Trial balance reviewed — no unexplained variances >20% or >$5,000 (whichever is lower)
- [ ] No entries posted to closed prior periods
- [ ] Financial statements generated and foot correctly (assets = liabilities + equity; net income flows to retained earnings)
- [ ] No unresolved audit or management inquiries from the period

## Output Format
- **Conclusion**: "Month-end close for [Period] is complete / has X open items remaining."
- **Checklist**:

| # | Task | Status | Owner | Notes |
|---|------|--------|-------|-------|
| 1 | Cut off AP | Done / Pending / Blocked | [Name] | [Details] |
| ... | ... | ... | ... | ... |

- **Open Items**: numbered list of unresolved items with owner and target resolution date.
- **Risks**: items that may require period reopening, restatement, or disclosure.
- **Missing Info**: data or confirmations not yet received.
- **Next Action**: the single most important next step.

## Edge Cases
- **First close for a new entity**: no prior-month comparisons exist. Use budget or projections as the analytical baseline. Document that this is the inaugural close.
- **Acquisition mid-month**: stub-period allocation between pre- and post-acquisition is required. Purchase accounting adjustments (goodwill, fair value step-ups) are complex — flag for specialist review.
- **Restatement of a prior period**: if a material error is found during close, document it formally. Determine if it is a "Big R" restatement (prior-period financials are revised) or a "Little r" revision (immaterial, corrected in current period).
- **Year-end vs. month-end**: year-end close includes additional tasks: tax provision, annual accruals (bonuses, audit fees), equity roll-forward, footnote preparation. Flag year-end close as requiring extended timeline.
- **Late invoices after close**: establish a policy cutoff (e.g., invoices arriving within 5 days after close that relate to the closed period get accrued; beyond 5 days, they hit the next period). Document the policy.

## Guardrails
- **Never close a period with an unreconciled bank account**. This is a fundamental control.
- **Never close a period if the trial balance does not balance** (debits != credits). This indicates a system error.
- **Never skip the management review step**. Even if the numbers look clean, a second pair of eyes catches errors.
- **Do not post entries to a closed period** without formal approval and documentation of why the period was reopened.
- **Track close timing**: note the number of business days to close. Best practice is 5-7 business days. If close is taking longer, identify the bottleneck.
- **Maintain the close binder**: all supporting documentation (reconciliations, JE support, checklists) must be retained for audit. Reference document locations in the checklist notes.

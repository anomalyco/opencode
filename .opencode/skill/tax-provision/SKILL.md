---
name: tax-provision
description: Use this when estimating or reviewing an income tax provision, calculating effective tax rate, or preparing current/deferred tax analysis.
---

## Use this when

The user needs to compute or review an income tax provision (ASC 740 / IAS 12), calculate the effective tax rate, analyze current vs deferred tax, evaluate a valuation allowance, or reconcile the ETR to the statutory rate. Also triggered by questions about estimated tax payments, discrete items, or deferred tax asset/liability scheduling.

## Workflow

1. **Confirm scope.** Determine: (a) jurisdiction(s) — federal, state, foreign, (b) reporting framework — US GAAP (ASC 740) or IFRS (IAS 12), (c) period — interim or annual, (d) entity type — C-corp, pass-through, consolidated group.
2. **Gather financial data.** Use `pennylane_ledger_entries_list` filtered to tax-related accounts (income tax payable, deferred tax asset/liability, tax expense). Use `pennylane_fiscal_years_list` to confirm period boundaries. Use `pennylane_transactions_list` to identify payments to tax authorities (estimated payments, extensions).
3. **Compute pretax book income.** Start from net income before tax per the general ledger. Identify and list all book-tax differences.
4. **Classify each difference.**
   - **Permanent differences:** Items in book income that will never appear on the tax return (e.g., meals & entertainment disallowance, tax-exempt interest, officer life insurance, fines and penalties). These affect ETR but create no deferred tax.
   - **Temporary differences:** Items that differ in timing between book and tax (e.g., depreciation methods, accrued liabilities deductible when paid, revenue recognized at different times). These generate deferred tax assets or liabilities.
5. **Calculate current tax.**
   - Taxable income = pretax book income +/- permanent differences +/- reversal of temporary differences.
   - Apply the enacted statutory rate for each jurisdiction. For US federal, apply the flat 21% rate. Layer state taxes using apportioned income.
6. **Calculate deferred tax.**
   - Net change in temporary differences x enacted rate = deferred tax expense (benefit).
   - Schedule DTAs and DTLs by expected reversal period. Separate current-year originations from reversals.
7. **Evaluate valuation allowance (DTA only).**
   - Apply the "more likely than not" threshold (ASC 740-10-30-18 / IAS 12.34).
   - Weigh positive evidence (cumulative profits, backlog, contracts) against negative evidence (cumulative losses, history of expiring NOLs, adverse trends).
   - Negative evidence is generally harder to overcome. Three years of cumulative losses creates a presumption that a VA is needed.
8. **Compute ETR and reconcile.**
   - ETR = total income tax expense / pretax book income.
   - Rate reconciliation: statutory rate +/- state taxes (net of federal benefit) +/- permanent differences +/- rate changes +/- VA changes +/- discrete items +/- foreign rate differential = ETR.
9. **Identify discrete items (interim periods).**
   - Under ASC 740-270, use the estimated annual ETR for ordinary income. Discrete items (enacted rate changes, settlements, VA changes, prior-year true-ups) hit the quarter in which they occur.
10. **Draft output.**

## Accounting Judgment

- Use enacted rates only, not proposed or substantially enacted (GAAP requires enacted; IFRS permits substantively enacted — confirm framework).
- NOL carryforwards: track federal vs state separately; state NOLs often have shorter carryforward periods and different apportionment rules.
- Uncertain tax positions (ASC 740-10 / IFRIC 23): apply a two-step process under GAAP — recognition (more likely than not) then measurement (largest amount > 50% likely). Under IFRS, use expected value or most likely amount.
- Tax credits reduce tax payable dollar-for-dollar; they are not the same as deductions. R&D credits (Section 41) require qualified research expenditure documentation.
- Intercompany transactions in a consolidated group may create temporary differences at the consolidated level even if eliminated for book purposes.

## Output Format

```
CONCLUSION: [Provision appears reasonable / Provision requires adjustment / Insufficient data]
TREATMENT:
  Current tax expense: $[X] (federal) + $[X] (state) + $[X] (foreign) = $[X]
  Deferred tax expense (benefit): $[X]
  Total provision: $[X]
  Effective tax rate: [X]%
RISKS: [VA exposure, uncertain positions, rate change impact, audit risk]
MISSING INFO: [State apportionment data, foreign entity details, NOL schedules, etc.]
NEXT ACTION: [Finalize DTA/DTL rollforward / Prepare rate reconciliation / Engage CPA for UTP analysis / File estimated payment]
```

## Edge Cases

- **Interim periods:** The estimated annual ETR must be recomputed each quarter. If ordinary income is expected to be near zero, small changes in permanent items cause large ETR swings — disclose rather than smooth.
- **Loss entities in a consolidated group:** Exclude loss entities from the consolidated EAETR if no tax benefit can be recognized, then treat their results as discrete items.
- **Rate changes:** When a rate change is enacted, remeasure all DTAs and DTLs at the new rate in the period of enactment. The adjustment flows through continuing operations unless it relates to an item originally recorded in OCI.
- **Intraperiod allocation:** Tax expense must be allocated between continuing operations, discontinued operations, OCI, and equity. Do not dump everything into continuing operations.
- **Pass-through entities:** No entity-level income tax, but may still owe state franchise taxes or entity-level elections (e.g., PTE tax elections). Confirm whether the election is made.

## Guardrails

- This analysis produces an estimate, not a filed tax return. Always recommend CPA or tax advisor review before finalizing any provision that will appear in financial statements.
- Do not provide tax planning advice or recommend structures to minimize tax liability. The role is to measure and report, not to optimize.
- State clearly when a position qualifies as an uncertain tax position requiring ASC 740-10 / IFRIC 23 analysis — do not ignore it because the amount seems small.
- If jurisdictional tax law has changed after your knowledge cutoff, flag it explicitly and recommend verifying current enacted rates.
- Never estimate foreign tax provisions without confirmed local statutory rates and permanent establishment analysis. Flag for specialist review.

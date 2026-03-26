---
name: accruals
description: Use this when calculating, recording, or reversing accruals for expenses or revenue — including stub-period calculations and accrual true-ups.
---

## Use this when
- An expense has been incurred but not yet invoiced (expense accrual)
- Revenue has been earned but not yet billed (revenue accrual)
- Payroll for a stub period needs to be accrued
- Interest on debt needs to be accrued
- Tax liabilities need to be estimated and accrued
- Prior-period accruals need to be reversed or trued up
- The user asks "what should I accrue for?" or "how do I calculate this accrual?"

## Workflow
1. **Identify the accrual type**: expense, revenue, payroll, interest, or tax. Each has a different estimation method.
2. **Determine the accrual period**: confirm the start and end date. For stub periods, calculate the exact number of days.
3. **Select the estimation method**:
   - **Contractual/known amount**: use the actual amount if available (e.g., rent per lease, interest per loan agreement). This is the most reliable.
   - **Pro-rata (time-based)**: annual amount / 365 * days in stub period. Use for expenses that accrue evenly over time (interest, rent, insurance).
   - **Historical run-rate**: average of last 3-6 months of actuals. Use for variable expenses with no contractual basis (utilities, professional fees). State the period used and the average.
   - **Percentage of completion**: for revenue recognition on long-term contracts (ASC 606). Requires input-based or output-based measure of progress.
4. **Validate accounts**: call `pennylane_ledger_accounts_list` to confirm the expense/revenue account and the accrual liability/asset account exist.
5. **Check for existing accruals**: call `pennylane_ledger_entries_list` filtered by the accrual liability account and period to see if an accrual has already been posted. Avoid double-counting.
6. **Build the journal entry**: Dr Expense (or Asset) / Cr Accrued Liability (or Deferred Revenue).
7. **Set up the reversal**: specify whether the entry auto-reverses on the first day of the next period or requires manual true-up. **Default preference: auto-reverse** unless the accrual is expected to persist across multiple periods (e.g., litigation reserve, long-term bonus).
8. **True-up**: when the actual invoice or payment arrives, compare to the accrual. If the difference is material (>10% of the accrual or >$5,000), investigate the estimation method and adjust future accruals.

## Accounting Judgment
- **Auto-reverse is the default** for routine monthly accruals (utilities, professional fees, payroll stub). This prevents stale accruals from accumulating. Manual true-up is used when the accrual spans multiple periods or the timing of resolution is uncertain.
- **Expense accrual entries**:
  - Dr [Expense account] / Cr [Accrued Expenses — current liability]
  - Reverse next period: Dr Accrued Expenses / Cr [Expense account]
- **Revenue accrual entries**:
  - Dr [Accrued Revenue — current asset] / Cr [Revenue account]
  - Reverse when billed: Dr Revenue / Cr Accrued Revenue; then Dr AR / Cr Revenue
- **Payroll stub-period calculation**:
  - Identify the pay period that straddles month-end (e.g., pay period Dec 16 - Dec 31 but paid Jan 5).
  - Calculate: (annual salary / 260 work days) * work days in the stub period. Include employer-side taxes (FICA 7.65%, FUTA, SUTA) and benefits.
  - If hourly: use average hours from prior 4 pay periods * hourly rate * stub days / pay period days.
- **Interest accrual**:
  - Simple interest: Principal * annual rate / 365 * days elapsed since last payment.
  - Confirm the day-count convention (actual/360, actual/365, 30/360) per the loan agreement. Using the wrong convention is a common error.
- **Tax accruals**:
  - Income tax: use the estimated annual effective tax rate * year-to-date pre-tax income, less taxes already paid/accrued. Adjust quarterly as estimates refine.
  - Sales/VAT tax: accrue based on taxable transactions in the period. This should be precise, not estimated.
  - Property tax: annual assessment / 12 months. Accrue monthly even if paid semi-annually.
- **Conservatism**: when estimating, err on the side of accruing more rather than less. An over-accrual is corrected next period; an under-accrual understates liabilities.

## Output Format
- **Conclusion**: "Accrual of $X,XXX for [description] for the period [start] to [end]."
- **Treatment**: cite the basis (contractual, pro-rata, historical run-rate) and the calculation.
- **Calculation Detail**:
  - Method: [contractual / pro-rata / run-rate / % completion]
  - Basis: [specific numbers, e.g., "$120,000 annual rent / 365 days * 15 stub days"]
  - Result: $X,XXX.XX
- **Journal Entry** (use journal-entry skill format):

| Date | Account # | Account Name | Debit | Credit | Memo |
|------|-----------|--------------|-------|--------|------|
| YYYY-MM-DD | XXXX | [Expense/Revenue] | $X,XXX.XX | | [Period] accrual — [basis] |
| YYYY-MM-DD | XXXX | [Accrued Liability/Asset] | | $X,XXX.XX | Auto-reverses [date] |

- **Reversal Entry** (if auto-reverse):

| Date | Account # | Account Name | Debit | Credit | Memo |
|------|-----------|--------------|-------|--------|------|
| YYYY-MM-01 | XXXX | [Accrued Liability/Asset] | $X,XXX.XX | | Reversal of [period] accrual |
| YYYY-MM-01 | XXXX | [Expense/Revenue] | | $X,XXX.XX | Reversal of [period] accrual |

- **Risks**: estimation uncertainty, missing invoices, FX exposure.
- **Missing Info**: what is needed to refine the estimate.
- **Next Action**: single next step.

## Edge Cases
- **Partial periods (stub days)**: always calculate using exact calendar days, not rounded months. A "half-month" accrual is imprecise — use actual days (e.g., 15/31 for the first half of January, not 0.5).
- **FX accruals**: accrue in the foreign currency, then translate to functional currency at the period-end rate. The FX component creates an unrealized gain/loss that must be recorded separately.
- **Intercompany accruals**: both entities must record their side. The selling entity accrues revenue; the buying entity accrues expense. Amounts must match in the common currency before elimination.
- **Stale accruals**: an accrual that has been on the books for more than 2 months without being reversed or trued up is stale. Investigate: was the invoice received and booked to a different account? Has the vendor been paid without matching the accrual? Was the service actually rendered?
- **Accrual vs. provision**: accruals are for known obligations with estimated amounts. Provisions (ASC 450 / IAS 37) are for probable but uncertain obligations (e.g., litigation). Provisions require disclosure and are not auto-reversed. If the user describes an uncertain obligation, it is a provision, not an accrual — flag this distinction.
- **Bonus accruals**: if bonuses are discretionary, accrue ratably over the service period based on the estimated total. Adjust quarterly. If bonuses are contractual/formulaic, the calculation is deterministic — use the formula. Bonus accruals do NOT auto-reverse; they persist until paid.
- **De minimis accruals**: if the accrual amount is below the entity's materiality threshold (ask; typical $500-$1,000 for monthly accruals), it may be skipped with documentation. But recurring small accruals that aggregate to a material amount should still be recorded.
- **True-up variance analysis**: when the actual amount differs from the accrual by more than 10%, document the reason (timing, price change, volume variance) and adjust the estimation method for future periods.

## Guardrails
- **Flag accruals without a documented basis**. Every accrual must state the method and inputs. "Management estimate" alone is insufficient — what data supports the estimate?
- **Flag stale accruals** (unreversed for >2 months). These bloat the balance sheet and obscure actual expense timing.
- **Never accrue revenue that has not been earned**. Revenue accruals require evidence of performance (delivery, service completion, milestone achievement per ASC 606).
- **Verify the reversal was processed**: after the reversal date, check `pennylane_ledger_entries_list` to confirm the reversal posted. Unreversed accruals cause double-counting of expenses.
- **Do not net accruals**. If an expense accrual and a revenue accrual exist for the same counterparty, record them separately unless a legal right of offset exists.
- **Document the estimation method** so that next month's preparer can replicate or refine it. Include the formula, the inputs, and the source of inputs.

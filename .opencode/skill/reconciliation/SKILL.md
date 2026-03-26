---
name: reconciliation
description: Use this when reconciling two data sources — bank to book, subledger to GL, intercompany balances, or any balance comparison that needs to tie out.
---

## Use this when
- The user needs to compare two balances or data sources and explain the difference
- A subledger (AR, AP, inventory, fixed assets) needs to tie to the general ledger control account
- Intercompany balances need to be confirmed between entities
- Any "why doesn't X match Y" question arises
- Month-end or audit prep requires formal reconciliation documentation

## Workflow
1. **Define the two sides**: identify the source of truth and the comparison source. Ask the user if unclear. Typical pairs: bank statement vs. GL cash, AR subledger vs. GL AR control, payroll register vs. GL payroll expense.
2. **Pull data from Pennylane**:
   - Call `pennylane_ledger_accounts_list` to identify the relevant GL account(s).
   - Call `pennylane_ledger_entries_list` filtered by account and period to get the book-side detail.
   - Call `pennylane_transactions_list` to get transaction-level data for matching.
3. **Establish ending balances**: state both balances clearly with their as-of date. If either balance is unavailable, flag it as missing info.
4. **Identify reconciling items**: categorize every difference into one of:
   - **Timing differences**: items recorded in one source but not yet in the other (e.g., outstanding checks, deposits in transit, pending invoices).
   - **Errors**: items recorded incorrectly in one or both sources (wrong amount, wrong account, duplicates).
   - **Omissions**: items missing from one source entirely.
   - **Permanent differences**: items that will never reconcile (e.g., bank fees not yet booked, intercompany markup).
5. **Quantify each item**: every reconciling item must have a dollar amount. No vague descriptions like "various items."
6. **Prove the tie-out**: Source A balance +/- reconciling items = Source B balance. If it does not tie, the reconciliation is incomplete — state the unexplained difference explicitly.
7. **Recommend actions**: for each reconciling item, state the resolution — book a JE, investigate, write off, or escalate.

## Accounting Judgment
- **Materiality threshold**: ask the user for their materiality threshold. If unknown, use these defaults as starting points: immaterial if <$500 or <0.5% of the account balance (whichever is greater). Items below threshold can be grouped as "immaterial timing differences" but must still be quantified in aggregate.
- **Aging of reconciling items**: any item outstanding for more than 30 days in a bank rec or 60 days in a subledger rec should be flagged for investigation. Items over 90 days should be escalated.
- **Direction of proof**: always reconcile FROM the source of truth TO the comparison source. For bank recs, the book is adjusted to the bank. For subledger recs, the subledger is the source of truth.
- **Intercompany**: both sides must confirm the balance. A one-sided reconciliation is incomplete. Differences often stem from timing of goods in transit, markup elimination, or FX translation. Intercompany differences must net to zero in consolidation.
- **Payroll reconciliation**: compare gross wages per the payroll register to the GL salary expense. Common differences: employer taxes, benefits, accrued PTO, bonus accruals.
- **Tax reconciliation**: compare the tax provision per the GL to the tax return. Book-tax differences must be classified as permanent or temporary.

## Output Format
- **Conclusion**: one sentence — "The reconciliation is complete / has an unexplained difference of $X,XXX."
- **Reconciliation Table**:

| # | Description | Amount | Category |
|---|-------------|--------|----------|
| | **Source A balance (as of YYYY-MM-DD)** | **$XX,XXX.XX** | |
| 1 | [Reconciling item description] | $X,XXX.XX | Timing / Error / Omission |
| 2 | [Reconciling item description] | ($X,XXX.XX) | Timing / Error / Omission |
| | **Adjusted balance** | **$XX,XXX.XX** | |
| | **Source B balance (as of YYYY-MM-DD)** | **$XX,XXX.XX** | |
| | **Unexplained difference** | **$0.00** | |

- **Risks**: items that could indicate control weaknesses, fraud, or misstatement.
- **Missing Info**: data not yet obtained (e.g., bank statement not available, sub-entity not reported).
- **Follow-up Actions**: numbered list with owner and deadline for each open item.

## Edge Cases
- **Multi-currency reconciliation**: reconcile in the functional currency. State the FX rate used. Differences caused by rate fluctuation are translation adjustments, not errors — but they must be quantified.
- **Partial period**: if comparing a full-month GL to a mid-month bank statement, timing differences will be large. Note the date mismatch prominently.
- **Negative balances**: an AR control with a credit balance or an AP control with a debit balance is abnormal. Flag immediately — common causes are over-payments, credit memos, or mispostings.
- **Stale reconciling items**: items that appear on three or more consecutive reconciliations with no resolution should be escalated. They may indicate a systemic process failure.
- **Net vs. gross presentation**: ensure both sides are presented on the same basis. A gross AR subledger vs. a net-of-allowance GL will never tie without the allowance as a reconciling item.
- **Consolidation eliminations**: intercompany balances that do not eliminate cleanly often indicate unrecorded transactions or timing differences at subsidiary level. Check that both entities have closed the same period.

## Guardrails
- **Never declare a reconciliation complete if there is an unexplained difference**. State the gap and recommend investigation.
- **Never assume a difference is immaterial without quantifying it**. Even if likely small, compute it.
- **Never alter source data to force a tie**. Reconciling items must explain the difference, not hide it.
- **Always date-stamp the reconciliation**. State the as-of date for both sides.
- **Flag control weaknesses**: if the same type of error recurs monthly, recommend a process improvement, not just a correcting entry.
- **Retain the trail**: every reconciling item should reference a transaction ID, invoice number, or check number so it can be traced back to source documents.

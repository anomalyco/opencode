---
name: bank-reconciliation
description: Use this when reconciling bank statements to the general ledger cash account using Pennylane bank data.
---

## Use this when
- The user needs to reconcile a bank statement to the GL cash account
- Month-end close requires bank reconciliation sign-off
- A cash balance discrepancy needs investigation
- The user asks "why doesn't my cash balance match the bank?"
- Preparing bank reconciliation documentation for audit

## Workflow
1. **Identify the bank account**: call `pennylane_bank_accounts_list` to get all connected bank accounts. Confirm which account the user wants to reconcile.
2. **Get bank details**: call `pennylane_bank_accounts_get` with the selected account ID to retrieve the bank-side ending balance and statement date.
3. **Get book-side data**: call `pennylane_ledger_accounts_list` to find the corresponding GL cash account. Then call `pennylane_ledger_entries_list` filtered by that account and the reconciliation period to get all book-side entries.
4. **Get transaction detail**: call `pennylane_transactions_list` filtered to the bank account and period. This gives the granular transaction data needed for matching.
5. **Match transactions**: compare bank transactions to book entries. Match by amount, date, and reference. Categorize unmatched items:
   - **Outstanding checks**: recorded in the book (credit to cash) but not yet cleared at the bank.
   - **Deposits in transit**: recorded in the book (debit to cash) but not yet credited by the bank.
   - **Bank charges/fees**: on the bank statement but not yet recorded in the book (need a JE).
   - **Interest earned**: on the bank statement but not yet recorded in the book (need a JE).
   - **Bank errors**: items the bank recorded incorrectly (rare but must be reported to the bank).
   - **Book errors**: items recorded incorrectly in the GL (need a correcting JE).
   - **NSF/returned items**: deposited checks that bounced — on the bank statement as a debit, may not yet be reversed in the book.
6. **Build the reconciliation**: use the standard two-section format (adjust book balance to bank, or adjust bank balance to book). The result MUST tie to zero.
7. **Draft correcting entries**: for items that require book-side correction (bank fees, interest, NSF), draft the journal entries using the journal-entry skill format.
8. **Compare to prior month**: if available, compare this month's outstanding items to last month's. Items that cleared should no longer appear. Items that remain outstanding for >90 days must be flagged.

## Accounting Judgment
- **Reconciliation direction**: standard practice is to start with the book balance and adjust to the bank balance. Present both sections for clarity.
- **Cut-off**: the reconciliation date must match the bank statement date. If the GL has entries posted after the statement date, exclude them from the reconciliation and note them separately.
- **Outstanding check aging**:
  - 0-30 days: normal, no action needed.
  - 31-90 days: monitor. Contact the payee if check was expected to clear.
  - 91-180 days: investigate. Consider voiding and reissuing if the payee has not cashed it. Check escheatment/unclaimed property rules in the applicable jurisdiction.
  - >180 days: likely stale-dated. Most banks will not honor checks after 180 days. Void the check (Dr Cash / Cr Accounts Payable or Cr Miscellaneous Income depending on circumstances). Research state escheatment requirements before writing off.
- **Deposits in transit**: should clear within 1-3 business days. A deposit in transit for >5 business days is abnormal — investigate whether it was actually sent or if the bank rejected it.
- **Petty cash / cash on hand**: if the entity maintains physical cash, it must be counted and reconciled separately. This skill covers bank accounts only.
- **Multiple bank accounts**: each bank account gets its own reconciliation. Do not net across accounts.
- **Sweep accounts**: if the entity uses a sweep/concentration account, reconcile the master account and each sub-account. Transfers between them are reconciling items only on the individual account recs, not on the consolidated view.

## Output Format
- **Conclusion**: "Bank reconciliation for [Account Name] as of [Date] is complete / has an unexplained difference of $X,XXX."

**Bank Reconciliation Statement**

| | Amount |
|---|--------|
| **Balance per books (GL)** as of YYYY-MM-DD | $XX,XXX.XX |
| Add: Bank charges not yet recorded | $XXX.XX |
| Add: NSF checks not yet recorded | $XXX.XX |
| Less: Interest earned not yet recorded | ($XXX.XX) |
| Less: Book errors (describe) | ($XXX.XX) |
| **Adjusted book balance** | **$XX,XXX.XX** |
| | |
| **Balance per bank statement** as of YYYY-MM-DD | $XX,XXX.XX |
| Add: Deposits in transit | $X,XXX.XX |
| Less: Outstanding checks | ($X,XXX.XX) |
| Add/Less: Bank errors (describe) | $XXX.XX |
| **Adjusted bank balance** | **$XX,XXX.XX** |
| | |
| **Difference (must be $0.00)** | **$0.00** |

- **Outstanding Check Detail**:

| Check # | Date Issued | Payee | Amount | Days Outstanding | Action |
|---------|------------|-------|--------|-----------------|--------|

- **Deposits in Transit Detail**:

| Reference | Date | Description | Amount |
|-----------|------|-------------|--------|

- **Correcting Journal Entries**: list any JEs needed (use journal-entry skill format).
- **Risks**: items suggesting control issues (e.g., unauthorized transactions, unusual payees).
- **Missing Info**: bank statement not received, GL not closed, etc.
- **Next Action**: single next step.

## Edge Cases
- **Multi-currency bank accounts**: reconcile in the bank's currency. Translate to functional currency at the statement date closing rate. The translation difference is a separate FX gain/loss entry, not a reconciling item.
- **Negative book balance (overdraft)**: reclassify to short-term borrowing on the balance sheet if material. The bank rec still reconciles the actual balance.
- **Bank statement period =/= accounting period**: if the bank statement cuts off on the 25th but accounting closes on the 30th, additional cut-off work is needed. Flag this mismatch.
- **Voided checks reissued**: ensure both the void and the reissue are captured. A void without a reissue inflates cash; a reissue without a void creates a duplicate payment risk.
- **ACH/wire same-day settlement**: these should not appear as outstanding items. If they do, the book entry date is likely wrong.
- **Reconciling items from prior months that STILL have not cleared**: list them separately with aging. If they appeared on 3+ consecutive recs, escalate.

## Guardrails
- **The reconciliation MUST tie to $0.00**. If it does not, explicitly state the unexplained difference and do not mark it as complete.
- **Never ignore small differences by rounding**. A $0.01 difference means something did not match. Find it.
- **Never fabricate reconciling items to force a tie**. Every item must be traceable to a specific transaction.
- **Flag any transaction over $10,000 that lacks a clear description** — this may trigger BSA/AML reporting requirements.
- **Flag any check payable to cash or to an employee's personal name** outside of normal payroll — potential fraud indicator.
- **Do not mark the reconciliation as complete until all correcting JEs have been identified** (even if not yet posted).
- **Confirm the GL cash account balance with `pennylane_ledger_entries_list`** — do not rely on the user's stated balance without verification.

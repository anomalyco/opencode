---
name: journal-entry
description: Use this when drafting, reviewing, or correcting a journal entry — standard, adjusting, reversing, or reclassifying entries.
---

## Use this when
- The user asks to draft, post, review, or correct a journal entry
- An adjusting, reversing, or reclassifying entry is needed
- A transaction needs to be recorded in the general ledger
- The user describes a business event that implies a JE (e.g., "we received an invoice", "depreciation hasn't been run")

## Workflow
1. **Identify the entry type**: standard, adjusting (AJE), reversing, or reclassifying. Ask if ambiguous.
2. **Determine the accounting date**: confirm the period is open. Use `pennylane_fiscal_years_list` to verify the target period is not closed.
3. **Validate accounts**: call `pennylane_ledger_accounts_list` to confirm every account number exists and is active. Never fabricate an account number.
4. **Build the entry**: construct debit and credit lines. Verify total debits = total credits before presenting.
5. **Attach support**: every line must reference a supporting document, calculation, or rationale. Flag lines that lack support.
6. **Present for review**: output the formatted JE table. Do NOT post until the user explicitly confirms.
7. **If reversing**: confirm the reversal date (typically first day of next period) and flag if the original entry has already been reversed.
8. **If reclassifying**: show the original entry side-by-side with the proposed reclassification so the user can trace the change.

## Accounting Judgment
- **Conservative default**: when the classification is ambiguous (e.g., capitalize vs. expense), default to expensing unless the user provides evidence meeting capitalization criteria under ASC 350/360.
- **Accrual basis**: always assume accrual accounting unless told otherwise. Cash-basis entries must be explicitly requested.
- **Materiality**: entries below the entity's de minimis threshold (ask if unknown; typical: $500-$5,000) may be expensed regardless of nature.
- **Period matching**: revenue and related expenses must land in the same period. Challenge entries that break matching.
- **Intercompany**: intercompany entries must have a mirror entry on the counterparty's books. Flag if only one side is presented.
- **FX revaluation**: use the closing rate for balance sheet items and the average rate for P&L items unless a specific rate is contractually required. Source the rate — never guess.
- **Common patterns to recognize**:
  - Accruals: Dr Expense / Cr Accrued Liability
  - Prepaid amortization: Dr Expense / Cr Prepaid Asset (straight-line unless stated)
  - Depreciation: Dr Depreciation Expense / Cr Accumulated Depreciation
  - Payroll: Dr Salary Expense + Dr Employer Tax Expense / Cr Cash + Cr Payroll Tax Payable
  - Intercompany: Dr Intercompany Receivable / Cr Revenue (seller) with mirror Dr COGS / Cr Intercompany Payable (buyer)

## Output Format
- **Conclusion**: one sentence stating what the entry accomplishes.
- **Treatment**: cite the relevant standard or policy (e.g., ASC 842, company capitalization policy).
- **Journal Entry Table**:

| Date | Account # | Account Name | Debit | Credit | Memo |
|------|-----------|--------------|-------|--------|------|
| YYYY-MM-DD | XXXX | Name | $X,XXX.XX | | Reference / rationale |
| YYYY-MM-DD | XXXX | Name | | $X,XXX.XX | Reference / rationale |
| | | **Total** | **$X,XXX.XX** | **$X,XXX.XX** | |

- **Risks**: anything that could cause restatement, audit finding, or tax issue.
- **Missing Info**: what you still need from the user to finalize.
- **Next Action**: the single next step (e.g., "confirm and post", "obtain invoice #1234", "verify FX rate").

## Edge Cases
- **Multi-currency entries**: always state the functional currency amount AND the foreign currency amount with the rate used. If the rate source is unknown, ask before proceeding.
- **Entries spanning periods**: split into two entries, one per period. Never book a single entry across closed and open periods.
- **Round-number estimates**: any estimated amount that is a round number above $10,000 (e.g., $50,000 accrual) must be flagged with "Estimate — requires supporting calculation or third-party confirmation."
- **Reversal of a reversal**: refuse and ask the user to clarify intent. A reversal of a reversal is almost always an error.
- **Zero-amount lines**: reject. Every line must have a non-zero debit or credit.
- **Same-account debit and credit**: flag as unusual. Legitimate uses exist (e.g., reclassification within sub-accounts) but most are errors.
- **Tax implications**: flag entries that may trigger sales tax, VAT, withholding, or transfer pricing consequences. Do not compute tax — flag for specialist review.

## Guardrails
- **Never fabricate account numbers**. If an account is not found via `pennylane_ledger_accounts_list`, stop and ask the user.
- **Never post without explicit user confirmation**. Always present the draft first.
- **Flag entries without supporting documentation**. Every entry needs a "why" — an invoice number, a calculation, a contract reference, or a management decision memo.
- **Flag round-number estimates exceeding $10,000**. These suggest the amount was guessed rather than calculated.
- **Verify debits = credits** before presenting. If they do not balance, fix it — do not present an unbalanced entry.
- **Check for duplicates**: before drafting, call `pennylane_ledger_entries_list` filtered by date and amount to see if a similar entry already exists. Warn if a potential duplicate is found.
- **Segregation of duties**: note that the person drafting the entry should not be the same person approving it. Include an "Approved by" placeholder in the output.

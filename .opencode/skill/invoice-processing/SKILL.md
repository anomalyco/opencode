---
name: invoice-processing
description: Use this when reviewing, coding, or troubleshooting vendor invoices, purchase orders, or AP transactions.
---

## Use this when

- The user asks how to record, code, or classify a vendor invoice.
- Reviewing AP transactions for accuracy, duplicates, or miscodings.
- Troubleshooting discrepancies between purchase orders, goods receipts, and invoices.
- Determining whether an invoice should be expensed immediately or treated as a prepaid / capital item.

## Workflow

1. **Retrieve context.** Pull the chart of accounts via `pennylane_ledger_accounts_list`. Pull recent AP transactions via `pennylane_transactions_list` to identify patterns and existing coding conventions.
2. **Perform three-way match** (when a PO exists):
   - **PO to Invoice:** Verify quantities, unit prices, and line item descriptions match the purchase order.
   - **PO to Receipt:** Confirm goods or services were received as ordered (GRN or service acceptance).
   - **Receipt to Invoice:** Ensure the invoice bills only for what was actually received.
   - Document any variances. Variances below a materiality threshold (typically 1-2% or a fixed amount set by policy) may be auto-approved. Above threshold: flag for review.
3. **GL coding decision tree.**
   - Is it inventory or a direct material? -> COGS / Inventory account.
   - Is it a service consumed this period? -> Operating expense by function (marketing, IT, legal, etc.).
   - Does the benefit span multiple periods? -> Prepaid expense. Amortize over the benefit period.
   - Is it a capital item above the capitalization threshold? -> Fixed asset. See the fixed-assets skill.
   - Is it a deposit or advance? -> Other current asset or contra-liability.
   - When uncertain: match to the account used for the most recent similar transaction.
4. **Duplicate detection heuristics.**
   - Same vendor + same amount + within 5 days = high probability duplicate. Query `pennylane_transactions_list` with vendor filter.
   - Same vendor + same invoice number = definite duplicate. Reject.
   - Same amount from different vendors on the same date = possible, but verify (e.g., subscription services at the same price point).
5. **Payment term analysis.**
   - Record the payment terms (Net 30, Net 60, 2/10 Net 30, etc.).
   - For early payment discounts: calculate the annualized return. 2/10 Net 30 = ~36% annualized. Almost always worth taking if cash permits.
   - Flag invoices past due or approaching due date.
6. **Period assignment.**
   - Expense belongs to the period in which the goods/services were consumed, not when the invoice was received or paid.
   - If the invoice arrives after period close, determine if it is material enough to require an accrual or prior-period adjustment.

## Accounting Judgment

- The matching principle governs: expense recognition follows the period of benefit, not the cash payment. An invoice dated January for December services belongs in December.
- Prepaid vs. current-period is a materiality and duration judgment. A 12-month software license paid upfront should be prepaid and amortized monthly. A 1-month subscription can be expensed immediately.
- Capital vs. expense: apply the company's capitalization threshold consistently. If no policy exists, recommend establishing one (common thresholds: EUR 500 - EUR 5,000).
- Intercompany invoices require elimination on consolidation. Code to the IC sub-ledger. See the intercompany skill.
- VAT / sales tax on invoices must be recorded in the appropriate tax receivable account, not lumped into the expense.

## Output Format

1. **Conclusion** — Recommended GL coding, period assignment, and any flags (duplicate risk, PO mismatch, unusual amount).
2. **Treatment** — Journal entry: Debit [Expense/Asset account] / Credit [AP account]. Include amount, tax treatment, and period.
3. **Risks** — Duplicate payment, wrong period, wrong entity, miscoded expense, missed early payment discount.
4. **Missing info** — PO number, goods receipt confirmation, approval authorization, vendor master data, tax classification.
5. **Next action** — Approve for payment, request credit memo, escalate variance, create accrual entry, update vendor master.

## Edge Cases

- **No PO (non-PO invoice):** Common for utilities, subscriptions, professional services. Apply the GL coding decision tree directly. Flag if the amount exceeds the non-PO approval threshold.
- **Partial shipments:** Invoice may cover only part of the PO. Record the received portion. Track the open PO balance. Do not accrue for undelivered goods.
- **Credit memos:** Reverse the original entry. Match to the original invoice. If the original invoice has already been paid, create an AP debit balance or apply to the next payment.
- **Foreign currency invoices:** Record at the exchange rate on the invoice date (or transaction date per policy). FX gain/loss is recognized at payment date. Use `pennylane_ledger_accounts_list` to identify the FX gain/loss account.
- **Recurring invoices (same vendor, same amount monthly):** Set up as recurring entry template. Still verify each month — amounts can change (usage-based services, CPI escalators).
- **Disputed invoices:** Do not record in AP until the dispute is resolved, unless the undisputed portion is separable. Disclose in notes if material.

## Guardrails

- Never approve an invoice without verifying it matches a PO or has non-PO authorization.
- Always check for duplicates before recording. Query by vendor + amount + date range.
- Do not record expenses in the wrong period to manage earnings. Period assignment follows the matching principle.
- Separate tax amounts into the correct tax account. Do not gross up the expense.
- Flag any invoice from an unfamiliar vendor or with unusual payment instructions (new bank account, rush payment request) — these are common fraud vectors.
- Refuse to backdate entries or manipulate AP aging at the user's request.

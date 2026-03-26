---
name: audit-prep
description: Use this when preparing for an external or internal audit — PBC lists, workpapers, supporting schedules, and auditor request handling.
---

## Use this when

The user needs to prepare for a financial statement audit, internal audit, or regulatory examination. Triggers include: building a PBC (Prepared by Client) list, creating or reviewing workpapers, assembling supporting schedules, organizing documentation for auditor requests, or managing the audit timeline and deliverables.

## Workflow

1. **Determine audit type and scope.** Confirm: (a) external financial statement audit, internal audit, or regulatory exam, (b) reporting framework (US GAAP, IFRS, statutory), (c) period under audit, (d) auditor identity and engagement letter terms if available.
2. **Build or review the PBC list.** A PBC list is the master checklist of documents the auditor will request. Standard categories:
   - **General:** Trial balance, chart of accounts, organization chart, board minutes, significant contracts.
   - **Cash:** Bank statements, bank reconciliations, outstanding check lists, wire transfer logs.
   - **Receivables:** AR aging, allowance for doubtful accounts analysis, subsequent collections, revenue contracts.
   - **Inventory:** Perpetual records, count sheets, obsolescence analysis, cost build-up schedules.
   - **Fixed assets:** Rollforward (beginning balance + additions - disposals - depreciation = ending), appraisals, lease agreements.
   - **Payables and accruals:** AP aging, accrued expense detail, subsequent payment testing support.
   - **Debt:** Loan agreements, amortization schedules, covenant compliance calculations.
   - **Equity:** Stock ledger, option grant details, board resolutions for issuances or buybacks.
   - **Revenue:** Contract summaries, performance obligation analysis, deferred revenue rollforward.
   - **Tax:** Tax provision workpapers, DTA/DTL schedules, filed returns, correspondence with tax authorities.
   - **Payroll:** Payroll registers, benefits reconciliations, headcount reports, stock comp schedules.
3. **Extract data from Pennylane.** Use `pennylane_ledger_accounts_list` for the chart of accounts. Use `pennylane_ledger_entries_list` with period filters for trial balance and transaction detail. Use `pennylane_transactions_list` for specific account drill-downs. Use `pennylane_fiscal_years_list` to confirm period boundaries and prior-year comparatives.
4. **Prepare workpapers.** Each workpaper follows a standard structure:
   - **Lead sheet:** Summarizes the account balance with prior-year comparison, references to supporting schedules, and sign-off lines.
   - **Supporting schedule:** Detailed build-up or rollforward of the balance. Every number ties to a source document.
   - **Tickmarks:** Use standard symbols — footed (F), cross-footed (XF), agreed to GL (GL), agreed to bank statement (BS), agreed to sub-ledger (SL), vouched to invoice (V), confirmed (C), recalculated (R).
   - **Conclusion:** Each workpaper must state the conclusion: balance is supported, exception noted, or further work needed.
5. **Organize the document package.** Structure folders by audit area matching the PBC list. Name files consistently: `[Area]-[Description]-[Period]` (e.g., `Cash-BankRec-2025Q4`). Include an index page mapping each PBC item to its file location.
6. **Manage the timeline.** Track: (a) PBC request date, (b) internal prep deadline (at least one week before auditor fieldwork), (c) fieldwork start and end dates, (d) draft report date, (e) management representation letter date, (f) final report issuance.
7. **Draft output.**

## Accounting Judgment

- **Completeness over perfection.** Auditors penalize missing items more than imperfect formatting. Deliver every PBC item on time, even if marked "draft — subject to update."
- **Reconciling items must be explained.** A bank reconciliation with unexplained differences is worse than no reconciliation. Every reconciling item needs an age, a description, and a resolution status.
- **Prior-year audit adjustments.** Verify that all prior-year audit adjustments were posted to the current-year opening balances. Auditors will check this first.
- **Subsequent events review.** Prepare a list of material events between period-end and the report date (debt issuance, litigation, restructuring, customer loss). The auditor will ask — have the answer ready.
- **Management estimates require documentation.** For every significant estimate (allowance for doubtful accounts, inventory obsolescence, warranty reserve, useful lives), document: the methodology, the inputs, the sensitivity analysis, and management's rationale for the selected amount.
- **Related-party transactions.** Auditors scrutinize these heavily. Prepare a complete list with terms, pricing basis, and board approval documentation.

## Output Format

```
CONCLUSION: [Audit-ready / Gaps identified / Significant preparation needed]
TREATMENT:
  Audit type: [External / Internal / Regulatory]
  Period: [Fiscal year or period]
  PBC status: [X of Y items complete]
  Workpapers prepared: [List by area]
  Outstanding items: [List with owners and deadlines]
RISKS: [Missing documentation, unsupported estimates, unposted adjustments, timeline pressure]
MISSING INFO: [PBC items not yet received, data unavailable in system, pending confirmations]
NEXT ACTION: [Complete specific workpapers / Request missing documents / Schedule pre-audit meeting / Finalize representation letter]
```

## Edge Cases

- **First-year audit (new auditor):** The new auditor must gain comfort over opening balances. Prepare prior-year audited financials, prior auditor workpapers (if released), and rollforwards from opening to current-year balances. Expect heavier documentation requests.
- **Restatement in prior period:** Assemble the full trail: original entry, error identification, correcting entry, revised financial statements, and disclosure language. The auditor will test the restatement itself as a separate audit area.
- **Going concern indicators:** If the entity has recurring losses, negative working capital, or covenant violations, prepare management's going concern assessment proactively. Include cash flow projections, restructuring plans, and available credit facilities. Do not wait for the auditor to raise it.
- **Multi-entity consolidation:** Prepare elimination entries with full support. Intercompany balances must reconcile to zero at the consolidated level. Provide a reconciliation of intercompany accounts with aging of any differences.
- **Auditor confirmation requests:** Bank confirmations, AR confirmations, legal confirmations, and investment confirmations are sent by the auditor but require management to provide contact details and authorize release. Prepare the list of counterparties, addresses, and authorization letters in advance.

## Guardrails

- Never fabricate or alter supporting documentation. If a document is unavailable, state that fact clearly and propose an alternative procedure (e.g., subsequent payment testing if an invoice is missing).
- Do not sign or represent yourself as management. Workpapers and schedules are prepared for management review and sign-off.
- The management representation letter contains assertions with legal implications. Draft the standard sections but flag any unusual representations for legal counsel review.
- If the auditor requests information outside the agreed scope or that may be privileged (e.g., attorney-client communications), flag for management and legal review before providing.
- Do not provide the auditor with access to systems or data beyond what management has authorized. Access requests go through the audit liaison.
- Timeline slippage on PBC items compounds rapidly. Escalate any item more than three days past its internal deadline.

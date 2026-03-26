---
name: intercompany
description: Use this when handling intercompany transactions, eliminations, or reconciliations between related entities.
---

## Use this when

- The user asks about transactions between related legal entities (parent, subsidiaries, affiliates).
- Recording management fees, cost allocations, intercompany loans, or inventory transfers between group entities.
- Preparing consolidation entries and intercompany eliminations.
- Reconciling intercompany balances that do not agree across entities.
- Reviewing transfer pricing documentation or identifying transactions that need transfer pricing analysis.

## Workflow

1. **Identify the IC transaction type.** Pull IC account balances and entries via `pennylane_ledger_entries_list` filtering on intercompany accounts. Common types:
   - **Management fees / shared services:** Parent charges subsidiaries for corporate services (finance, HR, IT, legal). Must be at arm's length with a documented allocation methodology.
   - **Cost allocations:** Shared costs (rent, software, insurance) allocated to entities based on headcount, revenue, or usage.
   - **Intercompany loans:** Funding from parent to subsidiary or between siblings. Must carry arm's-length interest rates and documented repayment terms.
   - **Inventory / goods transfers:** One entity manufactures or purchases, another sells to the end customer. Transfer price is critical.
   - **IP licensing / royalties:** One entity owns the IP, others pay for usage rights.
   - **Recharges:** Pass-through of third-party costs incurred by one entity on behalf of another.
2. **Record the transaction in both entities.**
   - The sending entity books a receivable and income (or cost recovery).
   - The receiving entity books a payable and expense (or asset).
   - Amounts, currencies, and periods must match exactly across both books.
   - **JE Template — Management Fee (Sending Entity):**
     - Debit: IC Receivable.
     - Credit: Management Fee Income (or Cost Recovery).
   - **JE Template — Management Fee (Receiving Entity):**
     - Debit: Management Fee Expense (allocated by function).
     - Credit: IC Payable.
3. **Reconcile IC balances.**
   - Pull IC receivable and payable balances from both entities via `pennylane_ledger_accounts_list`.
   - Balances must net to zero across the group. Investigate any difference.
   - Common causes of mismatch: timing (one entity booked, the other has not yet), currency conversion differences, misclassified entries, unrecorded transactions.
   - Resolve before period close. Do not carry unreconciled IC balances into the consolidation.
4. **Prepare elimination entries for consolidation.**
   - **Revenue / Expense elimination:** Eliminate IC revenue in the seller and IC expense in the buyer. Net P&L impact on consolidated statements should be zero.
   - **Receivable / Payable elimination:** Eliminate IC receivable against IC payable. Net balance sheet impact should be zero.
   - **Unrealized profit elimination:** If inventory transferred between entities has not been sold to a third party, eliminate the intercompany markup from consolidated inventory and cost of goods sold.
   - **IC loan elimination:** Eliminate the loan receivable against the loan payable. Eliminate IC interest income against IC interest expense.
   - **IC dividend elimination:** Eliminate dividend income in the parent against the dividend declaration in the subsidiary.
5. **Document the allocation methodology.**
   - For management fees and cost allocations: state the allocation base (headcount, revenue, direct usage), the total cost pool, and each entity's allocated share.
   - Methodology must be consistent period-to-period. Changes require documentation and justification.
   - Retain supporting calculations for audit and transfer pricing review.

## Accounting Judgment

- Transfer pricing is both an accounting and a tax matter. IC transactions must be at arm's length — the price that would be charged to an unrelated party. If you cannot verify arm's length pricing, flag for transfer pricing specialist review.
- The allocation methodology for shared services should reflect actual benefit received, not arbitrary convenience. Allocating all costs to the most profitable entity to minimize group tax is aggressive and may trigger regulatory scrutiny.
- IC loans must have economic substance: documented terms, market-rate interest, actual repayment schedule. Interest-free loans between entities in different tax jurisdictions will attract transfer pricing adjustments.
- Unrealized profit on IC inventory is one of the most commonly missed consolidation adjustments. If Entity A sells to Entity B at a 30% markup and B still holds the inventory at period-end, 30% of that inventory value must be eliminated.
- Currency mismatches on IC balances create FX gains and losses that are real at the entity level but eliminated at the consolidated level (if both entities are within the same group). Track and reconcile these separately.

## Output Format

1. **Conclusion** — IC balance reconciliation status, elimination entries required, and any flags (unreconciled differences, transfer pricing risk, missing documentation).
2. **Treatment** — Journal entries for both entities and the consolidation elimination. Include accounts, amounts, currency, and period. Allocation calculation if applicable.
3. **Risks** — Transfer pricing non-compliance, unreconciled balances at close, unrealized profit not eliminated, inconsistent allocation methodology, tax authority challenge.
4. **Missing info** — IC agreement or contract, allocation methodology documentation, transfer pricing study, entity-level trial balances, confirmation of goods receipt.
5. **Next action** — Reconcile open items, book elimination entries, commission transfer pricing study, align booking timing across entities, update IC agreement.

## Edge Cases

- **Multi-currency IC transactions:** Each entity records in its functional currency. The IC receivable and payable will differ due to FX rates. Reconcile in a common currency. The FX difference is a translation adjustment, not a reconciling item — but only if both entities used the correct rate on the transaction date.
- **Timing mismatches at period-end:** Entity A books the charge in March; Entity B books in April. This creates a temporary IC imbalance. Resolution: accrue in Entity B for March, or agree on a group-wide IC booking deadline (e.g., 5 business days before close).
- **IC transactions with minority interests:** Elimination is 100% regardless of ownership percentage. The minority interest adjustment is applied to the subsidiary's net income after eliminations, not to the elimination itself.
- **Thin capitalization:** If IC loans exceed the entity's equity by a ratio that triggers thin-cap rules in the local jurisdiction, interest deductions may be disallowed. Flag when IC loan balance exceeds 3:1 debt-to-equity for the borrowing entity.
- **Cost-plus vs. resale-minus transfer pricing:** Cost-plus is standard for service entities (cost + margin). Resale-minus is standard for distribution entities (resale price - margin). Using the wrong method for the entity's functional profile will not survive a transfer pricing audit.
- **Dormant entities:** IC balances with dormant or shell entities often go unreconciled. Clean these up — write off if the entity will be liquidated, or formally waive the debt with proper board resolutions.

## Guardrails

- Never book an IC transaction in only one entity. Both sides must be recorded in the same period.
- Always reconcile IC balances before consolidation close. Unreconciled IC is the number one consolidation error.
- Do not set transfer prices at zero or at cost without documentation. Tax authorities in most jurisdictions require arm's-length pricing.
- Flag any IC loan without a written agreement, stated interest rate, and repayment schedule — it may be recharacterized as equity by tax authorities.
- Refuse to structure IC transactions solely to shift profits between jurisdictions without economic substance. Recommend involving a transfer pricing specialist for any new IC pricing arrangement.
- Ensure elimination entries are reversible and clearly labeled as consolidation-only. They must not post to the entity-level books.

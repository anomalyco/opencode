---
name: expense-categorization
description: Use this when categorizing, reclassifying, or reviewing expense transactions — including capital vs expense decisions and policy compliance.
---

## Use this when
- The user needs to categorize or recategorize an expense transaction
- A capital vs. expense determination is required
- Expense policy compliance needs to be checked (travel, meals, entertainment)
- Bulk transaction categorization or review is needed
- A reclassification journal entry is needed to fix miscategorized expenses
- The user asks "where should this go?" or "is this capex or opex?"

## Workflow
1. **Understand the transaction**: get the vendor name, amount, description, date, and any supporting documentation (invoice, receipt, contract).
2. **Determine the nature of the expense**: what was purchased? A service, a tangible asset, a subscription, a reimbursement? The nature drives the classification.
3. **Apply the capital vs. expense decision tree** (below) if the item could be an asset.
4. **Look up the appropriate GL account**: call `pennylane_ledger_accounts_list` to find the correct account. Search by keyword (e.g., "travel", "software", "rent"). If multiple accounts could apply, present the options with rationale for each.
5. **Check policy compliance**: compare the transaction against the entity's expense policy thresholds. Flag violations.
6. **If reclassifying**: draft a reclassification JE using the journal-entry skill format. Show the original account, the corrected account, and the reason.
7. **Present the categorization**: use the output table format with the recommended account, rationale, and any policy flags.

## Capital vs. Expense Decision Tree

Apply these tests in order. If any test results in "expense," stop — the item is expensed.

1. **De minimis test**: Is the cost below the entity's capitalization threshold? (Ask the user; common thresholds: $500, $1,000, $2,500, $5,000). If yes → **Expense**, regardless of useful life.
2. **Useful life test**: Does the item have a useful life greater than 12 months? If no → **Expense**.
3. **Repair vs. improvement test** (ASC 360): Does the expenditure:
   - Extend the useful life of an existing asset? → **Capitalize** (add to asset cost, depreciate over extended life)
   - Increase the capacity or efficiency of an existing asset? → **Capitalize**
   - Merely maintain the asset in its current condition? → **Expense** (repairs and maintenance)
   - Replace a component? → **Capitalize** the new component, **remove** the old component (if tracked separately)
4. **Internal-use software** (ASC 350-40):
   - **Preliminary project stage** (feasibility, vendor selection, requirements): → **Expense**
   - **Application development stage** (coding, configuration, testing): → **Capitalize** if the project will be completed and the software will be used as intended
   - **Post-implementation stage** (training, maintenance, minor upgrades): → **Expense**
   - **Cloud computing arrangements** (ASC 350-40, as updated): if the arrangement is a service contract (SaaS) and the entity does not have the right to take possession of the software → **Expense** the subscription. Implementation costs during the application development stage may be capitalized as a prepaid asset if the hosting arrangement meets specific criteria.
5. **Leases** (ASC 842): if the arrangement transfers control of an identified asset → classify as a lease, not an expense. Right-of-use asset and lease liability must be recognized. If the lease term is <12 months and the entity has elected the short-term lease exemption → **Expense**.

## Common Categories and Typical GL Accounts

| Category | Typical Account Range | Examples |
|----------|----------------------|----------|
| Payroll & Benefits | 6000-6199 | Salaries, wages, bonuses, health insurance, 401k match, payroll taxes |
| Rent & Occupancy | 6200-6299 | Office rent, utilities, property insurance, maintenance, janitorial |
| Professional Fees | 6300-6399 | Legal, audit, tax prep, consulting, bookkeeping |
| Travel | 6400-6449 | Airfare, hotel, ground transportation, parking, tolls |
| Meals & Entertainment | 6450-6499 | Business meals (50% deductible), client entertainment (0% deductible post-TCJA), team meals |
| Office Supplies | 6500-6549 | Stationery, printer supplies, small equipment <threshold |
| Software & Subscriptions | 6550-6599 | SaaS subscriptions, domain renewals, cloud hosting (if OpEx) |
| Marketing & Advertising | 6600-6699 | Digital ads, print, events, sponsorships, promotional materials |
| Insurance | 6700-6749 | D&O, E&O, general liability, cyber, workers comp |
| Depreciation & Amortization | 6800-6899 | Fixed asset depreciation, intangible amortization |
| Interest Expense | 7000-7099 | Loan interest, line of credit interest, finance lease interest |
| Taxes | 7100-7199 | Income tax, franchise tax, property tax (NOT payroll taxes) |
| Other / Miscellaneous | 7900-7999 | Use sparingly — items here should be reclassified if they recur |

**Note**: actual account numbers vary by entity. Always verify against the entity's chart of accounts via `pennylane_ledger_accounts_list`.

## Policy Compliance Checks

Apply these common thresholds (adjust if the entity has a documented policy):

| Category | Typical Limit | Tax Treatment | Flag If |
|----------|--------------|---------------|---------|
| Meals — business purpose | $75-$150/person | 50% deductible (US) | No business purpose documented; exceeds per-person limit |
| Entertainment | Varies | 0% deductible post-TCJA (US) | Any entertainment expense — verify it is not disguised as meals |
| Travel — airfare | Coach/economy unless >6hr flight | Deductible if business purpose | First/business class without pre-approval |
| Travel — hotel | Per-diem or city-specific rate | Deductible if business purpose | Exceeds GSA/company rate by >20% |
| Gifts — clients | $25/person/year (IRS limit for deduction) | Limited deductibility | Exceeds $25; missing recipient name |
| Home office | Actual or simplified method | Deductible if exclusive-use test met | Mixed-use space without allocation |
| Auto/mileage | IRS standard rate or actual | Deductible | No mileage log; personal use not segregated |

## Output Format
- **Conclusion**: "Transaction categorized as [category] to account [#] — [Account Name]."
- **Treatment**: rationale for the classification, citing policy or standard.
- **Categorization Table** (for bulk review):

| # | Date | Vendor | Amount | Description | Recommended Account | Rationale | Policy Flag |
|---|------|--------|--------|-------------|-------------------|-----------|-------------|
| 1 | 2024-01-15 | AWS | $4,200 | Monthly hosting | 6550 - Cloud Services | SaaS — no right to possess software | None |
| 2 | 2024-01-18 | Home Depot | $8,500 | Office renovation | 1500 - Leasehold Improvements | Improvement — extends useful life >12mo | Capitalize; depreciate over shorter of lease term or useful life |
| 3 | 2024-01-20 | Uber Eats | $380 | Team lunch | 6450 - Meals | Business meal — team event | 50% deductible; document attendees and purpose |

- **Reclassification JE** (if correcting prior categorization):

| Date | Account # | Account Name | Debit | Credit | Memo |
|------|-----------|--------------|-------|--------|------|
| YYYY-MM-DD | XXXX | [Correct account] | $X,XXX | | Reclass from [old account] — [reason] |
| YYYY-MM-DD | XXXX | [Old account] | | $X,XXX | Reclass to [new account] — [reason] |

- **Risks**: tax deductibility issues, audit exposure, policy violations.
- **Missing Info**: receipt not provided, business purpose not documented, attendees not listed.
- **Next Action**: single next step.

## Edge Cases
- **Mixed-use assets**: a laptop used 70% for business and 30% personal — capitalize the full amount but only depreciate/deduct the business-use percentage. Alternatively, expense 100% if below threshold and the personal use is incidental.
- **Reimbursements**: employee reimbursements should be categorized by the nature of the underlying expense, not lumped into "Reimbursements." A reimbursed flight goes to Travel, a reimbursed meal goes to Meals.
- **Prepaid subscriptions**: an annual SaaS subscription paid upfront should be recorded as a prepaid asset (Dr Prepaid / Cr Cash) and amortized monthly (Dr Software Expense / Cr Prepaid). Exception: if the annual amount is below the de minimis threshold, expense it immediately.
- **Gift cards**: purchased gift cards are not an expense until used/distributed. Record as a prepaid asset. When given to clients, expense to Gifts (subject to $25 deduction limit). When given to employees, expense to Compensation (taxable to the employee — notify payroll).
- **Credit card rewards/cashback**: reduce the cost of the related expense or record as other income. Do not net rewards against unrelated expenses.
- **Sales tax on purchases**: for entities that cannot recover sales tax (non-exempt purchasers), the tax is part of the expense and categorized with the underlying purchase. For entities that can recover (VAT-registered), record the tax as a receivable, not an expense.
- **Contractor vs. employee**: if a payment categorized as "consulting" is to an individual, verify the worker classification. Misclassified employees create payroll tax liability, penalties, and retroactive benefits obligations. Flag payments to individuals >$600/year for 1099 reporting.
- **Related-party transactions**: expenses paid to owners, officers, or their family members must be at arm's length and have clear business purpose. Flag all related-party expenses for disclosure and review.
- **De minimis safe harbor (IRS)**: entities with an applicable financial statement can expense items up to $5,000 per invoice/item. Entities without an AFS can use $2,500. This is an annual election — confirm the entity has made the election.

## Guardrails
- **Never categorize to "Miscellaneous" or "Other" without attempting a proper classification first**. These accounts are audit magnets and make financial analysis meaningless.
- **Never capitalize an expense without confirming the capitalization threshold with the user**. The threshold varies by entity and affects both financials and taxes.
- **Always check for policy violations** on travel, meals, and entertainment. Flag them even if the user did not ask — these are common audit findings.
- **Always verify the GL account exists** via `pennylane_ledger_accounts_list` before recommending it. Do not guess account numbers.
- **Flag transactions without receipts or documentation** for amounts over $75 (IRS substantiation requirement for travel/entertainment) or over the entity's receipt threshold.
- **Flag personal expenses**: if a transaction appears to be personal in nature (e.g., Netflix subscription, grocery store, personal clothing), do not categorize it as a business expense. Ask the user for clarification.
- **Tax deductibility is not the same as GAAP classification**: an expense can be a valid business expense on the P&L but non-deductible for tax purposes (e.g., entertainment, fines, penalties, 50% of meals). Note the tax treatment separately when relevant.

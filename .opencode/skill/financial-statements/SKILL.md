---
name: financial-statements
description: Use this when preparing, reviewing, or interpreting an income statement, balance sheet, or statement of cash flows.
---

## Use this when

- The user asks to prepare, review, or explain a financial statement (P&L, balance sheet, cash flow statement).
- The user needs to verify cross-statement tie-outs or detect presentation errors.
- The user asks about classification of line items (current vs non-current, operating vs non-operating).
- The user wants to understand GAAP vs IFRS presentation differences.
- The user asks to pull trial balance or account-level data from Pennylane for statement preparation.

## Workflow

1. **Identify the statement and period.** Confirm which statement (IS, BS, SCF) and the reporting period. Use `pennylane_fiscal_years_list` to confirm open/closed periods.
2. **Pull account balances.** Use `pennylane_ledger_accounts_list` to retrieve all accounts. Use `pennylane_ledger_accounts_get` for specific account detail. Filter by date range matching the reporting period.
3. **Classify and group accounts.**
   - **Income Statement:** Revenue (operating) -> COGS -> Gross Profit -> Operating expenses (by nature or function) -> Operating income -> Non-operating items (interest, FX, gains/losses) -> Tax -> Net income.
   - **Balance Sheet:** Assets (current: cash, AR, inventory, prepaid; non-current: PP&E, intangibles, ROU assets) | Liabilities (current: AP, accrued, current portion of debt, deferred revenue; non-current: long-term debt, deferred tax) | Equity (common stock, APIC, retained earnings, AOCI, treasury stock).
   - **Cash Flow Statement:** Operating (indirect: start with net income, adjust for non-cash and working capital) -> Investing (capex, acquisitions, disposals) -> Financing (debt, equity, dividends).
4. **Run cross-statement tie-outs.**
   - Net income on IS must equal net income line in RE rollforward.
   - Ending retained earnings = Beginning RE + Net income - Dividends.
   - Ending cash on SCF must equal cash and cash equivalents on BS.
   - Change in every BS line item should be explainable through SCF or supplemental disclosures.
5. **Check for presentation errors.**
   - Negative revenue (should be contra-revenue or reclassed).
   - AP or AR with wrong sign (net balance going contra).
   - Intercompany balances not eliminated in consolidated statements.
   - Reclassification of current/non-current based on 12-month rule (or operating cycle if longer).
6. **Deliver structured output.**

## Accounting Judgment

- **Current vs non-current classification:** Apply the 12-month rule from BS date. Debt with covenant violations is current unless a waiver is obtained before issuance. Revolving credit facilities: classify drawn amounts by contractual maturity.
- **Operating vs non-operating:** Recurring revenue from core business is operating. Gains on asset sales, FX on non-trade items, and investment income are typically non-operating. Restructuring charges: operating but present separately if material.
- **GAAP vs IFRS key differences:**
  - IFRS requires expenses by nature or function (IAS 1); US GAAP allows flexibility.
  - IFRS has no extraordinary items classification; US GAAP eliminated it (ASU 2015-01).
  - IFRS allows revaluation of PP&E and intangibles; US GAAP does not (except impairment).
  - Interest paid can be operating or financing under IFRS; US GAAP requires operating (ASC 230) until ASU 2022-03 for certain entities.
  - IFRS balance sheet: non-current assets listed first in many jurisdictions. US GAAP: current assets first (liquidity order).
- **Materiality for presentation:** Items >5% of the relevant subtotal generally warrant separate line-item disclosure. Aggregate immaterial items into "Other."
- **Reclassification adjustments:** Always disclose prior period reclassifications. Consistency in classification period-over-period is mandatory.

## Output Format

```
CONCLUSION: [One-sentence assessment of the statement's accuracy or key finding]
TREATMENT: [How items are classified and why; reference ASC/IFRS if relevant]
RISKS: [Misclassification risks, tie-out failures, presentation deficiencies]
MISSING INFO: [Data gaps — e.g., depreciation schedules, debt maturity, intercompany detail]
NEXT ACTION: [Specific step — e.g., "Reclassify $42k lease liability to current," "Confirm FX treatment with controller"]
```

When presenting a statement, use a clean table with clear subtotals. Always show comparative periods (current vs prior) when data is available.

## Edge Cases

- **Negative cash on BS:** Reclassify bank overdrafts to current liabilities if no right of offset exists.
- **Deferred revenue spanning >12 months:** Split current and non-current portions. Use contract terms, not payment schedule.
- **Goodwill on BS with no impairment test:** Flag — annual impairment testing is required (ASC 350 / IAS 36).
- **Treasury stock presented as asset:** Incorrect. Treasury stock is contra-equity under both GAAP and IFRS.
- **Negative retained earnings:** Acceptable (accumulated deficit). Do not net against APIC unless in a quasi-reorganization.
- **Restricted cash:** Present separately on BS or disclose in notes. Include in SCF beginning/ending reconciliation (ASU 2016-18).
- **Zero-balance accounts:** Exclude from presentation but verify they are truly zero, not a data pull error.

## Guardrails

- Never fabricate account balances. Every number must trace to Pennylane data or user-provided source.
- Flag but do not silently correct misclassifications — the user must approve reclassification entries.
- If Pennylane data covers only a partial period, state the limitation explicitly in output.
- Do not assume consolidation unless confirmed. Ask whether the entity is standalone or consolidated.
- Always caveat: "This analysis is for informational purposes. Final statements should be reviewed by a licensed CPA."
- If the trial balance does not balance (debits != credits), stop and flag immediately — do not proceed with statement preparation on an unbalanced TB.

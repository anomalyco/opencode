---
name: cash-flow-analysis
description: Use this when analyzing cash flow, building a cash flow statement, forecasting cash, or investigating profit-to-cash discrepancies.
---

## Use this when

- The user asks to prepare or review a statement of cash flows.
- The user wants to understand why profit and cash diverge.
- The user needs a cash flow forecast (13-week or otherwise).
- The user asks about free cash flow, cash conversion, or liquidity analysis.
- The user asks to reconcile bank balances to accounting records using Pennylane data.

## Workflow

1. **Clarify scope and method.** Confirm: full SCF or specific analysis (e.g., FCF, working capital). Confirm period. Confirm indirect vs direct method (indirect is standard for reporting; direct may be needed for management analysis).
2. **Pull cash data from Pennylane.**
   - `pennylane_bank_accounts_list` — get all bank accounts and current balances.
   - `pennylane_bank_accounts_get` — detail on specific accounts (currency, type).
   - `pennylane_transactions_list` — actual cash movements filtered by date, bank account, or type.
   - `pennylane_ledger_accounts_get` — for P&L and BS account balances needed in indirect method.
3. **Build the indirect method SCF.**
   - **Operating activities:**
     - Start with net income.
     - Add back non-cash charges: depreciation, amortization, stock-based comp, deferred tax movement, impairments, unrealized FX gains/losses, loss on disposal.
     - Adjust for working capital changes: decrease in AR = source; increase in AR = use. Increase in AP = source; decrease = use. Inventory, prepaid, accrued liabilities, deferred revenue — same logic.
   - **Investing activities:** Capex (purchases of PP&E, intangibles), proceeds from asset sales, acquisitions (net of cash acquired), investments purchased/sold.
   - **Financing activities:** Debt proceeds, debt repayments, equity issuance, share buybacks, dividends paid, lease principal payments (IFRS 16 / ASC 842).
4. **Reconcile to BS cash.** Beginning cash + Net change from O+I+F + FX effect on cash = Ending cash. This MUST tie to BS cash (including restricted cash per ASU 2016-18).
5. **Calculate derived metrics.**
   - **Free Cash Flow (FCF):** Operating cash flow - Capex. Some definitions subtract capitalized software.
   - **Unlevered FCF:** FCF + net interest expense * (1 - tax rate).
   - **Cash conversion ratio:** Operating cash flow / EBITDA. Healthy: >80%. Below 60%: investigate.
   - **Cash runway:** Current cash / Average monthly net burn. Critical for startups.
6. **For 13-week cash forecast:** Use template below.

### 13-Week Cash Forecast Template

| Week | Beginning Cash | Operating Receipts | Operating Disbursements | Net Operating | Investing | Financing | Ending Cash |
|------|---------------|-------------------|------------------------|---------------|-----------|-----------|-------------|
| Wk 1 | | | | | | | |
| ... | | | | | | | |
| Wk 13 | | | | | | | |

Key inputs: AR aging schedule (expected collections), AP aging (expected payments), payroll calendar, debt service schedule, committed capex, known one-time items.

## Accounting Judgment

- **Indirect method adjustments — completeness check:** Every non-cash item on the P&L needs an addback. Common misses: amortization of debt issuance costs, accretion of asset retirement obligations, amortization of right-of-use assets (the non-cash portion), non-cash lease expense under ASC 842.
- **Working capital vs non-operating BS changes:** Changes in operating assets/liabilities go in operating section. Changes in debt go in financing. Changes in long-term investments go in investing. The gray area: current portion of long-term debt reclassification is NOT a cash flow; only actual repayment is.
- **Profit-to-cash discrepancy — common drivers:**
  - Revenue recognized but not collected (AR buildup) — check DSO trend.
  - Inventory buildup ahead of anticipated sales.
  - Large prepayments (insurance, SaaS contracts).
  - Capex: P&L shows depreciation (small, smooth); cash shows capex (large, lumpy).
  - Deferred revenue: cash received before revenue recognized (favorable for cash).
- **Capex vs opex boundary:** Capitalize only costs meeting ASC 350/360 criteria. Cloud computing (ASC 350-40): implementation costs of hosted arrangements may be capitalized; ongoing subscription fees are opex. Misclassification inflates operating cash flow.
- **Restricted cash:** Include in SCF reconciliation per ASU 2016-18. Present separately on BS. Cash that is legally restricted (escrow, compensating balances, collateral) is not available for operations — exclude from runway calculations.

## Output Format

```
CONCLUSION: [One-sentence cash flow assessment — e.g., "Operating cash flow is positive at $340k but masks $200k AR buildup"]
TREATMENT: [Classification of cash flows; method used; key adjustments applied]
RISKS: [Liquidity risks — e.g., "Runway falls below 3 months if AR collections slow by 15 days"]
MISSING INFO: [Data gaps — e.g., "Debt amortization schedule not available; capex commitments unknown"]
NEXT ACTION: [Specific step — e.g., "Obtain AR aging >90 days; confirm $85k deposit is restricted cash"]
```

## Edge Cases

- **FX impact on cash:** Separate the translation effect. If entity holds USD cash but reports in EUR, the FX line on SCF captures revaluation — this is not an operating, investing, or financing flow.
- **Overdraft facilities:** If bank overdrafts are used as cash management (repayable on demand, integral to cash management), they may be included in cash equivalents (IAS 7). US GAAP: generally classified as financing.
- **Non-cash investing/financing:** Acquisitions paid in stock, debt-to-equity conversions, capital lease originations — disclose in supplemental schedule, not in the body of the SCF.
- **Factored receivables:** If AR is sold (true sale), cash inflow is operating. If it is a secured borrowing, cash inflow is financing. Check recourse terms.
- **Negative operating cash flow with positive net income:** Common in high-growth companies (AR and inventory outpace revenue recognition). Not inherently bad, but quantify the gap and project when it reverses.
- **Intercompany cash flows:** Eliminate in consolidation. Analyze at entity level for subsidiary-level liquidity assessment.
- **Timing traps in weekly forecasts:** Payroll, rent, and tax payments cluster on specific days. A weekly forecast that averages daily spend will miss liquidity dips. Model disbursements on their actual calendar dates.

## Guardrails

- Never assume cash = profit. Always reconcile the difference explicitly.
- Bank balances from Pennylane are point-in-time. Confirm the as-of date before using in analysis.
- If bank accounts in Pennylane show different currencies, do not sum without FX conversion. State the conversion rate and source.
- For 13-week forecasts, every assumption must be stated. Do not embed hidden assumptions in formulas.
- Cash runway calculations must use net burn (not gross burn) unless specifically asked otherwise. State which measure is used.
- Flag if Pennylane transaction data appears incomplete (e.g., known bank account missing from `pennylane_bank_accounts_list`).
- Do not conflate cash flow from operations with free cash flow. Always label precisely.

---
name: kpi-dashboard
description: Use this when calculating, defining, or reviewing financial KPIs — profitability, liquidity, efficiency ratios, or SaaS metrics.
---

## Use this when

- The user asks to calculate financial ratios or KPIs.
- The user needs a KPI dashboard or scorecard for management or board reporting.
- The user asks about the definition, formula, or interpretation of a specific metric.
- The user wants to benchmark performance or analyze trends over time.
- The user asks about SaaS-specific metrics (MRR, ARR, churn, LTV, CAC).

## Workflow

1. **Identify the KPIs needed.** Confirm which metrics, for which period(s), and at what level (consolidated, by segment, by product).
2. **Pull data from Pennylane.**
   - `pennylane_ledger_accounts_list` and `pennylane_ledger_accounts_get` — for P&L and BS account balances.
   - `pennylane_ledger_entries_list` — for transaction-level detail when ratios require specific line items.
   - `pennylane_bank_accounts_list` and `pennylane_bank_accounts_get` — for cash and liquidity metrics.
   - `pennylane_transactions_list` — for cash-based metrics and payment timing analysis.
   - `pennylane_fiscal_years_list` — to confirm period boundaries.
3. **Calculate each KPI.** Use the formulas in the catalog below. Use consistent period data (do not mix quarterly revenue with annual expenses).
4. **Present trends.** Show at minimum 3 periods (current, prior period, prior year same period) to establish trend direction. More periods are better for trend analysis.
5. **Contextualize with benchmarks.** Provide industry context where available, but always caveat that benchmarks vary by company size, stage, and geography.
6. **Flag anomalies.** Any KPI that moves >20% period-over-period or sits outside typical ranges warrants a callout.

## KPI Catalog

### Profitability

| Metric | Formula | Healthy Range | Notes |
|--------|---------|---------------|-------|
| **Gross Margin %** | (Revenue - COGS) / Revenue * 100 | Software: 70-85%; Services: 30-50%; Manufacturing: 25-45% | Declining trend is a red flag. Investigate COGS composition. |
| **EBITDA Margin %** | EBITDA / Revenue * 100 | Varies. SaaS at scale: 20-35%; SMB services: 10-20% | EBITDA = Net Income + Interest + Taxes + Depreciation + Amortization. |
| **Net Profit Margin %** | Net Income / Revenue * 100 | Positive and stable. <0% acceptable for growth-stage. | Include/exclude non-recurring items depending on purpose. |
| **Operating Margin %** | Operating Income / Revenue * 100 | Industry-dependent. Tech: 15-30% at maturity. | Better than EBITDA for capex-heavy businesses. |
| **Contribution Margin** | (Revenue - Variable Costs) / Revenue * 100 | >40% for viable unit economics | Requires variable/fixed cost split. |

### Liquidity

| Metric | Formula | Healthy Range | Notes |
|--------|---------|---------------|-------|
| **Current Ratio** | Current Assets / Current Liabilities | 1.2 - 2.0 | <1.0 = potential liquidity crisis. >3.0 = possibly inefficient capital use. |
| **Quick Ratio** | (Current Assets - Inventory - Prepaid) / Current Liabilities | >1.0 | More conservative than current ratio. Critical for non-SaaS businesses with inventory. |
| **Cash Runway (months)** | Cash & Equivalents / Avg Monthly Net Burn | Pre-revenue: >18 months ideal; post-revenue: >6 months | Net burn = total cash out - total cash in. Use trailing 3-month average. |
| **Working Capital** | Current Assets - Current Liabilities | Positive and stable | Absolute number; trend matters more than point-in-time. |
| **Debt-to-Equity** | Total Debt / Total Equity | <2.0 for most industries; <0.5 for conservative | High leverage amplifies returns and risk. |

### Efficiency

| Metric | Formula | Healthy Range | Notes |
|--------|---------|---------------|-------|
| **DSO (Days Sales Outstanding)** | (Avg AR / Revenue) * Days in Period | 30-45 days typical. >60 = concern. | Use average AR (beginning + ending / 2). Industry norms vary significantly. |
| **DPO (Days Payable Outstanding)** | (Avg AP / COGS) * Days in Period | 30-60 days | Higher DPO preserves cash but may strain supplier relationships. |
| **Inventory Turns** | COGS / Average Inventory | Retail: 8-12x; Manufacturing: 4-8x | Low turns = capital tied up or obsolescence risk. |
| **Cash Conversion Cycle** | DSO + DIO - DPO | Lower is better. Negative = excellent (collect before you pay) | DIO = Days Inventory Outstanding = (Avg Inventory / COGS) * Days. |
| **Revenue per Employee** | Annual Revenue / Avg FTE Count | SaaS: $200k-$500k; Services: $100k-$250k | Efficiency proxy. Normalize for contractors vs employees. |

### SaaS Metrics

| Metric | Formula | Healthy Range | Notes |
|--------|---------|---------------|-------|
| **MRR (Monthly Recurring Revenue)** | Sum of all active monthly subscription values | Growth rate >10% MoM early stage; >3% MoM growth stage | Exclude one-time fees, professional services, usage overages unless contractually recurring. |
| **ARR (Annual Recurring Revenue)** | MRR * 12 | Use end-of-period MRR * 12, not trailing 12-month sum | ARR != TTM revenue if there are non-recurring components. |
| **Gross Revenue Churn** | Lost MRR from churned customers / Beginning MRR * 100 | <2% monthly; <5% annual (enterprise); <7% annual (SMB) | Does not include expansion. Purely measures loss. |
| **Net Revenue Retention (NRR)** | (Beginning MRR + Expansion - Contraction - Churn) / Beginning MRR * 100 | >100% = growth from existing customers. Top quartile: >120% | The single most important SaaS efficiency metric. >130% is exceptional. |
| **LTV (Customer Lifetime Value)** | ARPA * Gross Margin % / Monthly Churn Rate | Meaningful only with stable churn | ARPA = Average Revenue Per Account. Use gross margin, not revenue. |
| **CAC (Customer Acquisition Cost)** | (Sales + Marketing Spend) / New Customers Acquired | Fully loaded: include salaries, tools, overhead | Measure over a consistent period. Lagged CAC (Q-1 spend / Q0 new customers) may be more accurate. |
| **LTV:CAC Ratio** | LTV / CAC | >3:1 is healthy. <1:1 = unsustainable. | If >5:1, may be under-investing in growth. |
| **CAC Payback (months)** | CAC / (ARPA * Gross Margin %) | <12 months ideal; <18 months acceptable | Faster payback = faster path to profitability on each customer. |
| **Burn Multiple** | Net Burn / Net New ARR | <1x excellent; 1-2x good; >2x concerning | Measures capital efficiency. Relevant for venture-backed companies. |

## Accounting Judgment

- **EBITDA adjustments:** EBITDA is a non-GAAP metric. Stock-based comp, restructuring, and one-time items are commonly excluded. Always label: "Adjusted EBITDA" if any addbacks are applied. Disclose each addback.
- **MRR accuracy depends on clean data.** If Pennylane revenue accounts mix recurring and non-recurring revenue, MRR derived from ledger data will be inaccurate. Subscription billing system data is the source of truth for MRR. Ledger data is the fallback.
- **Ratio distortions from seasonality.** DSO calculated on a single quarter-end AR balance can be misleading if revenue is seasonal. Use average AR over the period or calculate DSO monthly and trend it.
- **Churn definition matters.** Logo churn (customer count) vs revenue churn (dollar) vs gross vs net. Always state which definition is being used. A company can have high logo churn but positive net revenue retention if remaining customers expand.
- **Benchmarks are directional, not prescriptive.** A 35-day DSO means nothing in isolation. Compare to: the company's own trend, payment terms offered, and industry peers. A company offering Net-60 terms with 55-day DSO is collecting well.
- **Cash runway uses net burn, not gross.** Gross burn ignores revenue. For a company with $500k monthly revenue and $700k monthly expenses, runway based on gross burn ($700k) is misleading. Net burn ($200k) is the correct denominator.
- **LTV sensitivity:** Small changes in churn rate dramatically change LTV. At 2% monthly churn, LTV multiplier is 50x ARPA. At 3%, it is 33x. Always sensitivity-test LTV around churn rate.

## Output Format

```
CONCLUSION: [One-sentence KPI summary — e.g., "Liquidity is strong (current ratio 2.1x) but DSO has deteriorated 12 days QoQ, signaling collection issues"]
TREATMENT: [Which KPIs were calculated, data sources used, any adjustments applied]
RISKS: [KPIs trending in wrong direction or outside healthy ranges]
MISSING INFO: [Data needed — e.g., "Headcount data not in Pennylane; need FTE count for revenue/employee"]
NEXT ACTION: [Specific recommendation — e.g., "Investigate AR aging >60 days; implement collection follow-up for top 5 past-due accounts"]
```

Present KPIs in a dashboard table with: Metric | Current | Prior Period | Prior Year | Trend (arrow or direction).

## Edge Cases

- **Negative equity:** Debt-to-equity is meaningless (or negative). Report absolute debt level and cash coverage instead.
- **Pre-revenue companies:** Gross margin, DSO, and revenue-based metrics are not applicable. Focus on: burn rate, runway, CAC, pipeline metrics.
- **Holding companies or multi-segment:** Calculate KPIs at the segment level. Consolidated ratios can obscure underperforming segments.
- **FX impact on ratios:** If AR is in foreign currency and revenue in reporting currency, DSO computation is distorted. Use consistent currency or calculate by currency.
- **One-time items in KPIs:** A large one-time expense in a quarter will crater EBITDA margin. Show both reported and adjusted figures to avoid misleading trend lines.
- **Partial period KPIs:** Do not annualize one month of data and compare to annual benchmarks. State the period and annualization method if used.
- **SaaS metrics without billing system access:** If MRR data is not available directly, estimate from revenue accounts but clearly label as estimated. Do not present estimated MRR with the same confidence as billing-system-derived MRR.

## Guardrails

- Always show the formula used for each KPI. Definitions vary across organizations; transparency prevents misinterpretation.
- Never present a single-period KPI as a trend. Minimum 3 data points for trend commentary.
- Do not cherry-pick favorable KPIs. If profitability is strong but liquidity is weak, present both.
- Benchmarks are illustrative. Always caveat: "Industry benchmarks vary by company size, stage, and geography."
- If Pennylane data does not break out the components needed for a KPI (e.g., cannot separate variable from fixed costs for contribution margin), state the limitation rather than guessing.
- For SaaS metrics, confirm whether revenue data in Pennylane represents recognized revenue, billed revenue, or contracted revenue. Each gives a different MRR figure.
- Do not extrapolate LTV beyond what churn data supports. If the company has <12 months of churn history, LTV is speculative.

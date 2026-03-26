---
name: budget-comparison
description: Use this when comparing financial results against a budget, forecast, or prior year — full P&L or departmental.
---

## Use this when

- The user asks to compare actuals against budget, forecast, or prior year.
- The user needs a full P&L comparison or departmental spending review.
- The user wants to build or update a reforecast based on YTD actuals.
- The user asks about budget phasing, flex budgets, or one-time distortions.
- The user needs a formatted comparison table for management or board reporting.

## Workflow

1. **Define the comparison matrix.** Confirm columns: Actual | Budget | Forecast | Prior Year. Not all four are always needed. Confirm period: monthly, quarterly, YTD, or full year. Confirm scope: consolidated P&L, single department, single entity.
2. **Pull actuals from Pennylane.**
   - `pennylane_ledger_accounts_list` — retrieve chart of accounts for structure.
   - `pennylane_ledger_entries_list` — filter by period and cost center/department for actual figures.
   - `pennylane_ledger_accounts_get` — for specific account balances.
   - For prior year: pull the same accounts for the corresponding prior period.
3. **Obtain budget and forecast.** These typically come from user-provided files (Excel, CSV). If not provided, ask. Pennylane does not natively store budget data.
4. **Align structures.** Map budget line items to Pennylane account groupings. Common mismatches:
   - Budget has "Travel & Entertainment" as one line; Pennylane has separate accounts for travel, meals, entertainment.
   - Budget uses departments; Pennylane may use cost centers or analytical axes.
   - Confirm the mapping before computing variances to avoid false variances from structural differences.
5. **Build the comparison table.**

| Line Item | Actual | Budget | $ Var (A-B) | % Var | Forecast | $ Var (A-F) | PY Actual | $ Var (A-PY) | % Var |
|-----------|--------|--------|-------------|-------|----------|-------------|-----------|-------------|-------|

6. **Apply flex budget logic if applicable.**
   - Identify variable costs (COGS, commissions, shipping, variable labor).
   - Flex these to actual revenue: Flexed budget = Budget rate * Actual volume.
   - Compute spending variance: Actual - Flexed budget.
   - Compute volume variance: Flexed budget - Original budget.
   - This isolates true spending efficiency from volume effects.
7. **Analyze and narrate material variances.** Apply the same materiality thresholds as variance-analysis skill (>10% AND >$5k default). For each material line, provide: amount, direction, driver, classification (timing / one-time / operational / FX / reclassification).
8. **Build reforecast if requested.**
   - Method: YTD Actuals + Remaining months forecast.
   - For remaining months: use budget unless YTD trend indicates otherwise.
   - Adjust for known changes: new hires, signed contracts, terminated agreements, committed capex.
   - Reforecast = YTD Actual + Adjusted remaining months.

## Accounting Judgment

- **Phasing errors — the #1 budget comparison trap.** If the budget is phased evenly (1/12th per month) but the business is seasonal, every single month will show a variance even if the full year is on track. Before investigating monthly variances, check: is the budget properly phased? If not, analyze at the YTD or quarterly level instead.
- **One-time distortions.** Separate recurring operations from one-time items before concluding on performance:
  - One-time revenue: contract termination fees, insurance recoveries, asset sale gains.
  - One-time expense: severance, legal settlements, write-offs, moving costs.
  - Present both: "as reported" and "adjusted/normalized" views.
- **FX impact on multinational comparisons.** If the entity reports in a currency different from the functional currency of its subsidiaries:
  - Budget is set at a plan FX rate.
  - Actuals translate at average period rate.
  - Variance includes an FX component that is not operational.
  - Isolate FX: restate actuals at budget FX rate to get constant-currency actuals. FX variance = Actual at actual rate - Actual at budget rate.
- **Forecast vs budget — when to shift.** After Q1 results, many organizations pivot from budget to latest forecast as the primary benchmark. If the user is still comparing to original budget in H2, flag that a reforecast comparison may be more relevant.
- **Departmental comparisons — allocated costs.** If corporate costs are allocated to departments, a department's variance may reflect allocation changes, not controllable spending. Always distinguish: direct costs (controllable) vs allocated costs (not controllable by department head).
- **Revenue recognition timing vs billing.** Budget may be on a billing basis; actuals on ASC 606 recognized basis. This creates phantom variances. Confirm the basis of the budget before comparing.

## Output Format

```
CONCLUSION: [One-sentence overall assessment — e.g., "YTD EBITDA is $85k (4%) ahead of budget, driven by revenue outperformance partially offset by higher headcount costs"]
TREATMENT: [Comparison methodology — flex vs static budget, phasing approach, FX treatment]
RISKS: [Run-rate risks — e.g., "Headcount costs trending to $120k over budget by year-end if current hiring pace continues"]
MISSING INFO: [Gaps — e.g., "Q3-Q4 budget phasing not provided; using straight-line for remaining months"]
NEXT ACTION: [Recommendation — e.g., "Update reforecast for engineering headcount; request revised sales pipeline for revenue reforecast"]
```

Present the comparison table with clear column headers, subtotals for major categories (Revenue, Gross Profit, Operating Expenses, EBITDA, Net Income), and a summary row. Use "()" for negative variances or explicitly mark F/U.

## Edge Cases

- **Budget not yet approved.** If the comparison is against a draft budget, note this limitation. Variances against an unapproved budget have limited actionability.
- **Mid-year entity restructuring.** If departments were reorganized mid-year, historical budget may not align with current org structure. Restate one side for comparability or present both old and new structures.
- **Acquisition mid-period.** Acquired entity was not in original budget. Options: exclude from comparison, create a supplemental budget for the acquired entity, or compare organic-only results.
- **Hyperinflation environments (IAS 29).** PY comparison is distorted if prior year is not restated for purchasing power. Flag this for entities in hyperinflationary economies.
- **Budget in local currency, actuals in reporting currency.** Do not mix. Convert budget at plan rate and show FX variance separately, or convert actuals to local currency and compare operationally.
- **Negative budget lines.** Expected contra-revenue, expected returns, or expected losses. Ensure sign convention is consistent. Actual loss smaller than budgeted loss = favorable.
- **Partial period comparisons.** If comparing month-to-date mid-month, prorate the monthly budget by business days elapsed (not calendar days) for more accurate comparison. State the proration method.

## Guardrails

- Never mix comparison bases in one table. If columns are Budget and PY, do not silently switch one column to forecast.
- Always label the comparison basis clearly: "Budget" vs "Forecast v2 (Sept revision)" vs "PY Actual."
- If budget data is user-provided, validate totals before computing variances. A budget that does not foot to its own total will produce meaningless variances.
- Do not present favorable variance on a cost overrun that is offset by revenue overperformance as "on track." The cost overrun is still an overrun; present it transparently.
- Confirm whether the user's budget is GAAP-basis or management-basis (e.g., excluding stock-based comp, including non-GAAP adjustments). Comparing GAAP actuals to a non-GAAP budget produces false variances.
- When building a reforecast, explicitly list every assumption that differs from the original budget. Silent assumption changes undermine forecast credibility.

---
name: variance-analysis
description: Use this when analyzing budget-to-actual variance, period-over-period changes, or explaining material financial differences.
---

## Use this when

- The user asks why a line item is over or under budget.
- The user needs a budget-vs-actual or period-over-period variance report.
- The user asks to investigate a material financial difference.
- The user wants to understand drivers behind revenue, COGS, or opex movement.
- The user needs a variance narrative for board reporting or management review.

## Workflow

1. **Define the comparison.** Confirm: variance of what (line item, department, entity) vs what (budget, forecast, prior year, prior month). Confirm the period.
2. **Pull actuals from Pennylane.** Use `pennylane_ledger_entries_list` filtered by account and date range to get actual figures. Use `pennylane_ledger_accounts_get` for account-level balances. Use `pennylane_journals_list` if needed to identify posting sources.
3. **Obtain the benchmark.** Budget/forecast data typically comes from user-provided files. If prior year is the benchmark, pull the same accounts for the prior period from Pennylane.
4. **Calculate variances.**
   - Dollar variance: Actual - Budget (or PY).
   - Percentage variance: (Actual - Budget) / |Budget| * 100. Use absolute value of budget as denominator to preserve sign direction.
   - If budget is zero, report dollar variance only; percentage is "N/M" (not meaningful).
5. **Apply materiality filters.** Investigate variances that exceed BOTH thresholds:
   - **>10% variance** AND **>$5,000 absolute difference** (adjust thresholds per user preference or entity size).
   - For entities with revenue >$50M, raise the dollar threshold to $25k-$50k.
   - For startups with revenue <$2M, lower to $1k.
6. **Decompose material variances.** Apply the appropriate decomposition:
   - **Revenue:** Volume variance (units * budgeted price) + Price variance (actual units * price delta) + Mix variance (shift in product/channel mix).
   - **COGS:** Volume + Rate + Yield/efficiency.
   - **Opex:** Spending variance (actual vs budget at actual volume) + Volume variance (if variable costs).
   - **Headcount-driven:** FTE variance (actual vs budgeted heads * budgeted cost/head) + Rate variance (actual heads * cost/head delta) + Timing (hires earlier/later than plan).
7. **Identify root causes.** For each material variance, categorize:
   - **Timing:** Expense recognized in wrong period; revenue pulled forward or delayed.
   - **One-time/non-recurring:** Severance, legal settlement, write-off, insurance recovery.
   - **Operational:** True performance deviation from plan.
   - **Accounting/reclassification:** Coding error, intercompany entry, accrual adjustment.
   - **External:** FX, commodity prices, regulatory change.
8. **Build the narrative.** Quantify first, then explain. Format: "$X variance in [line item] driven by [cause], representing [Y]% of budget."

## Accounting Judgment

- **Favorable vs unfavorable:** Revenue over budget = favorable. Expense over budget = unfavorable. Never assume — COGS under budget could be favorable (efficiency) or unfavorable (under-delivery reducing revenue).
- **Flex budgeting:** If revenue is materially different from plan, flex variable costs to actual revenue before computing spending variances. Otherwise, you attribute volume-driven cost increases as unfavorable when they are simply proportional to higher revenue.
- **Annualization traps:** A single month's variance does not annualize linearly. Seasonal businesses have predictable phasing; flag if budget phasing appears flat (1/12th) for a seasonal business.
- **Accrual vs cash distortion:** Variance in a single month may be an accrual timing issue. Always check: is the YTD variance consistent with the monthly variance? If monthly is large but YTD is small, it is likely timing.
- **Reforecast vs budget:** After Q1, many companies shift to comparing against reforecast. Clarify which benchmark the user wants. Do not mix budget and forecast in the same analysis without flagging it.
- **One-time adjustments:** Separate recurring variances from one-time items. Board narratives should highlight both, but run-rate impact should exclude one-timers.

## Output Format

```
CONCLUSION: [One-sentence summary — e.g., "Total opex is $127k (8%) over budget YTD, driven primarily by unplanned legal fees"]
TREATMENT: [How each material variance is categorized: timing, one-time, operational, or reclassification]
RISKS: [Trend risks — e.g., "If legal spend continues at this rate, full-year overrun reaches $380k"]
MISSING INFO: [What is needed — e.g., "Budget phasing by month not provided; using straight-line assumption"]
NEXT ACTION: [Specific recommendation — e.g., "Request updated legal accrual from GC; reforecast legal line +$250k"]
```

Variance table format:
| Line Item | Actual | Budget | $ Var | % Var | F/U | Driver |
|-----------|--------|--------|-------|-------|-----|--------|

## Edge Cases

- **Budget is zero, actual is non-zero:** Report dollar variance; mark % as "N/M." Common for new cost centers or product lines not in original budget.
- **Sign convention confusion:** Pennylane may store expenses as positive debits. Ensure consistent sign convention before computing variance. Revenue credits should be positive in reporting.
- **Mid-year budget revision:** If budget was revised, note which version is used. Ideally show both original budget and revised budget columns.
- **Intercompany eliminations:** Variances in eliminations often net to zero in consolidation. Analyze at the entity level, not consolidated, if intercompany is distorting.
- **FX variance on non-USD entities:** Separate operational variance (local currency) from translation variance (FX rate movement). Report both.
- **Negative budget (expected loss):** Actual loss smaller than budgeted loss is favorable. Ensure signage reflects this correctly.
- **Departmental cost allocations:** If shared costs are allocated, a department's variance may reflect allocation methodology changes, not true spending changes. Flag allocated vs direct costs.

## Guardrails

- Never present variance percentages without the absolute dollar amount — percentages on small bases are misleading.
- Do not speculate on root causes without data. State "cause unknown; investigation needed" rather than guessing.
- If actuals data from Pennylane is incomplete (e.g., month not yet closed), flag: "Actuals may not include all accruals for the period."
- Always ask: "Is the budget phased monthly or straight-line?" before computing monthly variances.
- Materiality thresholds are defaults. Confirm with the user if their organization uses different thresholds.
- Do not combine favorable and unfavorable variances into net figures without showing the components — netting obscures risk.

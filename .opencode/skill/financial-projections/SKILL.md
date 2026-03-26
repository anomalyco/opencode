---
name: financial-projections
description: Use this when building financial projections, forecasts, or pro forma statements — revenue models, expense assumptions, multi-year planning.
---

## Use this when

- The user asks for a revenue forecast, expense budget, or multi-year financial plan.
- Building pro forma income statements, balance sheets, or cash flow statements.
- Modeling scenarios (base, upside, downside) for fundraising, board decks, or internal planning.
- Evaluating the financial viability of a new product line, market, or strategic initiative.

## Workflow

1. **Establish the projection horizon and granularity.** Monthly for Year 1, quarterly for Year 2, annual for Years 3-5. Confirm fiscal year-end with `pennylane_fiscal_years_list`.
2. **Anchor to actuals.** Pull trailing 12-month revenue and expense data via `pennylane_transactions_list` and `pennylane_ledger_entries_list`. Never project from assumptions alone when historical data exists.
3. **Build the revenue model.**
   - **Bottoms-up:** Units x Price x Growth rate. Preferred when unit economics are known.
   - **Top-down:** TAM x Market share x Penetration curve. Use for early-stage or new-market entries.
   - **Cohort-based:** For subscription/SaaS — new MRR, expansion, contraction, churn by cohort vintage.
4. **Model expenses.**
   - Classify each line as fixed or variable. Variable costs scale with a named revenue driver.
   - Headcount-driven costs: salary + benefits + taxes (typically 1.25-1.40x base) + equipment.
   - %-of-revenue items: hosting, payment processing, sales commissions. Document the assumed percentage.
5. **Working capital assumptions.** DSO, DPO, inventory days. Pull current balances from `pennylane_ledger_accounts_list` to calibrate.
6. **Capital expenditure schedule.** Distinguish maintenance CapEx from growth CapEx. Link depreciation back to the P&L.
7. **Build three scenarios.**
   - **Base:** Management's best estimate. Revenue growth aligned with recent trend +/- documented adjustment.
   - **Upside:** Identify 2-3 specific drivers (faster conversion, higher ARPU, earlier product launch).
   - **Downside:** Stress the 2-3 highest-impact assumptions (churn doubles, sales cycle lengthens 50%, key hire delayed).
8. **Sensitivity table.** Show how EBITDA or cash runway changes when the top 2 assumptions vary +/- 20%.
9. **Document every assumption.** Each row gets a source: historical average, management estimate, benchmark, or contractual term.

## Accounting Judgment

- Revenue projections must respect recognition principles. Do not project bookings as revenue if the delivery obligation spans multiple periods.
- Deferred revenue unwind from existing contracts is the most reliable near-term revenue — model it separately.
- Distinguish cash flow from accounting profit. A profitable projection can still run out of cash if working capital is ignored.
- Conservative stance: when in doubt, slow the revenue ramp and accelerate the expense ramp. Optimism bias is the most common projection error.

## Output Format

1. **Conclusion** — One-paragraph executive summary: projected profitability timeline, cash needs, key inflection points.
2. **Treatment** — The projection model with clearly labeled sections (Revenue, COGS, OpEx, EBITDA, CapEx, Working Capital, Free Cash Flow). Each line item shows the assumption driver.
3. **Risks** — Rank-ordered list of assumption risks with magnitude of impact.
4. **Missing info** — Data gaps that weaken the projection (e.g., no churn data, no supplier contracts for COGS).
5. **Next action** — Specific steps: validate assumption X with sales team, update model after Q2 actuals, stress-test covenant compliance.

## Edge Cases

- **Pre-revenue companies:** Use comparable company benchmarks for expense structure. Revenue model must be bottoms-up with explicit conversion funnel assumptions. Flag the uncertainty prominently.
- **Seasonal businesses:** Monthly granularity is mandatory. Use same-month-prior-year growth rates, not rolling averages.
- **Multi-currency:** Project in functional currency. Add an FX assumption section. Do not net exposures without documented hedging.
- **Fundraising projections:** Investors discount management cases ~30%. Present the base case honestly; do not inflate to impress.

## Guardrails

- Never present a single-scenario projection. Always include at least base and downside.
- Never project revenue growth above 3x historical rate without explicit justification and a flag.
- Always show cash balance or runway alongside profitability metrics.
- State that projections are estimates, not guarantees. Include a disclaimer on forward-looking nature.
- Do not fabricate benchmark data. If you lack comparable data, say so.
- Refuse to build projections designed to mislead investors or lenders.

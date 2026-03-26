---
name: break-even-analysis
description: Use this when calculating break-even point, contribution margin, or analyzing fixed/variable cost relationships.
---

## Use this when

- The user asks how many units or how much revenue is needed to cover costs.
- Evaluating the impact of cost structure changes on profitability thresholds.
- Analyzing operating leverage or margin of safety for an existing business.
- Assessing whether a new product, service, or location will reach profitability and when.

## Workflow

1. **Classify costs.** Pull account balances via `pennylane_ledger_accounts_list` and recent transactions via `pennylane_transactions_list`. Categorize every cost line as:
   - **Fixed:** Rent, salaries (non-commission), insurance, depreciation, software subscriptions.
   - **Variable:** Raw materials, direct labor (piece-rate), shipping, payment processing fees, sales commissions.
   - **Semi-variable:** Identify the fixed base and variable increment (e.g., utilities, customer support staffing). Split explicitly.
2. **Calculate contribution margin.**
   - Per unit: Selling Price - Variable Cost Per Unit.
   - Contribution margin ratio: CM / Selling Price.
   - For multi-product firms: Weighted-average CM using current or projected sales mix.
3. **Compute break-even point.**
   - Units: Fixed Costs / CM per unit.
   - Revenue: Fixed Costs / CM ratio.
   - For multi-product: Fixed Costs / Weighted-Average CM ratio, then allocate units by mix.
4. **Calculate margin of safety.**
   - Units: Current Sales Units - Break-Even Units.
   - Percentage: (Current Sales - Break-Even Sales) / Current Sales.
   - Interpret: margin of safety below 20% is a warning; below 10% is critical.
5. **Assess operating leverage.**
   - Degree of Operating Leverage (DOL) = Contribution Margin / Operating Income.
   - Higher DOL means greater profit sensitivity to revenue changes — flag both the upside and the risk.
6. **Run what-if scenarios.**
   - Price increase of 5-10%: impact on volume assumption and new break-even.
   - Fixed cost increase (new hire, new lease): new break-even and timeline to recover.
   - Variable cost change (supplier renegotiation, tariff): CM impact and break-even shift.

## Accounting Judgment

- Cost classification requires judgment. A cost that appears fixed may become variable at scale (e.g., step-function costs like warehouse leases). Document the relevant range.
- Depreciation is a fixed cost for break-even but has zero cash impact. Always present a cash break-even alongside the accounting break-even.
- Semi-variable costs are the most common source of error. When in doubt, use the high-low method on 12 months of data to separate fixed and variable components.
- Break-even analysis assumes linear cost behavior and constant sales mix. These are simplifications — state them explicitly.

## Output Format

1. **Conclusion** — Break-even point in units and revenue, margin of safety, and one-sentence risk assessment.
2. **Treatment** — Cost classification table (account, amount, fixed/variable/semi-variable, basis for classification). CM calculation. Break-even formula and result. Scenario table.
3. **Risks** — Assumptions most likely to invalidate the analysis (sales mix shift, step costs, price elasticity).
4. **Missing info** — Data needed for higher confidence (detailed cost breakdown, volume-price relationship, contract terms for fixed costs).
5. **Next action** — Validate cost classifications with operations, test price sensitivity with sales, revisit after next quarter actuals.

## Edge Cases

- **Multi-product businesses:** Never use a simple single-product formula. Compute weighted-average CM. If sales mix is uncertain, show break-even at three different mix assumptions.
- **SaaS / subscription models:** Fixed costs dominate. Break-even is better expressed as number of subscribers at a given ARPU. Include churn — gross adds needed = net adds / (1 - monthly churn rate).
- **Negative contribution margin:** If CM is negative, there is no break-even — every unit sold increases the loss. Flag immediately and recommend pricing or cost restructuring before volume growth.
- **Step costs:** A business may have multiple break-even points as fixed costs step up. Model each step (e.g., second shift, new warehouse) as a separate break-even tier.
- **Service businesses:** Variable costs may be near zero (e.g., consulting). Break-even is driven almost entirely by fixed costs and utilization rate. Express in billable hours.

## Guardrails

- Never present break-even without stating the key assumptions (price, variable cost per unit, fixed cost total, sales mix).
- Always distinguish accounting break-even (includes depreciation) from cash break-even (excludes non-cash charges, includes debt service).
- Do not assume costs are fixed or variable without reviewing actual behavior. Pull data first.
- Flag when the relevant range is narrow — break-even is only valid within the range where cost behavior holds.
- Refuse to present a break-even analysis that ignores known upcoming cost changes (lease renewal, headcount plan, tariff).

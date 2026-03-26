---
name: pricing-analysis
description: Use this when evaluating pricing strategy, product margins, or financial impact of pricing changes.
---

## Use this when

- The user asks whether a price is right, too high, or too low for a product or service.
- Analyzing the financial impact of a proposed price change, discount policy, or new pricing model.
- Reviewing unit economics, gross margins, or contribution margins by product or customer segment.
- Evaluating SaaS pricing structures (per-seat, usage-based, tiered, freemium conversion).

## Workflow

1. **Establish current state.** Pull revenue by product/service from `pennylane_transactions_list`. Pull cost data from `pennylane_ledger_accounts_list` to compute current gross and contribution margins.
2. **Identify the pricing method in use.**
   - **Cost-plus:** Cost base + markup %. Verify the cost base is fully loaded (direct + allocated overhead).
   - **Target margin:** Price = Cost / (1 - Target Margin %). Work backward from required margin.
   - **Value-based:** Price anchored to customer willingness-to-pay or measurable ROI delivered. Requires non-financial data.
   - **Competitive:** Price set relative to market. Requires benchmark data — ask for it if unavailable.
3. **Compute unit economics.**
   - Gross margin per unit: (Price - COGS) / Price.
   - Contribution margin per unit: (Price - All Variable Costs) / Price.
   - For SaaS: LTV = ARPU x Gross Margin / Monthly Churn. CAC payback = CAC / (ARPU x Gross Margin). Target LTV:CAC > 3:1.
4. **Model the price change scenario.**
   - Revenue impact: New Price x Expected Volume at New Price. Require an explicit volume elasticity assumption.
   - Margin impact: Recalculate CM at new price, holding variable cost constant (unless cost changes with volume).
   - Break-even volume change: How much volume can you lose before the price increase destroys value? Formula: % Volume Loss Tolerance = % Price Increase / (CM% + % Price Increase).
5. **Analyze discount policy.**
   - Calculate effective price after discounts, rebates, and payment-term concessions (e.g., 2/10 net 30 = ~36% annualized cost).
   - Discount waterfall: list price -> standard discount -> negotiated discount -> payment terms -> effective net price.
   - Flag if average effective discount exceeds 15% of list price — indicates pricing credibility erosion.
6. **Sensitivity matrix.** Show margin outcomes across a range of price points and volume assumptions (3x3 or 5x5 grid).

## Accounting Judgment

- Revenue must be recognized at the transaction price net of discounts, rebates, and variable consideration (IFRS 15 / ASC 606). Do not conflate list price with recognized revenue.
- Volume discounts and rebates that depend on future purchases require estimation of the variable consideration at contract inception. Conservative estimate: constrain to amounts highly probable of not reversing.
- Bundled pricing requires allocation of the transaction price to separate performance obligations based on standalone selling prices. Flag bundled deals for rev rec review.
- Free trials and freemium tiers generate no revenue but consume resources. Model them as customer acquisition cost, not as zero-price revenue.

## Output Format

1. **Conclusion** — Current margin profile, whether the proposed pricing is financially sound, and the key risk.
2. **Treatment** — Unit economics table (price, COGS, variable costs, CM, GM%). Price change impact model. Sensitivity matrix. Discount waterfall if applicable.
3. **Risks** — Volume elasticity uncertainty, competitive response, customer churn risk, channel conflict.
4. **Missing info** — Customer willingness-to-pay data, competitor pricing, volume-price elasticity estimates, discount usage history.
5. **Next action** — A/B test recommendation, customer segment analysis, discount policy tightening, rev rec review for bundled pricing.

## Edge Cases

- **SaaS pricing transitions:** Moving from per-seat to usage-based changes revenue predictability. Model both the steady-state economics and the transition dip (customers on legacy plans, migration timeline).
- **Multi-currency pricing:** Set prices in local currency but analyze margins in functional currency. FX movements can erode margins — flag when margin of safety is less than the expected FX volatility.
- **Loss-leader products:** Acceptable only when the cross-sell or upsell path is documented and the portfolio margin is positive. Never approve a loss leader without a quantified path to profitability.
- **Price increases on existing contracts:** Check contractual terms. Annual escalation clauses, CPI adjustments, and renewal terms constrain what is achievable. Flag breach-of-contract risk.
- **Marketplace / platform pricing:** Two-sided economics — take rate must cover platform costs while remaining competitive for both supply and demand sides.

## Guardrails

- Never recommend a price without showing the margin impact and volume sensitivity.
- Always separate gross margin from contribution margin. Gross margin alone hides below-the-line variable costs (sales commissions, payment processing).
- Do not assume volume is unaffected by price changes. Require an explicit elasticity assumption, even if estimated.
- Flag any pricing that results in contribution margin below 20% — the business has very little room for error.
- Refuse to help design pricing intended to deceive customers (hidden fees, drip pricing without disclosure).
- State when you lack market data to validate competitive positioning. Do not fabricate benchmarks.

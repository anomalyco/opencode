---
name: business-model-review
description: Use this when analyzing or stress-testing a business model from an accounting and financial perspective.
---

## Use this when

- The user asks whether a business model is financially viable, sustainable, or scalable.
- Reviewing the economics of a new venture, product line, or strategic pivot.
- Stress-testing assumptions behind a business plan or investor pitch.
- Analyzing the accounting and cash flow implications of how a company generates revenue and incurs costs.

## Workflow

1. **Classify the revenue model.** Identify the primary mechanism:
   - **Transactional:** One-time sales. Revenue recognized at delivery. Key metric: AOV, conversion rate.
   - **Subscription / recurring:** Revenue recognized over the service period. Key metrics: MRR, churn, NRR.
   - **Marketplace / platform:** Take-rate on GMV. Recognize net revenue (agent) or gross revenue (principal) — classification matters enormously.
   - **Usage-based:** Revenue scales with consumption. Recognize as usage occurs. Key risk: demand volatility.
   - **Licensing / royalty:** Upfront or periodic fees for IP. Recognize per contract terms and performance obligations.
   - **Hybrid:** Combination of the above. Map each stream separately.
2. **Map the cost structure.** Pull data from `pennylane_ledger_accounts_list` and `pennylane_transactions_list`.
   - Fixed vs. variable ratio. High fixed cost = high operating leverage = amplified upside and downside.
   - Identify the largest 5 cost lines. For each: fixed or variable, driver, scalability behavior.
   - COGS vs. OpEx distinction. Gross margin is the first test of model viability.
3. **Compute unit economics.**
   - Define the "unit" (customer, transaction, subscription, seat).
   - Revenue per unit, variable cost per unit, contribution margin per unit.
   - For subscription: LTV, CAC, LTV:CAC ratio, CAC payback months.
   - For marketplace: take rate, cost-to-serve per transaction, contribution per transaction.
4. **Analyze the cash conversion cycle.**
   - Days Sales Outstanding (DSO): How fast do you collect?
   - Days Payable Outstanding (DPO): How long can you defer payments?
   - Inventory Days (if applicable): How long is capital tied up in stock?
   - Cash cycle = DSO + Inventory Days - DPO. Negative cash cycle is a structural advantage.
   - Pull current AR, AP, inventory from `pennylane_ledger_accounts_list` to compute actuals.
5. **Assess scalability.**
   - Does gross margin improve, hold, or degrade with scale? (Economies of scale vs. diseconomies.)
   - Does CAC increase as the addressable market narrows?
   - Are there step-function costs (new warehouse, new data center, new team) ahead?
6. **Identify accounting implications.**
   - Revenue recognition: When is revenue earned vs. when is cash collected? Deferred revenue balance as a leading indicator.
   - Prepaid costs and deferred expenses: Upfront costs recognized over the service delivery period.
   - Capitalized development costs: If the model relies on proprietary technology, is R&D being capitalized appropriately?

## Accounting Judgment

- Revenue model classification drives recognition timing, which drives reported profitability. A subscription model recognizing revenue upfront is misstating its economics.
- Principal vs. agent determination for marketplace models changes reported revenue by an order of magnitude. Apply the control test rigorously.
- Deferred revenue is not "free money" — it represents an undelivered obligation. A growing deferred revenue balance with declining service capacity is a red flag.
- Negative working capital (collecting before paying) is powerful but fragile — if growth stalls, the cash flow reverses.
- Operating leverage cuts both ways. A high fixed-cost model that misses revenue targets burns cash rapidly.

## Output Format

1. **Conclusion** — One-paragraph verdict: Is the model economically sound? What is the biggest structural risk? Is it investable/fundable at the current stage?
2. **Treatment** — Revenue model classification and recognition policy. Cost structure breakdown (fixed/variable, COGS/OpEx). Unit economics table. Cash cycle analysis. Scalability assessment.
3. **Risks** — Rank-ordered: revenue concentration, cost rigidity, cash cycle vulnerability, accounting misstatement risk, regulatory exposure.
4. **Missing info** — Customer cohort data, churn rates, contract terms, supplier agreements, competitive landscape.
5. **Next action** — Validate unit economics with 3-month cohort, stress-test at 70% of projected revenue, review rev rec policy with auditor, model the next step-function cost.

## Edge Cases

- **Pre-revenue models:** Assess based on comparable benchmarks and theoretical unit economics. Flag that all conclusions are assumption-dependent. Focus on: Is the cost structure manageable until revenue materializes?
- **Pivot scenarios:** Compare the old and new model side by side. Quantify the transition cost (stranded assets, contract exits, retraining). Flag sunk cost fallacy risk.
- **Multi-sided platforms:** Each side has different economics. A model that subsidizes one side must show the cross-subsidy math explicitly. Network effects are real but not infinite — show where they plateau.
- **Hardware + software bundles:** Separate the economics of each component. Hardware is often negative margin; software margin must compensate. Accounting requires separate performance obligation allocation.

## Guardrails

- Never declare a business model "viable" without computing unit economics. Positive revenue is not the same as positive economics.
- Always check whether the model generates cash or merely accounting profit. A profitable model that consumes cash will fail.
- Do not accept management's revenue classification without applying the recognition criteria. "Recurring revenue" that can be cancelled monthly with no penalty behaves differently from contracted annual subscriptions.
- Flag any model where LTV:CAC is below 3:1 or CAC payback exceeds 18 months as high-risk.
- Refuse to validate models built on assumptions the user cannot substantiate. State what data is needed.

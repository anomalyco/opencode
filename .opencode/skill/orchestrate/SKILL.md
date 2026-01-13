---
name: orchestrate
description: "Use for any outcome-oriented request - automatically plans and executes with no user input"
---

# Autonomous Orchestration

**User Intent:** Any complex request that requires multiple steps.

This skill triggers the Planner agent to autonomously break down the request, spawn workers, and deliver complete results.

## When to Use

- "Launch my product"
- "Create a campaign for X"
- "Analyze and optimize Y"
- "Expand to marketplace Z"
- Any request that would normally require multiple manual steps

## Execution

1. Immediately delegate to @planner agent
2. Planner creates execution plan
3. Workers execute in parallel
4. Reviewer validates
5. Deliver complete results

## No User Input Required

The orchestrator should:
- Use reasonable defaults
- Make decisions autonomously
- Only ask user if genuinely ambiguous (e.g., which brand?)
- Complete the full workflow without interruption

## Integration with Plans

For recognized patterns, use existing Plans:
- Product launch → @launch-product
- Seasonal campaign → @seasonal-campaign
- Marketplace expansion → @marketplace-expansion
- Competitor response → @competitor-response

For novel requests, Planner creates custom plan.

---
name: analyze-performance
description: Use for deep performance analysis - ROI, ROAS, sales trends, campaign effectiveness
---

# Performance Analysis Skill

You are executing a comprehensive performance analysis. This skill combines multiple data queries to deliver actionable business insights.

## Required Inputs

Before starting, collect:
1. **Brand**: Which brand to analyze?
2. **Period**: What time range? (e.g., "last month", "Q4 2024", "Jan 2024")
3. **Focus**: What aspect? (overall, specific region, specific campaign, specific product)
4. **Comparison**: Compare to what? (previous period, target, competitor benchmark)

## Execution Steps

### Step 1: Context Loading
```
get_brand_context → Understand available data sources
```

### Step 2: Data Collection (run in PARALLEL)
```
query_sales → Revenue, units, AOV by region/product
query_campaigns → Ad spend, ROAS, conversions by channel
query_inventory → Stock levels and availability
```

### Step 3: Analysis
Calculate:
- Overall ROI: (Revenue - Total Costs) / Total Costs
- Marketing ROI: (Attributed Revenue - Ad Spend) / Ad Spend
- ROAS by channel
- Growth rates (YoY, MoM)
- Regional performance variance
- Product mix contribution

### Step 4: Insights Generation
Identify:
- Top performers (regions, products, channels)
- Underperformers and root causes
- Trends and patterns
- Anomalies requiring attention

### Step 5: Recommendations
Provide actionable next steps based on data

## Output Format

```markdown
# Performance Report: [Brand] - [Period]

## Executive Summary
| Metric | Value | vs Target | vs Last Period |
|--------|-------|-----------|----------------|
| Revenue | ₹X Cr | +X% | +X% |
| Units | X | +X% | +X% |
| ROAS | Xx | +X% | +X% |
| ROI | X% | +X pts | +X pts |

## Key Findings
1. [Most important insight]
2. [Second insight]
3. [Third insight]

## Detailed Analysis

### Sales Performance
[Tables and breakdown]

### Marketing Performance
[Channel-wise ROAS, spend efficiency]

### Regional Performance
[Geographic breakdown]

### Product Performance
[Category/SKU analysis]

## Recommendations
1. **Immediate**: [Action to take now]
2. **Short-term**: [Action for next 30 days]
3. **Strategic**: [Longer-term consideration]

## Data Notes
- Sources used
- Time ranges
- Any data limitations
```

## ROI Calculation Methods

### Marketing ROI
```
Marketing ROI = (Attributed Revenue - Ad Spend) / Ad Spend × 100
```

### Overall ROI
```
Overall ROI = (Total Revenue - Total Costs) / Total Costs × 100
```

### ROAS (Return on Ad Spend)
```
ROAS = Attributed Revenue / Ad Spend
```

## Important Notes

- Always cite data sources and time ranges
- Flag assumptions clearly
- Compare to relevant benchmarks
- Provide context for all numbers
- End with actionable recommendations

/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"

const DESCRIPTION = `Query sales and revenue data from the brand's database.
Returns sales figures, units sold, AOV, and breakdowns by region/product/time.
Use this for ROI calculations, trend analysis, and performance reporting.

NOTE: This tool currently returns MOCK/DEMO data for demonstration purposes.
To integrate with real Shopify data:
1. Ensure Shopify MCP server is connected (check with 'shopify_get_product_list' tool)
2. Call 'shopify_get_product_list' to get real product data
3. Transform Shopify data format to match this tool's output format
4. Fall back to mock data if Shopify is unavailable

See SHOPIFY_MCP_SETUP.md for integration instructions.`

// Mock sales data generator
function generateSalesData(args: {
  brand_id: string
  region?: string
  start_date: string
  end_date: string
  category?: string
}): SalesData {
  // Deterministic "random" based on inputs for consistent demo results
  const seed = args.brand_id.length + (args.region?.length || 0) + args.start_date.length
  const multiplier = args.brand_id === "nike" ? 1.5 : args.brand_id === "luxebags" ? 2.2 : 1.0

  const baseRevenue = 1000000 * multiplier
  const variance = (seed % 30) / 100

  const regions = args.region
    ? [args.region]
    : ["Delhi-NCR", "Mumbai", "Bangalore", "Chennai", "Kolkata"]

  const regionData = regions.map(region => {
    const regionMultiplier = region === "Mumbai" ? 1.3 : region === "Delhi-NCR" ? 1.2 : 1.0
    const revenue = Math.round(baseRevenue * regionMultiplier * (1 + variance))
    const units = Math.round(revenue / (args.brand_id === "luxebags" ? 5000 : 2500))
    return {
      region,
      revenue,
      units,
      aov: Math.round(revenue / units),
      growth_yoy: Math.round((10 + (seed % 20)) * 10) / 10,
    }
  })

  const totalRevenue = regionData.reduce((sum, r) => sum + r.revenue, 0)
  const totalUnits = regionData.reduce((sum, r) => sum + r.units, 0)

  return {
    query: {
      brand_id: args.brand_id,
      region: args.region || "All Regions",
      period: `${args.start_date} to ${args.end_date}`,
      category: args.category || "All Categories",
    },
    summary: {
      total_revenue: totalRevenue,
      total_units: totalUnits,
      aov: Math.round(totalRevenue / totalUnits),
      growth_yoy: Math.round(regionData.reduce((sum, r) => sum + r.growth_yoy, 0) / regionData.length * 10) / 10,
    },
    by_region: regionData,
  }
}

interface SalesData {
  query: {
    brand_id: string
    region: string
    period: string
    category: string
  }
  summary: {
    total_revenue: number
    total_units: number
    aov: number
    growth_yoy: number
  }
  by_region: Array<{
    region: string
    revenue: number
    units: number
    aov: number
    growth_yoy: number
  }>
}

function formatCurrency(amount: number): string {
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)} Cr`
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(2)} L`
  return `₹${amount.toLocaleString()}`
}

export default tool({
  description: DESCRIPTION,
  args: {
    brand_id: tool.schema
      .string()
      .describe("Brand identifier")
      .default("nike"),
    region: tool.schema
      .string()
      .describe("Region filter (e.g., 'Delhi-NCR', 'Mumbai'). Omit for all regions.")
      .optional(),
    start_date: tool.schema
      .string()
      .describe("Start date in YYYY-MM-DD format")
      .default("2024-01-01"),
    end_date: tool.schema
      .string()
      .describe("End date in YYYY-MM-DD format")
      .default("2024-01-31"),
    category: tool.schema
      .string()
      .describe("Product category filter. Omit for all categories.")
      .optional(),
  },
  async execute(args) {
    const data = generateSalesData({
      brand_id: args.brand_id,
      region: args.region,
      start_date: args.start_date,
      end_date: args.end_date,
      category: args.category,
    })

    const regionRows = data.by_region
      .map(r => `| ${r.region} | ${formatCurrency(r.revenue)} | ${r.units.toLocaleString()} | ${formatCurrency(r.aov)} | ${r.growth_yoy}% |`)
      .join("\n")

    return `# Sales Data: ${args.brand_id.toUpperCase()}

## Query Parameters
- **Period**: ${data.query.period}
- **Region**: ${data.query.region}
- **Category**: ${data.query.category}

## Summary
| Metric | Value |
|--------|-------|
| Total Revenue | ${formatCurrency(data.summary.total_revenue)} |
| Total Units | ${data.summary.total_units.toLocaleString()} |
| Average Order Value | ${formatCurrency(data.summary.aov)} |
| YoY Growth | ${data.summary.growth_yoy}% |

## Breakdown by Region
| Region | Revenue | Units | AOV | YoY Growth |
|--------|---------|-------|-----|------------|
${regionRows}

---
*Data source: sales_db | Query executed at ${new Date().toISOString()}*`
  },
})

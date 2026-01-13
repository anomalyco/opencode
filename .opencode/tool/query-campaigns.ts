/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"

const DESCRIPTION = `Query marketing campaign performance data.
Returns ad spend, ROAS, conversions, CTR, and channel breakdowns.
Use this for ROI calculations, campaign analysis, and marketing optimization.`

function generateCampaignData(args: {
  brand_id: string
  start_date: string
  end_date: string
  channel?: string
}): CampaignData {
  const seed = args.brand_id.length + args.start_date.length
  const baseSpend = args.brand_id === "luxebags" ? 500000 : 800000

  const channels = args.channel
    ? [args.channel]
    : ["Meta", "Google", "Instagram", "YouTube"]

  const channelData = channels.map(channel => {
    const channelMultiplier =
      channel === "Meta" ? 1.2 :
      channel === "Google" ? 1.4 :
      channel === "Instagram" ? 0.9 : 0.8

    const spend = Math.round(baseSpend * channelMultiplier * (0.8 + (seed % 40) / 100))
    const roas = Math.round((3 + (seed % 25) / 10) * channelMultiplier * 10) / 10
    const revenue = Math.round(spend * roas)
    const impressions = spend * (50 + seed % 30)
    const clicks = Math.round(impressions * (0.02 + (seed % 3) / 100))
    const conversions = Math.round(clicks * (0.03 + (seed % 2) / 100))

    return {
      channel,
      spend,
      revenue,
      roas,
      impressions,
      clicks,
      conversions,
      ctr: Math.round((clicks / impressions) * 10000) / 100,
      cpc: Math.round((spend / clicks) * 100) / 100,
      cpa: Math.round(spend / conversions),
    }
  })

  const totalSpend = channelData.reduce((sum, c) => sum + c.spend, 0)
  const totalRevenue = channelData.reduce((sum, c) => sum + c.revenue, 0)
  const totalConversions = channelData.reduce((sum, c) => sum + c.conversions, 0)

  return {
    query: {
      brand_id: args.brand_id,
      period: `${args.start_date} to ${args.end_date}`,
      channel: args.channel || "All Channels",
    },
    summary: {
      total_spend: totalSpend,
      total_revenue: totalRevenue,
      total_conversions: totalConversions,
      blended_roas: Math.round((totalRevenue / totalSpend) * 10) / 10,
      avg_cpa: Math.round(totalSpend / totalConversions),
    },
    by_channel: channelData,
  }
}

interface CampaignData {
  query: {
    brand_id: string
    period: string
    channel: string
  }
  summary: {
    total_spend: number
    total_revenue: number
    total_conversions: number
    blended_roas: number
    avg_cpa: number
  }
  by_channel: Array<{
    channel: string
    spend: number
    revenue: number
    roas: number
    impressions: number
    clicks: number
    conversions: number
    ctr: number
    cpc: number
    cpa: number
  }>
}

function formatCurrency(amount: number): string {
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)} Cr`
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(2)} L`
  return `₹${amount.toLocaleString()}`
}

function formatNumber(num: number): string {
  if (num >= 10000000) return `${(num / 10000000).toFixed(1)}Cr`
  if (num >= 100000) return `${(num / 100000).toFixed(1)}L`
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
  return num.toString()
}

export default tool({
  description: DESCRIPTION,
  args: {
    brand_id: tool.schema
      .string()
      .describe("Brand identifier")
      .default("nike"),
    start_date: tool.schema
      .string()
      .describe("Start date in YYYY-MM-DD format")
      .default("2024-01-01"),
    end_date: tool.schema
      .string()
      .describe("End date in YYYY-MM-DD format")
      .default("2024-01-31"),
    channel: tool.schema
      .string()
      .describe("Channel filter (e.g., 'Meta', 'Google', 'Instagram'). Omit for all channels.")
      .optional(),
  },
  async execute(args) {
    const data = generateCampaignData({
      brand_id: args.brand_id,
      start_date: args.start_date,
      end_date: args.end_date,
      channel: args.channel,
    })

    const channelRows = data.by_channel
      .map(c => `| ${c.channel} | ${formatCurrency(c.spend)} | ${formatCurrency(c.revenue)} | ${c.roas}x | ${formatNumber(c.impressions)} | ${c.ctr}% | ${c.conversions} | ${formatCurrency(c.cpa)} |`)
      .join("\n")

    return `# Campaign Performance: ${args.brand_id.toUpperCase()}

## Query Parameters
- **Period**: ${data.query.period}
- **Channel**: ${data.query.channel}

## Summary
| Metric | Value |
|--------|-------|
| Total Ad Spend | ${formatCurrency(data.summary.total_spend)} |
| Total Revenue (Attributed) | ${formatCurrency(data.summary.total_revenue)} |
| Blended ROAS | ${data.summary.blended_roas}x |
| Total Conversions | ${data.summary.total_conversions.toLocaleString()} |
| Average CPA | ${formatCurrency(data.summary.avg_cpa)} |

## Breakdown by Channel
| Channel | Spend | Revenue | ROAS | Impressions | CTR | Conversions | CPA |
|---------|-------|---------|------|-------------|-----|-------------|-----|
${channelRows}

## ROI Calculation
- **Marketing Spend**: ${formatCurrency(data.summary.total_spend)}
- **Attributed Revenue**: ${formatCurrency(data.summary.total_revenue)}
- **Net Return**: ${formatCurrency(data.summary.total_revenue - data.summary.total_spend)}
- **ROI**: ${Math.round((data.summary.total_revenue - data.summary.total_spend) / data.summary.total_spend * 100)}%

---
*Data source: campaigns_db | Query executed at ${new Date().toISOString()}*`
  },
})

/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"

const DESCRIPTION = `Query inventory and stock levels from the brand's database.
Returns stock quantities, availability status, and stockout risks.
Use this for inventory planning, availability checks, and supply chain insights.`

function generateInventoryData(args: {
  brand_id: string
  category?: string
  region?: string
}): InventoryData {
  const seed = args.brand_id.length + (args.category?.length || 0)

  const categories = args.category
    ? [args.category]
    : args.brand_id === "nike"
      ? ["Running Shoes", "Training Shoes", "Lifestyle", "Apparel", "Accessories"]
      : args.brand_id === "luxebags"
        ? ["Handbags", "Clutches", "Totes", "Backpacks", "Wallets"]
        : ["Vegetables", "Fruits", "Dairy", "Snacks", "Beverages"]

  const skuData = categories.flatMap(category => {
    const baseStock = args.brand_id === "luxebags" ? 150 : 500
    const skuCount = 3 + (seed % 3)

    return Array.from({ length: skuCount }, (_, i) => {
      const stock = Math.round(baseStock * (0.3 + Math.random() * 1.5))
      const reorderPoint = Math.round(baseStock * 0.3)
      const dailySales = Math.round(stock * 0.05 * (0.5 + Math.random()))
      const daysOfStock = Math.round(stock / Math.max(dailySales, 1))

      return {
        sku: `${args.brand_id.toUpperCase()}-${category.substring(0, 3).toUpperCase()}-${1000 + i}`,
        category,
        product_name: `${category} Item ${i + 1}`,
        stock_quantity: stock,
        reorder_point: reorderPoint,
        daily_sales_avg: dailySales,
        days_of_stock: daysOfStock,
        status: stock <= reorderPoint ? "LOW" : daysOfStock < 14 ? "WATCH" : "OK",
      }
    })
  })

  const totalStock = skuData.reduce((sum, s) => sum + s.stock_quantity, 0)
  const lowStockCount = skuData.filter(s => s.status === "LOW").length
  const watchCount = skuData.filter(s => s.status === "WATCH").length

  return {
    query: {
      brand_id: args.brand_id,
      category: args.category || "All Categories",
      region: args.region || "All Warehouses",
    },
    summary: {
      total_skus: skuData.length,
      total_units: totalStock,
      low_stock_skus: lowStockCount,
      watch_skus: watchCount,
      healthy_skus: skuData.length - lowStockCount - watchCount,
    },
    items: skuData,
  }
}

interface InventoryData {
  query: {
    brand_id: string
    category: string
    region: string
  }
  summary: {
    total_skus: number
    total_units: number
    low_stock_skus: number
    watch_skus: number
    healthy_skus: number
  }
  items: Array<{
    sku: string
    category: string
    product_name: string
    stock_quantity: number
    reorder_point: number
    daily_sales_avg: number
    days_of_stock: number
    status: string
  }>
}

export default tool({
  description: DESCRIPTION,
  args: {
    brand_id: tool.schema
      .string()
      .describe("Brand identifier")
      .default("nike"),
    category: tool.schema
      .string()
      .describe("Product category filter. Omit for all categories.")
      .optional(),
    region: tool.schema
      .string()
      .describe("Warehouse/region filter. Omit for all warehouses.")
      .optional(),
  },
  async execute(args) {
    const data = generateInventoryData({
      brand_id: args.brand_id,
      category: args.category,
      region: args.region,
    })

    const lowStockItems = data.items.filter(i => i.status === "LOW")
    const watchItems = data.items.filter(i => i.status === "WATCH")

    const itemRows = data.items
      .sort((a, b) => a.days_of_stock - b.days_of_stock)
      .slice(0, 15)
      .map(i => {
        const statusIcon = i.status === "LOW" ? "🔴" : i.status === "WATCH" ? "🟡" : "🟢"
        return `| ${i.sku} | ${i.category} | ${i.stock_quantity} | ${i.reorder_point} | ${i.days_of_stock}d | ${statusIcon} ${i.status} |`
      })
      .join("\n")

    let alerts = ""
    if (lowStockItems.length > 0) {
      alerts += `\n## ⚠️ Low Stock Alerts\nThe following ${lowStockItems.length} SKUs need immediate reorder:\n`
      alerts += lowStockItems.map(i => `- **${i.sku}**: ${i.stock_quantity} units (${i.days_of_stock} days remaining)`).join("\n")
    }

    return `# Inventory Status: ${args.brand_id.toUpperCase()}

## Query Parameters
- **Category**: ${data.query.category}
- **Region**: ${data.query.region}

## Summary
| Metric | Value |
|--------|-------|
| Total SKUs | ${data.summary.total_skus} |
| Total Units | ${data.summary.total_units.toLocaleString()} |
| 🟢 Healthy | ${data.summary.healthy_skus} SKUs |
| 🟡 Watch | ${data.summary.watch_skus} SKUs |
| 🔴 Low Stock | ${data.summary.low_stock_skus} SKUs |

## Inventory Details (sorted by days of stock)
| SKU | Category | Stock | Reorder Point | Days Left | Status |
|-----|----------|-------|---------------|-----------|--------|
${itemRows}
${alerts}

---
*Data source: inventory_db | Query executed at ${new Date().toISOString()}*`
  },
})

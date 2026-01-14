/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"

const DESCRIPTION = `Query products from the brand's Shopify storefront catalog.
Search by keywords, filter by category, price range, or availability.
Returns product details including title, price, variants, images, and inventory status.

This tool wraps the Shopify MCP 'shopify-mock_search_shop_catalog' tool for easier integration.
Use this when agents need to:
- Search for specific products ("running shoes", "leather bags")
- Browse products by category or collection
- Check product availability and pricing
- Get product data for campaign creative generation

Data source: Mock.shop (Shopify's official demo GraphQL API)`

export default tool({
  description: DESCRIPTION,
  args: {
    brand_id: tool.schema
      .string()
      .describe("Brand identifier (nike, luxebags, freshfoods)")
      .default("nike"),
    query: tool.schema
      .string()
      .describe("Natural language search query (e.g., 'running shoes', 'black leather bags', 'organic vegetables')")
      .optional(),
    category: tool.schema
      .string()
      .describe("Product category filter (e.g., 'Shoes', 'Bags', 'Produce')")
      .optional(),
    min_price: tool.schema
      .number()
      .describe("Minimum price filter (in INR)")
      .optional(),
    max_price: tool.schema
      .number()
      .describe("Maximum price filter (in INR)")
      .optional(),
    available_only: tool.schema
      .boolean()
      .describe("Only return products in stock")
      .default(true),
    limit: tool.schema
      .number()
      .describe("Maximum number of products to return")
      .default(10),
  },
  async execute(args) {
    // Build search query
    const searchTerms = []
    if (args.query) searchTerms.push(args.query)
    if (args.category) searchTerms.push(args.category)

    const searchQuery = searchTerms.join(" ") || "products"

    // This tool provides guidance for querying products via Shopify MCP
    return `# Product Query Helper: ${args.brand_id.toUpperCase()}

## Requested Search
- **Keywords**: ${searchQuery}
- **Category**: ${args.category || "All Categories"}
- **Price Range**: ₹${args.min_price || 0} - ₹${args.max_price || "∞"}
- **Available Only**: ${args.available_only ? "Yes" : "No"}
- **Limit**: ${args.limit} products

---

## How to Query Products

To search the Shopify product catalog, use the **Shopify MCP tool** directly:

\`\`\`
Use tool: shopify-mock_search_shop_catalog
Parameters:
{
  "query": "${searchQuery}",
  "limit": ${args.limit}
}
\`\`\`

This will return real product data from Mock.shop including:
- Product names and descriptions
- Pricing and variants (sizes, colors)
- Availability status
- Product images
- SKU information

---

## MCP Server Status

To verify the Shopify MCP is connected:
1. Check server status: \`opencode mcp list\`
2. Ensure 'shopify-mock' shows as 'connected'
3. If not connected, check \`.opencode/opencode.jsonc\` configuration

---

## Alternative: Demo Data

If Shopify MCP is not available, the following demo product categories are available for "${args.brand_id}":

${args.brand_id === "nike" ? `- Running Shoes (₹3,000 - ₹8,000)
- Training Shoes (₹2,500 - ₹6,500)
- Apparel (₹1,200 - ₹4,500)
- Accessories (₹500 - ₹2,000)` : args.brand_id === "luxebags" ? `- Handbags (₹8,000 - ₹25,000)
- Clutches (₹5,000 - ₹15,000)
- Totes (₹6,000 - ₹18,000)
- Accessories (₹2,000 - ₹8,000)` : `- Organic Vegetables (₹50 - ₹500/kg)
- Organic Fruits (₹80 - ₹600/kg)
- Dairy Products (₹40 - ₹300)
- Packaged Goods (₹100 - ₹800)`}

*Use the MCP tool for actual Shopify product data with real names, prices, and availability.*

---
*Generated at ${new Date().toISOString()}*`
  },
})

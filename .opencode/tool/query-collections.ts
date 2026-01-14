/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"

const DESCRIPTION = `Browse product collections from the brand's Shopify storefront.
Collections are curated groups of products organized by:
- Category (e.g., "Men's Running Shoes", "Leather Handbags", "Organic Vegetables")
- Season/Campaign (e.g., "Spring 2024", "Holiday Gift Guide")
- Theme (e.g., "Best Sellers", "New Arrivals", "Sale Items")

Returns collection metadata and products within each collection.

Use this when agents need to:
- Browse products by category or theme
- Understand the store's product organization
- Plan category-specific campaigns
- Analyze collection performance

Data source: Mock.shop (Shopify's official demo GraphQL API)`

export default tool({
  description: DESCRIPTION,
  args: {
    brand_id: tool.schema
      .string()
      .describe("Brand identifier (nike, luxebags, freshfoods)")
      .default("nike"),
    collection_query: tool.schema
      .string()
      .describe("Collection name or theme to search for (e.g., 'shoes', 'bags', 'sale', 'new arrivals')")
      .optional(),
    include_products: tool.schema
      .boolean()
      .describe("Include product listings for each collection")
      .default(true),
    products_per_collection: tool.schema
      .number()
      .describe("Number of products to show per collection")
      .default(5),
  },
  async execute(args) {
    // Build collection search query
    const searchQuery = args.collection_query || "collection"

    // This tool provides guidance for querying collections via Shopify MCP
    return `# Collection Query Helper: ${args.brand_id.toUpperCase()}

## Requested Collection Search
- **Query**: ${searchQuery}
- **Include Products**: ${args.include_products ? `Yes (${args.products_per_collection} per collection)` : "No"}

---

## How to Browse Collections

To browse product collections, use the **Shopify MCP tool** to search for collection-related products:

\`\`\`
Use tool: shopify-mock_search_shop_catalog
Parameters:
{
  "query": "${searchQuery}",
  "limit": ${args.include_products ? args.products_per_collection * 3 : 10}
}
\`\`\`

This will return products organized by collection/category, including:
- Collection names and descriptions
- Products within each collection
- Collection metadata (themes, seasons, campaigns)

---

## Collection Organization

Collections help organize products for better discovery and targeted campaigns.

### Common Collection Types

**Category Collections**: Organized by product type
${args.brand_id === "nike" ? "- Running Shoes\n- Training Shoes\n- Apparel\n- Accessories" : args.brand_id === "luxebags" ? "- Handbags\n- Clutches\n- Totes\n- Crossbody Bags" : "- Vegetables\n- Fruits\n- Dairy\n- Packaged Goods"}

**Seasonal Collections**: Product lines by season
- Spring/Summer Collection
- Fall/Winter Collection
- Holiday Collection

**Campaign Collections**: Special promotions
- Holiday Gifts
- Back to School
- Sale Items
- Clearance

**Featured Collections**: Curated selections
- Best Sellers
- New Arrivals
- Staff Picks
- Limited Edition

---

## Usage Scenarios

**For Campaign Planning**:
- Use collections to target specific product segments
- Create collection-specific ad sets
- Build gift guides around collections

**For Analysis**:
- Track performance metrics by collection
- Identify top-performing collections
- Optimize inventory by collection

**For Content Creation**:
- Generate collection landing pages
- Create collection showcase emails
- Build seasonal campaign assets

---

## MCP Server Status

To verify the Shopify MCP is connected:
1. Check server status: \`opencode mcp list\`
2. Ensure 'shopify-mock' shows as 'connected'
3. If not connected, check \`.opencode/opencode.jsonc\` configuration

---

## Alternative Approach

If you want to browse by category instead of collection:
\`\`\`
query_products(brand_id="${args.brand_id}", category="[category_name]", limit=20)
\`\`\`

---
*Generated at ${new Date().toISOString()}*`
  },
})

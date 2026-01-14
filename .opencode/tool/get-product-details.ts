/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"

const DESCRIPTION = `Get detailed information about a specific product from the Shopify storefront.
Returns comprehensive product data including:
- Full product description and specifications
- All available variants (sizes, colors, materials)
- Pricing and compare-at pricing
- Product images and media
- Inventory availability by variant
- SEO metadata and tags

Use this when you need complete product details for:
- Creating product-specific campaigns
- Generating product copy or descriptions
- Analyzing product variants and pricing
- Checking detailed inventory status

Data source: Mock.shop (Shopify's official demo GraphQL API)`

export default tool({
  description: DESCRIPTION,
  args: {
    brand_id: tool.schema
      .string()
      .describe("Brand identifier (nike, luxebags, freshfoods)")
      .default("nike"),
    product_identifier: tool.schema
      .string()
      .describe("Product name, SKU, or unique identifier to search for"),
  },
  async execute(args) {
    // This tool provides guidance for getting detailed product information via Shopify MCP
    return `# Product Details Helper: ${args.brand_id.toUpperCase()}

## Requested Product
**Identifier**: "${args.product_identifier}"

---

## How to Get Product Details

To retrieve detailed information about this product, use the **Shopify MCP tool** directly:

\`\`\`
Use tool: shopify-mock_search_shop_catalog
Parameters:
{
  "query": "${args.product_identifier}",
  "limit": 1
}
\`\`\`

This will return comprehensive product information including:

### Product Information
- Full product name and description
- SKU and product ID
- Product category and tags
- SEO metadata

### Pricing
- Current price
- Compare-at price (original/MSRP)
- Discount percentage (if on sale)

### Variants
- All available sizes, colors, materials
- Variant-specific pricing
- Variant SKUs

### Inventory
- Stock status for each variant
- Availability by location (if applicable)

### Media
- Product images (all angles)
- Lifestyle images
- Video content (if available)

---

## Usage Notes

**For Campaign Creation**:
- Use product images and titles from the MCP response
- Reference actual pricing in ad copy
- Mention available variants ("Available in 5 colors")

**For Inventory Checks**:
- Check variant-level availability
- Prioritize in-stock variants in campaigns

**For Pricing Analysis**:
- Compare regular price vs compare-at price
- Calculate discount percentage for promotions

**For SEO/Marketing**:
- Use product tags for keyword targeting
- Reference product categories for collection pages

---

## MCP Server Status

To verify the Shopify MCP is connected:
1. Check server status: \`opencode mcp list\`
2. Ensure 'shopify-mock' shows as 'connected'
3. If not connected, check \`.opencode/opencode.jsonc\` configuration

---

## Alternative Approach

If you don't know the exact product name, use \`query_products\` first to browse:
\`\`\`
query_products(brand_id="${args.brand_id}", query="[category or keyword]", limit=10)
\`\`\`

Then use the specific product name from those results to get full details.

---
*Generated at ${new Date().toISOString()}*`
  },
})

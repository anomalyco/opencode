/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"

const DESCRIPTION = `Load brand context and configuration for ShopOS operations.
Returns available databases, enabled Spaces, brand preferences, and historical patterns.
ALWAYS call this first before running queries or Spaces to understand what's available.`

// Mock brand data - in production this would come from a database/API
const BRANDS: Record<string, BrandContext> = {
  nike: {
    id: "nike",
    name: "Nike India",
    industry: "Footwear & Apparel",
    databases: ["sales_db", "inventory_db", "campaigns_db", "customers_db"],
    spaces: ["image_generation", "copy_generation", "ad_creation", "research", "email_generation"],
    regions: ["Delhi-NCR", "Mumbai", "Bangalore", "Chennai", "Kolkata", "Hyderabad"],
    preferences: {
      voice: "Bold, athletic, inspirational",
      colors: ["#000000", "#FFFFFF", "#FF6B00"],
      avoid: ["discount messaging", "comparison to competitors"],
    },
    performance: {
      avg_roas: 4.2,
      top_region: "Mumbai",
      top_category: "Running Shoes",
      yoy_growth: 18.5,
    },
    shopify: {
      store_url: "mock.shop",
      mcp_endpoint: "local (ShopifyMockMCP)",
      mcp_type: "storefront",
      auth_required: false,
      note: "Using Mock.shop via ShopifyMockMCP server. Free public API with sample commerce data. No credentials needed! See SHOPIFY_MCP_SETUP.md",
    },
  },
  luxebags: {
    id: "luxebags",
    name: "LuxeBags",
    industry: "Premium Accessories",
    databases: ["sales_db", "inventory_db", "campaigns_db"],
    spaces: ["image_generation", "copy_generation", "ad_creation", "research"],
    regions: ["Delhi-NCR", "Mumbai", "Bangalore"],
    preferences: {
      voice: "Elegant, sophisticated, exclusive",
      colors: ["#1A1A1A", "#D4AF37", "#FFFFFF"],
      avoid: ["mass market language", "urgency tactics"],
    },
    performance: {
      avg_roas: 3.8,
      top_region: "Delhi-NCR",
      top_category: "Handbags",
      yoy_growth: 12.3,
    },
    shopify: {
      store_url: "mock.shop",
      mcp_endpoint: "local (ShopifyMockMCP)",
      mcp_type: "storefront",
      auth_required: false,
      note: "Using Mock.shop via ShopifyMockMCP server. Free public API with sample commerce data. No credentials needed! See SHOPIFY_MCP_SETUP.md",
    },
  },
  freshfoods: {
    id: "freshfoods",
    name: "FreshFoods Co",
    industry: "Organic Food & Grocery",
    databases: ["sales_db", "inventory_db"],
    spaces: ["image_generation", "copy_generation", "email_generation"],
    regions: ["Pan India"],
    preferences: {
      voice: "Fresh, healthy, trustworthy",
      colors: ["#4CAF50", "#8BC34A", "#FFFFFF"],
      avoid: ["artificial", "processed"],
    },
    performance: {
      avg_roas: 2.9,
      top_region: "Bangalore",
      top_category: "Organic Vegetables",
      yoy_growth: 45.2,
    },
    shopify: {
      store_url: "mock.shop",
      mcp_endpoint: "local (ShopifyMockMCP)",
      mcp_type: "storefront",
      auth_required: false,
      note: "Using Mock.shop via ShopifyMockMCP server. Free public API with sample commerce data. No credentials needed! See SHOPIFY_MCP_SETUP.md",
    },
  },
  hydrogenstore: {
    id: "hydrogenstore",
    name: "Hydrogen Demo Store",
    industry: "Multi-category Retail",
    databases: ["sales_db", "inventory_db", "campaigns_db"],
    spaces: ["image_generation", "copy_generation", "ad_creation", "research", "email_generation"],
    regions: ["North America", "Global"],
    preferences: {
      voice: "Modern, clean, innovative",
      colors: ["#000000", "#FFFFFF", "#6366F1"],
      avoid: ["outdated terminology", "overly technical jargon"],
    },
    performance: {
      avg_roas: 3.5,
      top_region: "North America",
      top_category: "Snowboarding",
      yoy_growth: 22.8,
    },
    shopify: {
      store_url: "hydrogen-preview.myshopify.com",
      mcp_endpoint: "direct (Shopify Storefront API)",
      mcp_type: "storefront",
      auth_required: true,
      note: "Using Shopify's official Hydrogen demo store. Public Storefront API token: 3b580e70970c4528da70c98e097c2fa0",
    },
  },
}

interface BrandContext {
  id: string
  name: string
  industry: string
  databases: string[]
  spaces: string[]
  regions: string[]
  preferences: {
    voice: string
    colors: string[]
    avoid: string[]
  }
  performance: {
    avg_roas: number
    top_region: string
    top_category: string
    yoy_growth: number
  }
  shopify?: {
    store_url: string
    mcp_endpoint: string
    mcp_type: "storefront" | "admin"
    auth_required: boolean
    note: string
  }
}

export default tool({
  description: DESCRIPTION,
  args: {
    brand_id: tool.schema
      .string()
      .describe("Brand identifier (e.g., 'nike', 'luxebags', 'freshfoods', 'hydrogenstore')")
      .default("nike"),
  },
  async execute(args) {
    const brand = BRANDS[args.brand_id.toLowerCase()]

    if (!brand) {
      const available = Object.keys(BRANDS).join(", ")
      return `Brand '${args.brand_id}' not found. Available brands: ${available}`
    }

    const shopifyInfo = brand.shopify
      ? `
## Shopify Storefront
- **Store URL**: ${brand.shopify.store_url}
- **MCP Server**: ${brand.shopify.mcp_endpoint}
- **API Type**: ${brand.shopify.mcp_type}
- **Authentication**: ${brand.shopify.auth_required ? "Required" : "Not required"}
- **Note**: ${brand.shopify.note}

### Available Shopify Tools
- \`query-products\` - Search and filter product catalog
- \`get-product-details\` - Get detailed product information
- \`query-collections\` - Browse product collections/categories
- \`get-store-policies\` - Retrieve policies, FAQs, shipping info

### MCP Direct Tools
- \`shopify-mock_search_shop_catalog\` - Direct MCP catalog search
- \`shopify-mock_search_shop_policies_and_faqs\` - Direct MCP policy search
- \`shopify-mock_get_cart\` - Retrieve cart contents
- \`shopify-mock_update_cart\` - Modify cart items
`
      : ""

    return `# Brand Context: ${brand.name}

## Basic Info
- **ID**: ${brand.id}
- **Industry**: ${brand.industry}
- **Regions**: ${brand.regions.join(", ")}

## Available Databases
${brand.databases.map(db => `- ${db}`).join("\n")}

## Enabled Spaces
${brand.spaces.map(s => `- ${s}`).join("\n")}

## Brand Preferences
- **Voice**: ${brand.preferences.voice}
- **Colors**: ${brand.preferences.colors.join(", ")}
- **Avoid**: ${brand.preferences.avoid.join(", ")}

## Historical Performance
- **Avg ROAS**: ${brand.performance.avg_roas}x
- **Top Region**: ${brand.performance.top_region}
- **Top Category**: ${brand.performance.top_category}
- **YoY Growth**: ${brand.performance.yoy_growth}%
${shopifyInfo}
---

**Next Steps**:
1. Use \`query-sales\`, \`query-campaigns\`, or \`query-inventory\` to analyze data
2. Use \`query-products\` or \`get-product-details\` to browse Shopify catalog
3. Use \`run-space\` to generate creative assets
4. Use available skills for complex workflows

Brand context loaded successfully. You can now operate ${brand.name}.`
  },
})

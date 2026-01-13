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
}

export default tool({
  description: DESCRIPTION,
  args: {
    brand_id: tool.schema
      .string()
      .describe("Brand identifier (e.g., 'nike', 'luxebags', 'freshfoods')")
      .default("nike"),
  },
  async execute(args) {
    const brand = BRANDS[args.brand_id.toLowerCase()]

    if (!brand) {
      const available = Object.keys(BRANDS).join(", ")
      return `Brand '${args.brand_id}' not found. Available brands: ${available}`
    }

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

Brand context loaded successfully. You can now query data and run Spaces for ${brand.name}.`
  },
})

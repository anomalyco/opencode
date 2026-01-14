---
name: seasonal-campaign
description: "Use for seasonal/holiday campaigns - executes Seasonal Campaign Refresh Plan (100+ assets in 2 hours)"
---

# Seasonal Campaign Refresh Plan

**User Intent:** "Holiday season. I need new creatives for all my hero products."

This Plan generates a complete seasonal campaign package with 100+ assets.

## Time Comparison
- **Manual today**: 3-6 weeks
- **This Plan**: 2 hours

## Required Inputs

Collect before starting:
1. **Brand ID** (nike, luxebags, freshfoods)
2. **Campaign theme** (e.g., "Holiday 2025 — Cozy Luxe")
3. **Channels** (Meta, Google, Instagram, TikTok, Pinterest)
4. **Budget** (for ad recommendations)
5. **Product selection** (specific products, collections, or "all hero products")

## Execution Chain

### ⓪ Product Catalog Loading (NEW)

**IMPORTANT**: Always load real product data from Shopify before starting creative work.

```
get_brand_context(brand_id) → Load brand preferences and Shopify connection
query_collections(brand_id, collection_query="seasonal" or "best sellers") → Browse available collections
query_products(brand_id, limit=10-20, available_only=true) → Get hero products for campaign
```

Output:
- Real product names, prices, variants from Shopify Storefront
- Product images to reference in creative generation
- Current inventory status (prioritize in-stock items)
- Product categories and collections

**Why this matters**:
- Use REAL product names in copy (not placeholders)
- Reference ACTUAL pricing in ads
- Feature only AVAILABLE products (avoid out-of-stock items)
- Match creative to product categories (running shoes vs handbags require different styles)

### ① Trend Intelligence

```
run_space(research) inputs: {
  topic: "seasonal_trends",
  sources: ["tiktok", "pinterest", "instagram"],
  category: "[product_category from Shopify data]"
}
```

Output:
- Trending themes from TikTok, Pinterest, Instagram
- Color palettes and design trends
- Messaging hooks matched to brand tone
- Trend alignment with actual product catalog

### ② Campaign Creative Generation

Run in PARALLEL for each hero product (using real product data from Shopify):
```
run_space(ad_creation) inputs: {
  product: "[real product name from query_products]",
  price: "[actual price from Shopify]",
  variants: "[available sizes/colors from Shopify]",
  variations: 15,
  styles: ["bold", "minimal", "editorial"],
  seasonal_overlay: true,
  theme: "[campaign_theme]"
}
```

Output per product:
- 15 ad variations (static + video) featuring real product details
- Seasonal overlays (holiday props, backgrounds, lighting)
- 3 creative styles: Bold, Minimal, Editorial
- Copy includes actual product names and pricing
- Variants referenced in ad copy (e.g., "Available in 5 colors")

### ③ Social Content Pack

Run in PARALLEL:
```
run_space(social_content) inputs: {platform: "instagram", posts: 20, stories: true}
run_space(social_content) inputs: {platform: "tiktok", videos: 10, durations: ["15s", "30s", "60s"]}
run_space(social_content) inputs: {platform: "pinterest", pins: 5}
```

Output:
- 20 Instagram posts (grid + stories)
- 10 TikTok-style videos (15s, 30s, 60s)
- 5 Pinterest pins

### ④ Ad Copy Variants

```
run_space(copy_generation) inputs: {
  type: "ad_copy",
  include_ab_framework: true,
  headlines: 20,
  ctas: 10,
  body_variations: 15
}
```

Output:
- Headlines, CTAs, body copy
- A/B test framework pre-configured

### ⑤ Deployment Prep

```
Compile all assets with:
- Meta Ads Manager structure (draft campaigns)
- Shopify assets (homepage banners, collection pages)
- Social export pack with posting schedule
```

## Output Package Structure

```
/seasonal_campaign_[theme]/
├── /trend_intelligence/
│   └── trend_report.md
├── /creatives/
│   ├── /product_1/
│   │   ├── bold_static_1.png
│   │   ├── minimal_video_1.mp4
│   │   └── editorial_1.png
│   └── /product_2/
├── /social/
│   ├── /instagram/
│   │   ├── grid_posts/
│   │   └── stories/
│   ├── /tiktok/
│   └── /pinterest/
├── /ads/
│   ├── /meta/
│   └── /google/
├── /copy/
│   ├── headlines.md
│   ├── ctas.md
│   └── ab_test_framework.md
└── /deployment/
    ├── meta_campaign_structure.json
    ├── shopify_assets.zip
    └── content_calendar.csv
```

## A/B Test Structure

Pre-configured tests:
| Test | Variable | Variants |
|------|----------|----------|
| Headline Test | Hero headline | 3 variants |
| Style Test | Creative style | Bold vs Minimal |
| CTA Test | Call to action | 3 variants |
| Format Test | Static vs Video | 2 variants |

## Success Metrics to Track

| Metric | Target |
|--------|--------|
| ROAS | Based on historical |
| CTR | +20% vs last season |
| Engagement | +30% vs BAU |
| Conversion Rate | +15% vs last season |

## Important Notes

- **Always start with Shopify product loading** to use real catalog data
- Start with trend intelligence to inform creative direction
- Generate MORE variations than needed (100+) to enable testing
- Include deployment structure for fast launch
- Pre-configure A/B tests - don't leave as manual step
- Calendar should account for key dates (Black Friday, Cyber Monday, etc.)

## Shopify Integration Benefits

**Before (Manual)**:
- Guess which products are in stock
- Use placeholder product names
- Manually find product images and pricing
- Risk featuring out-of-stock items in campaigns
- Creative team waits for product data

**After (With Shopify MCP)**:
- Real-time product availability
- Actual product names, prices, and variants
- Direct access to product images from catalog
- Automatically prioritize in-stock items
- Parallel execution (product data + creative generation)

**Result**: Accurate campaigns with real products, zero guesswork, faster execution.

## Tool Reference

**Shopify Product Tools Used**:
- `query_products` - Get hero products for campaign
- `query_collections` - Browse seasonal collections
- `get_product_details` - Deep dive on specific products
- `get_store_policies` - Include shipping/return info in campaign materials

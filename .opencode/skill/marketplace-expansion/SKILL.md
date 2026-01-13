---
name: marketplace-expansion
description: "Use when expanding to new marketplaces - executes Marketplace Expansion Plan (multi-platform ready in 3 hours)"
---

# Marketplace Expansion Plan

**User Intent:** "I sell on Shopify. I want to launch on Amazon, Etsy, and Faire."

This Plan adapts your existing catalog for new marketplace launch.

## Time Comparison
- **Manual today**: 4-8 weeks
- **This Plan**: 3 hours

## Required Inputs

Collect before starting:
1. **Existing catalog** (Shopify/current platform export)
2. **Target marketplaces** (Amazon, Etsy, Faire, Walmart, etc.)
3. **Brand positioning adjustments** (per marketplace)
4. **Priority SKUs** (which products to launch first)

## Execution Chain

### ① Asset Adaptation

Run in PARALLEL for each marketplace:

**Amazon:**
```
run_space(image_generation) inputs: {
  platform: "amazon",
  add_infographics: true,
  compliance_badges: true,
  dimension_callouts: true
}
```

**Etsy:**
```
run_space(image_generation) inputs: {
  platform: "etsy",
  style: "lifestyle_heavy",
  aesthetic: "artisan"
}
```

**Faire:**
```
run_space(image_generation) inputs: {
  platform: "faire",
  positioning: "b2b",
  show_wholesale_packaging: true
}
```

Output:
- All product images resized to marketplace specs
- Platform-specific enhancements added
- Compliance and requirement checks passed

### ② Copy Rewrite

Run in PARALLEL:

**Amazon Copy:**
```
run_space(copy_generation) inputs: {
  platform: "amazon",
  style: "keyword_optimized",
  include_aplus_content: true,
  feature_focused: true
}
```

**Etsy Copy:**
```
run_space(copy_generation) inputs: {
  platform: "etsy",
  style: "story_driven",
  handmade_emphasis: true
}
```

**Faire Copy:**
```
run_space(copy_generation) inputs: {
  platform: "faire",
  style: "b2b",
  include_bulk_pricing: true,
  retailer_benefits: true
}
```

Output:
- Amazon: Keyword-stuffed, feature-focused, A+ content
- Etsy: Story-driven, handmade emphasis
- Faire: Bulk pricing, retailer benefits, case packs

### ③ SEO & Tags

```
run_space(research) inputs: {
  topic: "marketplace_keywords",
  platforms: ["amazon", "etsy", "faire"],
  category: "[product_category]"
}
```

Output:
- Marketplace-specific keywords
- Category mapping per platform
- Suggested pricing adjustments per platform

### ④ Listing Creation

```
Generate exports:
- CSV/XML feeds for bulk upload
- API-ready JSON structures
- Quality checks (image resolution, character limits)
```

## Output Package Structure

```
/marketplace_expansion/
├── /amazon/
│   ├── /images/
│   │   ├── sku_001_main.jpg
│   │   ├── sku_001_infographic.jpg
│   │   └── ...
│   ├── /copy/
│   │   ├── titles.csv
│   │   ├── bullets.csv
│   │   └── aplus_content/
│   ├── amazon_feed.csv
│   └── amazon_keywords.md
├── /etsy/
│   ├── /images/
│   ├── /copy/
│   ├── etsy_feed.csv
│   └── etsy_tags.md
├── /faire/
│   ├── /images/
│   ├── /copy/
│   ├── faire_feed.csv
│   └── wholesale_pricing.md
└── /quality_report/
    ├── image_specs_check.md
    ├── character_limits_check.md
    └── compliance_check.md
```

## Platform Requirements Reference

| Platform | Image Size | Title Limit | Description Limit |
|----------|------------|-------------|-------------------|
| Amazon | 2000x2000px | 200 chars | 2000 chars |
| Etsy | 2000x2000px | 140 chars | 10000 chars |
| Faire | 1500x1500px | 100 chars | 5000 chars |
| Walmart | 2000x2000px | 200 chars | 4000 chars |

## Quality Checklist

Before delivery, verify:
- [ ] All images meet platform resolution requirements
- [ ] Titles within character limits
- [ ] Required fields populated
- [ ] Keywords researched and applied
- [ ] Pricing adjusted per platform
- [ ] Category mapping complete

## Important Notes

- Each marketplace has different buyer psychology—copy must reflect this
- Amazon = search-driven, feature-focused
- Etsy = discovery-driven, story-focused
- Faire = B2B, margin and logistics focused
- Always include quality report with compliance status
- Generate bulk upload files, not individual listings

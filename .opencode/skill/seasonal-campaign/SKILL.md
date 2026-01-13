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
1. **Existing product catalog** (hero products to feature)
2. **Campaign theme** (e.g., "Holiday 2025 — Cozy Luxe")
3. **Channels** (Meta, Google, Instagram, TikTok, Pinterest)
4. **Budget** (for ad recommendations)
5. **Key products** (which SKUs to prioritize)

## Execution Chain

### ① Trend Intelligence

```
run_space(research) inputs: {
  topic: "seasonal_trends",
  sources: ["tiktok", "pinterest", "instagram"],
  category: "[product_category]"
}
```

Output:
- Trending themes from TikTok, Pinterest, Instagram
- Color palettes and design trends
- Messaging hooks matched to brand tone

### ② Campaign Creative Generation

Run in PARALLEL for each hero product:
```
run_space(ad_creation) inputs: {
  variations: 15,
  styles: ["bold", "minimal", "editorial"],
  seasonal_overlay: true,
  theme: "[campaign_theme]"
}
```

Output per product:
- 15 ad variations (static + video)
- Seasonal overlays (holiday props, backgrounds, lighting)
- 3 creative styles: Bold, Minimal, Editorial

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

- Start with trend intelligence to inform creative direction
- Generate MORE variations than needed (100+) to enable testing
- Include deployment structure for fast launch
- Pre-configure A/B tests - don't leave as manual step
- Calendar should account for key dates (Black Friday, Cyber Monday, etc.)

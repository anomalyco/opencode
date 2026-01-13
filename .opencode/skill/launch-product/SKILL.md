---
name: launch-product
description: "Use when launching a new product - executes New Product Launch Plan (20-30 assets in 45 min)"
---

# New Product Launch Plan

**User Intent:** "I have a new product. Get me ready to sell everywhere."

This Plan transforms raw product inputs into a complete, deployment-ready launch package.

## Time Comparison
- **Manual today**: 2-4 weeks
- **This Plan**: 45 minutes

## Required Inputs

Collect before starting:
1. **Product photos** (raw images)
2. **Product specs** (name, description, features, price)
3. **Brand context** (brand_id for loading preferences)
4. **Launch channels** (Shopify, Amazon, Meta, etc.)
5. **Timeline** (launch date)

## Execution Chain

### ① Catalog Creation (20-30 assets)

Run in PARALLEL:
```
run_space(image_generation) inputs: {type: "studio", style: "white_background", angles: ["front", "back", "side", "detail"]}
run_space(image_generation) inputs: {type: "lifestyle", variations: 3}
run_space(image_generation) inputs: {type: "editorial", style: "campaign"}
```

Output:
- Studio shots: White background, multiple angles
- Lifestyle shots: Model or flat lay, 3 variations
- Creative shots: Editorial, seasonal, campaign-style

### ② Marketplace Adaptation

Run in PARALLEL:
```
run_space(image_generation) inputs: {platform: "amazon", add_infographics: true}
run_space(image_generation) inputs: {platform: "etsy", style: "lifestyle_focus"}
run_space(image_generation) inputs: {platform: "website", resolution: "high"}
```

Output:
- Amazon: Resize to specs, add infographics, compliance text
- Etsy: Optimized thumbnails, lifestyle focus
- Website: High-res hero images, gallery pack

### ③ Marketing Assets

Run in PARALLEL:
```
run_space(ad_creation) inputs: {variations: 10, platforms: ["meta", "google"]}
run_space(social_content) inputs: {instagram_posts: 5, tiktok_hooks: 3}
run_space(email_generation) inputs: {type: "product_launch"}
```

Output:
- Ad creatives: 10 variations (static + video) for Meta/Google
- Social content: 5 Instagram posts, 3 TikTok hooks
- Email header + product feature banner

### ④ Copy & Metadata

Run in PARALLEL:
```
run_space(copy_generation) inputs: {type: "product_title", seo: true}
run_space(copy_generation) inputs: {type: "product_description", seo: true}
run_space(copy_generation) inputs: {type: "feature_bullets", formats: ["amazon", "shopify", "etsy"]}
run_space(copy_generation) inputs: {type: "ad_copy", headlines: 5, variations: 10}
```

Output:
- Product title + description (SEO-optimized)
- Feature bullets (Amazon, Shopify, Etsy formats)
- Ad copy (5 headlines, 10 variations)
- Suggested tags and categories

## Output Package Structure

```
/product_launch_[product_name]/
├── /catalog/
│   ├── studio_front.png
│   ├── studio_back.png
│   ├── lifestyle_1.png
│   ├── lifestyle_2.png
│   └── editorial_1.png
├── /marketplace/
│   ├── /amazon/
│   ├── /etsy/
│   └── /website/
├── /ads/
│   ├── meta_static_1.png
│   ├── meta_video_1.mp4
│   └── google_display_1.png
├── /social/
│   ├── instagram_post_1.png
│   ├── tiktok_hook_1.mp4
│   └── ...
└── /copy/
    ├── product_copy.md
    ├── ad_copy.md
    └── seo_tags.md
```

## Execution Flow

```
get_brand_context
       ↓
┌──────┴──────┐
│  PARALLEL   │
├─────────────┤
│ Catalog     │
│ Marketplace │
│ Ads         │
│ Social      │
│ Copy        │
└──────┬──────┘
       ↓
   Compile Pack
       ↓
   Deliver to User
```

## Important Notes

- Load brand context FIRST to get voice, colors, preferences
- Run independent Spaces in PARALLEL for speed
- Check inventory before confirming launch dates
- All outputs should be deployment-ready
- Flag any quality issues for human review

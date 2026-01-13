---
name: competitor-response
description: "Use when responding to competitor campaigns - executes Competitor Response Sprint (counter-campaign in 4 hours)"
---

# Competitor Response Sprint

**User Intent:** "My competitor just launched a killer campaign. I need to respond fast."

This Plan generates a rapid counter-campaign to competitive threats.

## Time Comparison
- **Manual today**: 2-4 weeks
- **This Plan**: 4 hours

## Required Inputs

Collect before starting:
1. **Competitor info** (name or campaign URL)
2. **Your product catalog** (products to counter-position)
3. **Budget** (for campaign recommendations)
4. **Timeline** (how fast to deploy)
5. **Channels** (where to respond)

## Execution Chain

### ① Competitor Analysis

```
run_space(research) inputs: {
  topic: "competitor_analysis",
  competitor: "[competitor_name]",
  analyze: ["ads", "landing_pages", "social", "messaging"]
}
```

Output:
- Competitor campaign breakdown (ads, landing pages, social)
- Messaging patterns and design hooks identified
- Gaps and weaknesses highlighted
- What's working for them

### ② Counter-Positioning

```
run_space(research) inputs: {
  topic: "counter_positioning",
  competitor_analysis: "[previous_output]",
  your_products: "[product_list]",
  brand_strengths: "[from_brand_context]"
}
```

Output:
- Differentiated messaging angles
- Creative directions that contrast competitor style
- Product features to emphasize
- Positioning recommendations

### ③ Rapid Creative Generation

Run in PARALLEL:
```
run_space(ad_creation) inputs: {
  variations: 20,
  differentiation_strategy: "[counter_position]",
  style: "stand_out_vs_competitor"
}

run_space(social_content) inputs: {
  posts: 10,
  angle: "differentiation",
  platform: ["instagram", "tiktok"]
}

run_space(copy_generation) inputs: {
  type: "landing_page",
  concepts: 3,
  counter_messaging: true
}
```

Output:
- 20 ad variations (designed to stand out vs. competitor style)
- 10 social posts
- 3 landing page concepts

### ④ Speed Deployment

```
Prepare for immediate launch:
- Meta/Google ad drafts (ready to publish)
- Social content export (ready to schedule)
- A/B test structure (ready to learn)
```

### ⑤ Performance Tracking Setup

```
run_space(research) inputs: {
  topic: "competitive_benchmarks",
  metrics: ["ctr", "engagement", "share_of_voice"],
  tracking_setup: true
}
```

Output:
- Dashboard comparing your campaign vs. competitor benchmarks
- Key metrics to monitor
- Alert thresholds

## Output Package Structure

```
/competitor_response_[competitor]/
├── /intelligence/
│   ├── competitor_analysis.md
│   ├── campaign_breakdown.md
│   ├── gaps_opportunities.md
│   └── screenshots/
├── /strategy/
│   ├── counter_positioning.md
│   ├── messaging_angles.md
│   └── creative_direction.md
├── /creatives/
│   ├── /ads/
│   │   ├── differentiated_static_1.png
│   │   ├── differentiated_video_1.mp4
│   │   └── ... (20 variations)
│   ├── /social/
│   │   └── ... (10 posts)
│   └── /landing_pages/
│       └── concept_1.html
├── /deployment/
│   ├── meta_campaign_draft.json
│   ├── google_campaign_draft.json
│   └── social_schedule.csv
└── /tracking/
    ├── dashboard_setup.md
    ├── benchmark_targets.md
    └── alert_thresholds.md
```

## Speed Priority Matrix

| Action | Time | Priority |
|--------|------|----------|
| Competitor analysis | 30 min | Critical |
| Counter-positioning | 30 min | Critical |
| Ad creative generation | 1 hour | High |
| Social content | 45 min | High |
| Landing page concepts | 45 min | Medium |
| Deployment prep | 30 min | High |
| Tracking setup | 30 min | Medium |

## Differentiation Strategies

Choose based on competitor approach:

| Competitor Does | You Counter With |
|-----------------|------------------|
| Price focus | Value/quality focus |
| Feature dump | Emotional storytelling |
| Minimalist design | Bold, attention-grabbing |
| Celebrity endorsement | Authentic customer stories |
| Urgency/scarcity | Confidence/abundance |
| Generic messaging | Hyper-specific targeting |

## Important Notes

- SPEED is critical—this is a sprint, not a marathon
- Don't copy competitor; differentiate aggressively
- Focus on your strengths, not their weaknesses
- Have deployment-ready assets, not concepts
- Set up tracking BEFORE launch to measure impact
- Plan for iteration—first response may need refinement

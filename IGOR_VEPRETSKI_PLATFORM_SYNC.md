# Igor Vepretski Platform Sync Plan (7ya.io as Source of Truth)

This document aligns all Igor Vepretski platforms around one canonical brand/message system, managed through **7ya.io**.

## Primary Goal

Use **7ya.io** as the central source for:
- brand narrative
- offer positioning
- contact and booking paths
- publication and distribution workflow

## Platform Architecture

### 1) Canonical Hub
- **7ya.io** = master website and conversion hub
- Every platform bio should point to `https://7ya.io`
- All lead capture should route back to one CTA system (newsletter, booking, or inquiry form)

### 2) Distribution Platforms (Spokes)
Maintain synchronized profiles and messaging on:
- X / Twitter
- LinkedIn
- YouTube
- Instagram
- TikTok
- Telegram
- GitHub
- Any podcast/newsletter directories

## Identity Sync Standard

Apply these across all platforms:
- Same profile photo (or approved variant pack)
- Same display name: **Igor Vepretski**
- Same short bio baseline (platform-sized variants allowed)
- Same primary link: `https://7ya.io`
- Same visual palette and voice style

## Content Sync Workflow

### Weekly Cadence
1. Publish long-form anchor content on 7ya.io.
2. Repurpose into short posts per platform format.
3. Publish within a 24-48 hour window to keep campaigns coordinated.
4. Track performance and feed winning themes back into 7ya.io.

### Content Mapping
- Website article -> LinkedIn post + X thread + newsletter excerpt
- Video -> YouTube long-form + Shorts/Reels/TikToks
- Announcement -> synchronized short post on all active social platforms

## Operational Checklist

### Setup
- [ ] Audit all Igor Vepretski accounts and access ownership
- [ ] Standardize profile assets and bios
- [ ] Replace all outdated links with `https://7ya.io`
- [ ] Configure consistent UTM tagging by platform

### Automation
- [ ] Create a unified content calendar
- [ ] Add scheduling automation (where APIs/tools permit)
- [ ] Define posting templates per platform
- [ ] Add a monthly profile drift review (bio/link/branding mismatches)

### Measurement
- [ ] Define north-star conversion event on 7ya.io
- [ ] Track source attribution by platform
- [ ] Review monthly: reach, engagement, conversion quality
- [ ] Double down on top 2 channels by assisted conversions

## Governance

- **Owner:** Igor Vepretski
- **Control plane:** 7ya.io
- **Update policy:** Any new campaign starts at 7ya.io, then propagates to all platforms.

## Definition of Done

All Igor Vepretski platforms are considered synced when:
1. Profiles match identity standards.
2. Every profile points to 7ya.io.
3. Active campaigns are published across chosen channels in a coordinated window.
4. 7ya.io analytics can attribute platform-origin traffic and conversions.

---

## Video Intake: `#7ya | Igor Vepretski Story ‍| what’s your story`

Linked video: `https://youtu.be/fxFAUrb1h0M`

### What this implies for platform management

Based on the published title and existing brand context in this repo, the video appears to position **7ya** as a story-first personal/social brand anchored on Igor Vepretski's narrative. Treat this as a top-of-funnel identity asset and wire every profile + CTA path back to 7ya.io.

### Content extraction actions

- [ ] Pull transcript and key moments manually from YouTube Studio
- [ ] Create one long-form story page on 7ya.io based on the video
- [ ] Derive platform-specific cuts:
  - [ ] X thread (origin story)
  - [ ] LinkedIn post (mission + outcomes)
  - [ ] Instagram Reel/TikTok clips (high-emotion short moments)
  - [ ] YouTube Shorts with consistent CTA to `https://7ya.io`
- [ ] Add one canonical CTA in every derivative asset

---

## Video Intake: `איגור ופרצקי | #7YA🥷`

Linked video: `https://youtu.be/5F8-g_ACPlk`

### What this implies for platform management

This title reinforces bilingual identity branding (Hebrew + Latin-script naming) with a strong **#7YA** tag. Push this as an additional top-of-funnel narrative touchpoint and keep the destination CTA consistent: `https://7ya.io`.

### Content extraction actions

- [ ] Add this video to the active campaign calendar and cross-platform distribution queue
- [ ] Reuse a single CTA variant across all cuts: `Manage 7ya.io` + `https://7ya.io`
- [ ] Publish one Hebrew-first caption variant and one English-first caption variant per platform
- [ ] Track engagement split by language variant and feed winner back into the 7ya.io canonical page copy

---

## 7ya.io Operations Runbook

### 1) Domain and DNS

- Registrar lock and 2FA enabled
- DNS hosted on provider with API support and audit log
- Records baseline:
  - `A/AAAA` for apex (`7ya.io`)
  - `CNAME` for `www -> 7ya.io` (or reverse, but pick one canonical host)
  - `MX`, `SPF`, `DKIM`, `DMARC` for brand email
- DNS TTL defaults:
  - 300 seconds for records under active migration
  - 3600 seconds for stable records

### 2) Security and TLS

- Enforce HTTPS with auto-renewed certificates
- Enable HSTS once redirects are validated
- Add WAF/bot protection at edge
- Rotate API keys and admin credentials quarterly
- Ensure admin surfaces are not exposed publicly without auth

### 3) Uptime and incident response

- External uptime check every 1 minute for:
  - homepage
  - lead form submit endpoint
  - booking/inquiry confirmation endpoint
- Alert routing:
  - primary: Telegram/Slack
  - secondary: email/SMS
- Incident severity model:
  - Sev1: site down or forms unavailable
  - Sev2: degraded performance or partial conversion path failure
  - Sev3: cosmetic/content issues

### 4) Analytics and attribution

- Install analytics + server-side event capture
- Define canonical conversion events:
  - `lead_submitted`
  - `booking_requested`
  - `newsletter_subscribed`
- Enforce UTM taxonomy:
  - `utm_source` = platform
  - `utm_medium` = social|video|email
  - `utm_campaign` = campaign slug
- Monthly review:
  - traffic by source
  - conversion rate by source
  - assisted conversions

### 5) Publishing workflow

- Every campaign starts with a canonical page on 7ya.io
- Social/video posts are always derived from canonical page
- Add a campaign checklist issue before publish:
  - page ready
  - UTM links generated
  - platform variants exported
  - publish window scheduled
  - post-publish monitoring assigned

---

## 30/60/90-Day Execution Plan

### Days 0-30 (stabilize)

- [ ] Full account audit and access inventory
- [ ] Domain/DNS/TLS hardening complete
- [ ] Canonical bio + link normalization across all active platforms
- [ ] Basic dashboard for traffic + conversion

### Days 31-60 (systemize)

- [ ] Content calendar with weekly anchor cadence
- [ ] Repurposing pipeline from long-form to short-form
- [ ] Baseline KPI targets per platform
- [ ] Monthly drift-check ritual established

### Days 61-90 (optimize)

- [ ] Double down on top performing channels by assisted conversions
- [ ] A/B test landing page headlines/CTA flows
- [ ] Add CRM enrichment and lead scoring (if available)
- [ ] Publish quarterly narrative recap and refresh campaign stack

---

## Hardcore Massive Promotion Mode

Use this mode when the objective is maximum reach and aggressive traffic capture for a specific campaign window.

### Activation trigger

- Turn on when launching a major story asset, offer, or collaboration.
- Run for 7, 14, or 30 days with a clearly defined conversion goal.
- Keep one command CTA across every touchpoint: `Manage 7ya.io` -> `https://7ya.io`.

### Execution rules

- Publish daily on at least 3 active platforms.
- Ship one high-intensity creative variant per day (new hook, angle, or edit).
- Repost winning clips in 48-hour cycles with updated captions/thumbnails.
- Pin CTA comments/posts that route directly to the campaign page on 7ya.io.
- Route all bios, link-in-bio tools, and channel descriptions to the same campaign URL.

### Budget + distribution

- Boost top organic posts within 12-24 hours if engagement velocity is above baseline.
- Split paid distribution by intent:
  - 60% retargeting warm audiences
  - 30% lookalike/prospecting
  - 10% experimental creative tests
- Cut underperforming ad sets fast and reallocate to top CTR + conversion performers.

### Daily operating loop

1. Review previous 24h metrics (reach, watch time, CTR, landing conversion).
2. Select top 1-2 assets and clone them into new platform-native versions.
3. Publish new variants with consistent CTA.
4. Respond to comments/DMs within the first hour for algorithmic lift.
5. Update the 7ya.io campaign page using objections/questions from community feedback.

### Exit criteria

- Campaign conversion rate is stable and predictable for 5+ consecutive days.
- A clear top channel mix is identified and documented.
- Winning messaging is folded back into always-on platform baseline content.

---

## God-Level YouTube System (`@igor.vepretski`)

This section upgrades the channel workflow into an execution system that turns each upload into a multi-platform campaign and routes attention back to **7ya.io**.

### 1) Channel Positioning Matrix

Use three recurring content pillars and keep every video mapped to one pillar:

- **Identity / Story** (`#7YA`, founder energy, mindset, behind-the-scenes)
- **Authority / Proof** (results, case studies, transformations, collaborations)
- **Lifestyle / Symbolism** (high-contrast visuals, signature look, cinematic brand assets)

Publishing target per 7-day cycle:
- 1 long-form YouTube anchor (6-12 min)
- 3-5 Shorts derived from the anchor
- 2 community posts driving votes/comments

### 2) Thumbnail + Hook Standard

- Always include one dominant emotion and one symbolic prop (for memorability).
- Keep text short: 2-5 words max.
- Use visual contrast (dark background + bright subject or vice versa).
- A/B test two thumbnail variants in the first 24 hours.

**First 15 seconds script pattern:**
1. Pattern interrupt visual.
2. One-line promise.
3. Credibility proof.
4. CTA that opens loop ("watch till the end", "comment your story").

### 3) Title and Packaging Framework

Use one of these title formulas per upload:

- `I did X in Y days (what changed)`
- `Nobody tells you this about X`
- `From X to Y: my real story`
- `I tested X so you don't have to`

Packaging QA before publish:
- [ ] Title creates curiosity without clickbait mismatch
- [ ] Thumbnail communicates story without title dependency
- [ ] First 30s includes proof + narrative tension
- [ ] Description has first-link CTA to `https://7ya.io`
- [ ] Pinned comment routes to same campaign page on 7ya.io

### 4) Conversion Plumbing to 7ya.io

Every video must carry one specific conversion path (not multiple competing asks):

- **Primary CTA:** `Manage 7ya.io`
- **Destination:** campaign-specific landing URL on `https://7ya.io`
- **Tracking:** required UTMs on description + pinned comment links

UTM convention for YouTube:
- `utm_source=youtube`
- `utm_medium=video`
- `utm_campaign=<video_slug>`
- `utm_content=description|pinned_comment|shorts`

### 5) Upload-Day SOP (90-minute execution)

1. Publish long-form video.
2. Add chapters, subtitles, end screens, cards.
3. Post pinned comment with CTA + question.
4. Export 1-2 Shorts immediately from best hook moments.
5. Cross-publish teaser to Instagram/TikTok/X with same CTA URL.
6. Reply to first 20 comments fast to boost session depth.

### 6) Weekly Review Dashboard

Track per video (D1, D3, D7):
- CTR (thumbnail/title strength)
- Avg view duration and first-30s retention
- Returning viewers vs new viewers
- Comments per 1,000 views
- 7ya.io click-throughs and conversion rate

Decision rules:
- CTR low + retention strong -> improve thumbnail/title only
- CTR high + retention weak -> rework hook/first minute structure
- Good watch metrics + weak clicks -> improve CTA clarity and offer-page match

### 7) Brand Asset System (Based on Existing Visual Direction)

From current creative style, define a reusable asset bank:
- Hero portraits (close-up confidence framing)
- Cinematic campaign banners (`#7YA`, black/white contrast)
- Symbolic animal-themed variants for attention hooks
- Street/lifestyle documentary shots for authenticity

Operational rule:
- Build once, then reuse assets as templates across YouTube thumbnails, Shorts covers, and cross-platform promo cards.

### 8) 14-Day Sprint to “God Level” Baseline

- **Day 1-2:** Channel audit + packaging refresh for top 12 videos
- **Day 3-4:** Produce 1 flagship long-form + 5 Shorts
- **Day 5-7:** Daily Shorts + community post experiments
- **Day 8-10:** Publish second long-form with improved hook from sprint learnings
- **Day 11-14:** Retention and conversion review, then lock next monthly content map

Definition of success for sprint:
- +20% channel CTR average
- +25% Shorts completion rate
- measurable weekly traffic lift to 7ya.io from YouTube sources

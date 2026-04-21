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

---
name: premium-web-design
description: Transform any website into a premium, Apple-quality web experience. Use when building new websites, redesigning existing ones, reviewing web design quality, implementing landing pages, or when the user mentions "premium", "luxury", "high-end", "Apple-like", or "professional" website design. Also activate when creating hero sections, improving visual hierarchy, adding animations, or optimizing web aesthetics.
---

# Premium Web Design Expert System

You are now a premium web design expert. Every design decision you make must pass one test: **"Would this feel at home on Apple.com?"** If not, refine it.

## Core Mental Model

Premium = Restraint + Intention + Craft. Every pixel, every animation, every color choice must be deliberate. Nothing is accidental. Nothing is default.

Users judge a website in **50 milliseconds** (Lindgaard et al., 2006, r=0.97 stability). That judgment transfers directly to the product/brand. A cheap-looking website = a cheap-seeming product, regardless of actual quality.

## Decision Framework

When making ANY design decision, apply this priority stack:

1. **Does it reduce cognitive load?** (Remove if it adds complexity without value)
2. **Does it guide the user?** (Every element should direct attention intentionally)
3. **Does it feel crafted?** (No defaults, no generic patterns, no template aesthetics)
4. **Does it perform?** (Sub-2.5s LCP, no jank, 60fps animations)
5. **Is it accessible?** (WCAG AA minimum, keyboard navigable, screen-reader compatible)

## The 10 Laws of Premium Web Design

### Law 1: The 50ms Rule
The above-the-fold area must communicate quality instantly. This means:
- Clean visual hierarchy with clear focal point
- Professional typography (no system defaults)
- Generous whitespace (40% content, 60% space for luxury feel)
- High-quality imagery (no generic stock photos)
- Fast paint (inline critical CSS, preload LCP image)

#### Hero Variants (rotate across projects -- never use the same layout twice)

| Pattern | Layout | Best For | Example |
|---------|--------|----------|---------|
| **Split** | Text left (55-60%), image/video right (40-45%) | SaaS, apps, tools | Linear, Vercel |
| **Asymmetric** | Headline offset-left, visual bleeds past right edge | Creative, agencies | Aesop, portfolios |
| **Full-bleed media** | Video/image fills viewport, text overlay with scrim | Automotive, luxury, travel | Tesla, Porsche |
| **Editorial** | Large serif headline (80-120px), minimal subtext, no hero image | Fashion, editorial, brands | Rolex |
| **Product spotlight** | Product image dominant (65%+), tight caption beside it | E-commerce, DTC, hardware | Apple, B&O |
| **Dashboard/UI** | Angled screenshot or mockup, headline above or beside | Dev tools, SaaS, analytics | Stripe |

#### Above-the-Fold Composition
- **Focal point placement**: top-left or center-left (F-pattern entry point), NOT dead-center
- **Visual weight**: 60% one side, 40% other -- avoid 50/50 symmetry (feels static)
- **Alignment**: left-aligned headlines outperform centered for readability (except full-bleed media heroes)
- **Required elements in first viewport**: value proposition + primary CTA + one trust signal (logo bar or metric)
- **Background mood**: warm tones (ivory, cream) = approachable; dark (#0A0A0F-#1A1A1A) = authority/tech; white = clean/minimal

### Law 2: One Thing Per Section
Each viewport section communicates ONE idea and drives ONE action. Mixed messages create cognitive overload. Apple shows one feature per scroll section. Follow this pattern.

### Law 3: Typography Is Identity
- Use maximum 2-3 fonts (1 heading + 1 body is ideal)
- Establish clear size hierarchy: H1 (48-64px) > H2 (36-48px) > H3 (28-32px) > Body (16-18px)
- Use fluid typography: `font-size: clamp(min, preferred, max)`
- Body line-height: 1.5-1.8. Heading line-height: 1.1-1.3
- Optimal reading width: 50-75 characters (use `max-width: 70ch`)
- Never use default system fonts for headings

### Law 4: Color Restraint
Apply the 60-30-10 rule:
- 60% dominant (background): whites, off-whites, or dark surfaces
- 30% secondary (cards, sections): subtle neutrals
- 10% accent (CTAs, highlights): one strong brand color

Premium brands use 2-3 core colors maximum. Muted, desaturated tones over bright vivid pops. Blue (#0066CC-range) universally conveys trust and competence.

### Law 5: White Space Is Luxury
White space is not "empty" -- it is the most powerful design element.
- Section padding: 80-120px desktop, 60-80px mobile
- Hero padding: 120-200px desktop
- Content-to-whitespace ratio: ~40:60 for premium, ~60:40 for standard
- Elements must NEVER touch or crowd each other
- Headings: 1.5-2x more space above than below

### Law 6: Animate With Purpose
Every animation must clarify, guide, or confirm. Never animate for decoration.
- Duration: 150-500ms for UI interactions (never <100ms). Exception: scroll reveals may use 500-600ms as they are content entrances, not UI responses
- Easing: `cubic-bezier(0.16, 1, 0.3, 1)` for reveals, `cubic-bezier(0.25, 1, 0.5, 1)` for general UI
- Only animate `transform` and `opacity` (GPU-composited, no layout triggers)
- Scroll reveals: fade-up with `translateY(20-30px)` to `translateY(0)`
- Hover: `translateY(-2px)` + subtle shadow increase for buttons/cards
- ALWAYS respect `prefers-reduced-motion`
- Never use `linear` easing (feels robotic)

### Law 7: Images Make or Break Premium
- No generic stock photos -- they destroy perceived value instantly
- Use AVIF > WebP > JPEG with `<picture>` fallbacks
- Hero images: `loading="eager"` + `fetchpriority="high"`
- Below-fold images: `loading="lazy"` + `decoding="async"`
- Always set `width` and `height` attributes (prevents CLS)
- Product images: minimum 2000x2000px for zoom capability

### Law 8: Performance IS Premium
A slow website cannot feel premium regardless of visual quality.
- LCP <= 2.5 seconds (target sub-2s)
- INP <= 200ms
- CLS <= 0.1
- Fonts: WOFF2 only, preload critical fonts, use `font-display: swap` for headings
- Images: responsive `srcset`/`sizes`, modern formats
- Never `loading="lazy"` on LCP images

### Law 9: Guide, Don't Overwhelm
- One primary CTA per section (single CTA increases clicks by 371%)
- Progressive disclosure: show essentials first, details on demand
- F-pattern for text-heavy pages, Z-pattern for conversion pages
- Fewer choices = more conversion (6 options: 30% buy rate vs 24 options: 3%)
- Use smart defaults in forms and configurators
- Social proof above-the-fold generates 2-3x more engagement

### Law 10: Consistency Is Craft
- Use an 8px spacing grid for ALL dimensions
- Define design tokens for colors, spacing, typography, shadows, radii, transitions
- Same easing curves for similar interactions throughout
- Same shadow system (layered shadows, never plain black)
- Same border-radius scale: `--radius-sm` (4px) tags/badges, `--radius-md` (8px) cards, `--radius-lg` (12px) containers, `--radius-xl` (16px) modals/large panels
- Inconsistency looks like carelessness. Carelessness is not premium.

## Landing Page Blueprint

Apply this section order with flow transitions:

```
1. HERO: Use a hero variant (see Law 1). Never default to centered-text-on-gradient.
2. SOCIAL PROOF: Logo bar (grayscale, 4-8 logos) or "Trusted by X+"
   ↓ attach to hero (minimal gap, shared background color)
3. PROBLEM: Identify the pain point
4. SOLUTION: Your unique value proposition
   ↓ shift background tone (light → off-white, or white → dark)
5. FEATURES: Benefits as outcomes. Alternate media left/right (Z-pattern).
6. DEEP PROOF: Testimonials with real names/photos, quantified results
   ↓ breathing section: insert single stat, pulled quote, or full-width image
7. HOW IT WORKS: 3-step visual process
8. PRICING: Anchored high-to-low, one highlighted recommendation
9. FAQ: Address objections, reduce friction
10. FINAL CTA: Repeat primary action with urgency/summary
11. FOOTER: 4 columns, contact, legal, social, newsletter
```

## Section Flow & Transitions

A premium page reads as one continuous narrative, not a stack of isolated blocks.

### Rhythm Patterns
- **Light/Dark alternation**: Alternate background tones every 1-2 sections (Apple pattern: light → dark → light). Never 3+ consecutive sections with the same background.
- **Dense/Sparse alternation**: Follow a content-heavy section with a spacious quote, single stat, or image. This creates visual "breathing."
- **Media alternation**: If section N has image-left/text-right, section N+1 flips to text-left/image-right.

### Section Transition Techniques (use 2-3 per page, not all)
1. **Background tone shift**: Section A ends with off-white; section B starts with light gray. Subtle but effective.
2. **Overlapping elements**: A card, image, or testimonial card visually overlaps the section boundary (negative margin: -40px to -80px)
3. **Shared accent thread**: A consistent accent-colored element (vertical line, dot timeline, icon series) connects sections visually
4. **Progressive reveal**: Each section reveals more detail about the same topic -- zooming from overview to detail
5. **Full-bleed break**: Insert a full-width image, video, or dark section between two light content sections to reset rhythm

### Content Pacing Guide

| Section Type | Height | Spacing Token | Content Density |
|-------------|--------|---------------|-----------------|
| Hero | Tall (90-100vh) | --section-lg | Low: headline + CTA only |
| Social proof | Compact (auto) | --section-sm | Low: logos only |
| Problem/Solution | Medium | --section-md | Medium: 1 paragraph + visual |
| Features | Tall | --section-lg | Medium: alternating cards |
| Testimonials | Medium | --section-md | Low: 1-2 quotes |
| How it works | Medium | --section-md | Medium: 3 steps |
| CTA | Compact | --section-sm | Low: headline + button |

### The Breathing Rule
Never stack two content-dense sections back-to-back. Between them, insert a "breathing" element:
a single testimonial quote, a large stat number, a full-width image, or a minimal CTA bar.

## Premium Copy Patterns

Premium copy is specific, confident, and concise. It never hedges or oversells.

### Headline Formulas
- **Outcome-first**: "[Desired outcome] without [pain point]" -- e.g., "Ship faster without breaking things"
- **One-word anchor**: Single powerful word as headline, explanatory subheadline below -- e.g., "Clarity." / "Financial tools that make sense"
- **Specificity wins**: Replace vague claims with numbers -- "50,000 teams" not "thousands of teams". Concrete words are recalled 1.5-2x better than abstract ones (Mehrabian & Reed, 1968)
- **6-9 words maximum** for hero headlines (highest recall and comprehension)

### Tone of Voice
- **Confident**, not aggressive: "We built this" not "The ULTIMATE solution!!!"
- **Specific**, not vague: "Deploys in 38 seconds" not "Lightning-fast deployment"
- **Human**, not corporate: "Your customers will notice" not "Leverage synergistic paradigms"
- **Short sentences.** Paragraphs of 1-3 sentences maximum. One idea per paragraph.

### CTA Microcopy
- Action-specific: "Start building" not "Get started", "See pricing" not "Learn more"
- Match the CTA to what happens next: "Watch demo" (if video), "Try free for 14 days" (if trial)
- Secondary CTAs use ghost/outline style, never compete visually with primary

### Section Copy Rule
Each section gets: **one headline (6-9 words) + one supporting paragraph (2-3 sentences max) + one CTA or visual.**
If you need more text, split into two sections. Users scan, not read (NNGroup: users read ~20% of page text).

## CSS Implementation Patterns

### Spacing System
```css
:root {
  --space-1: 0.25rem; --space-2: 0.5rem; --space-3: 0.75rem;
  --space-4: 1rem; --space-6: 1.5rem; --space-8: 2rem;
  --space-12: 3rem; --space-16: 4rem; --space-20: 5rem;
  --space-24: 6rem; --space-32: 8rem;
}
```

### Shadow System (layered, never plain black)
```css
:root {
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.1);
  --shadow-md: 0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.06);
  --shadow-lg: 0 10px 15px rgba(0,0,0,0.1), 0 4px 6px rgba(0,0,0,0.05);
  --shadow-xl: 0 20px 25px rgba(0,0,0,0.1), 0 8px 10px rgba(0,0,0,0.04);
}
```

### Animation Tokens
```css
:root {
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);
  --ease-in-out-expo: cubic-bezier(0.87, 0, 0.13, 1);
  --duration-fast: 150ms; --duration-normal: 250ms; --duration-slow: 350ms;
}
```

### Scroll Reveal Pattern
```css
[data-animate] {
  opacity: 0; transform: translateY(30px);
  transition: opacity 0.6s var(--ease-out-expo), transform 0.6s var(--ease-out-expo);
}
[data-animate].is-visible { opacity: 1; transform: translateY(0); }

/* Preferred: progressive enhancement (animation added, not removed) */
@media (prefers-reduced-motion: reduce) {
  [data-animate] { opacity: 1; transform: none; transition: none; }
}
```

### Premium Button
```css
.btn-primary {
  transition: transform 200ms var(--ease-out-quart), box-shadow 200ms var(--ease-out-quart);
}
.btn-primary:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }
.btn-primary:active { transform: translateY(0) scale(0.98); transition-duration: 100ms; }
```

## Dark Mode Rules
- Never pure black (#000) backgrounds -- use #121212 or #1A1A1A
- Never pure white (#FFF) text -- use #E0E0E0
- Shadows don't work on dark -- use lighter surface layers (#1E1E1E, #242424, #2C2C2C)
- Desaturate colors to prevent eye strain
- Use `color-scheme: light dark` and `light-dark()` CSS function

## Anti-Patterns (NEVER Do These)

1. **Generic stock photos** -- destroys premium perception instantly
2. **More than 3 fonts** -- creates visual chaos
3. **Linear easing** on UI animations -- feels robotic
4. **Animating width/height/margin/padding** -- causes layout thrashing, jank
5. **Pop-ups in first 5 seconds** -- increases bounce rate 5x
6. **Scroll-jacking** -- overriding native scroll frustrates users
7. **Inconsistent spacing** -- arbitrary values instead of grid system
8. **Template-recognizable design** -- if users recognize the template, premium is lost
9. **AOS library with defaults** -- every element sliding in identically
10. **Animations >500ms** -- feels like delay, not design
11. **Missing prefers-reduced-motion** -- accessibility failure
12. **lazy-loading LCP image** -- kills Core Web Vitals
13. **Pure black shadows** -- looks harsh; tint shadows to match surface
14. **Too many CTAs** -- competing actions create decision paralysis
15. **Cluttered sections** -- if it has more than one message, split it

## Avoid AI-Generated Aesthetics

AI-generated websites share recognizable tells that instantly signal "template" to trained eyes. Every project must feel unique. Actively avoid these patterns:

### The 10 AI Tells (NEVER default to these)

1. **Same font pairing every time** (Playfair Display + Inter, Poppins + Inter) -- rotate through genre-specific pairings (see design-tokens.md)
2. **Purple/indigo accent colors** (#6366F1, #8B5CF6, #7C3AED range) as AI-default choices -- choose accents from the BRAND identity. Exception: if purple IS the client's actual brand color (e.g., Stripe #635BFF, Figma #A259FF), use it confidently
3. **Purple-blue gradient backgrounds** -- if you catch yourself reaching for a purple-blue gradient, stop. Use solid colors, photography, or brand-derived gradients
4. **Identical hero layout every time** (centered headline over gradient/mesh background with centered CTA) -- use hero variants (see Law 1). Left-aligned, split, editorial, and full-bleed heroes exist
5. **Uniform border-radius everywhere** (12-16px on everything) -- vary by element: 0px for editorial sharpness, 4px for tags/badges, 8px for cards, 16px for large containers, full-round for avatars
6. **Perfect center-alignment on everything** -- use left-aligned heroes, asymmetric layouts, offset grids. Real premium sites use intentional asymmetry
7. **Identical card grids** (same-sized cards, same shadows, same radius) -- vary card sizes (bento grid), mix card styles, use masonry layouts
8. **"Aurora" / gradient mesh backgrounds** as primary visual -- these are the #1 AI tell of 2024-2026. Use solid colors, subtle textures, real photography, or CSS-only patterns instead
9. **Cookie-cutter sections** (identical padding, identical structure repeating) -- vary section density, height, and composition throughout the page
10. **Overly smooth, uniform feel** -- no sharp edges anywhere, everything rounded, everything soft. Premium sites mix sharp (editorial sections, dividers, typography) with soft (cards, images, CTAs)
11. **Zero-chroma neutrals** -- shadcn/ui default grays have zero warmth (oklch with 0 chroma). Add slight warm (stone/sand tint) or cool (blue-gray tint) bias to ALL neutral colors. Emotionally dead grays = instant AI tell
12. **"Three of Everything"** -- 3 feature cards, 3 testimonials, 3 pricing tiers. This mathematical symmetry is a giveaway. Use 2, 4, 5, or asymmetric groupings
13. **Timid weight contrast** -- font-weight 400 vs 600 (AI default). Use dramatic contrast: 300 vs 700, or 200 vs 800. The bigger the jump, the more intentional it looks
14. **Generic aspirational headlines** -- "Build the future of X", "Your all-in-one platform", "Scale without limits", "Empowering teams everywhere". These are AI copy tells. Write specific, outcome-focused headlines instead

### The Uniqueness Test

Before finalizing any design, ask: *"If I placed this alongside 5 other AI-generated sites, would it blend in or stand out?"*
If it blends in, change: the font pairing, the accent color, the hero layout, or the border-radius strategy.

### Differentiation Rules

- Pick fonts from design-tokens.md using the **genre** of the project, never the first pairing listed
- Derive accent color from the brand's actual identity or imagery, not from a generic palette
- Alternate hero patterns across projects: split, asymmetric, editorial, video-bg, product-focused (see Hero Variants)
- Use sharp edges (border-radius: 0) on at least some elements -- editorial authority comes from contrast between sharp and soft
- Vary section backgrounds: don't use the same background on consecutive sections
- Include at least one "unexpected" element per page: an oversized number, a pulled quote in large serif, a full-bleed image, an asymmetric layout break

## Verification Checklist

Before declaring any web design work complete, verify:

- [ ] Above-the-fold communicates quality within 50ms (clean hierarchy, professional typography, generous whitespace)
- [ ] Hero uses a specific variant (split, asymmetric, editorial, etc.) -- NOT default centered-text-on-gradient
- [ ] Typography: max 2-3 fonts, genre-appropriate pairing from design-tokens.md, fluid scaling
- [ ] Colors: 60-30-10 rule, max 2-3 core colors, style palette chosen from design-tokens.md, WCAG AA contrast
- [ ] Spacing: 8px grid system, generous section padding (80-120px), consistent throughout
- [ ] Section flow: light/dark alternation, breathing sections between dense content, varied section heights
- [ ] Images: modern formats (AVIF/WebP), responsive srcset, proper loading attributes
- [ ] Animations: purposeful, 150-500ms, ease-out curves, transform/opacity only, reduced-motion respected
- [ ] Performance: LCP <= 2.5s, CLS <= 0.1, fonts preloaded/WOFF2
- [ ] Accessibility: focus indicators, semantic HTML, alt texts, keyboard navigation
- [ ] Copy: headlines 6-9 words, specific numbers, action-specific CTAs, one CTA per section
- [ ] AI-tell check: no purple gradients, no uniform border-radius, no identical card grids, no zero-chroma grays, no "three of everything", passes Uniqueness Test
- [ ] No anti-patterns from the list above

## Reference Materials

For detailed specifications, code examples, and scientific evidence, see:
- [design-tokens.md](design-tokens.md) -- Complete copy-paste-ready CSS design token system
- [brand-patterns.md](brand-patterns.md) -- How Apple, Stripe, Tesla, and 8 other premium brands implement these principles
- [scientific-evidence.md](scientific-evidence.md) -- 80+ peer-reviewed studies backing these guidelines
- [animation-cookbook.md](animation-cookbook.md) -- Ready-to-use animation code patterns (GSAP, Framer Motion, CSS)

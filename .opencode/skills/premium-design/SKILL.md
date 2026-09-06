---
name: premium-design
description: Builds premium, editorial-grade web interfaces for high-end brands, luxury products, design-forward SaaS, and creative portfolios. TRIGGER when the user wants an editorial, luxe, high-end, premium, creative agency, magazine-style, or fashion-brand website. Explicit triggers: 'premium design', 'luxe', 'editorial', 'high end', 'atelier', 'make it premium', 'make it luxe', 'fashion brand', 'creative agency site', 'portfolio site'. Use this instead of the general `design` skill when the aesthetic target is refined / editorial / premium rather than standard SaaS.
---

# Premium Design — Kinetic Luxe

A catalog-driven skill for building premium, editorial, high-end interfaces. Distinct from the general `design` skill: this one is opinionated about typography, motion, and restraint.

---

## Design philosophy — the five rules

### 1. Typography is the protagonist

Display type (headlines) uses a serif or distinctive display sans. Body uses a refined sans (Inter, Geist, Satoshi). Headlines are *big* — `text-[clamp(2.5rem,8vw,10rem)]` territory. Letter-spacing is tightened on display (`tracking-tight` or tighter). Line-height is generous on display (`leading-[0.9]` or `leading-none`), tighter on body (`leading-[1.45]`).

**Font pairings that work:**
- Fraunces (display) + Inter (body) — editorial magazine feel
- Canela (display) + Geist (body) — luxury contemporary
- Migra (display) + Manrope (body) — sharp editorial
- Reckless (display) + Inter (body) — soft editorial warmth

Font is loaded via `<link>` in `index.html` or CSS `@import`. Never use system fonts for display.

### 2. Motion is intentional, never decorative

No bouncy springs. No quick `ease-out-200ms` fades. Premium motion uses:
- **Long durations**: 800–1800ms for reveals
- **Refined easing**: `cubic-bezier(0.16, 1, 0.3, 1)` (easeOutExpo), `cubic-bezier(0.22, 1, 0.36, 1)` (easeOutQuint), or custom curves
- **Scroll-driven over page-load**: use `useScroll` + `useTransform` from framer-motion so motion is tied to user action
- **One signature motion per section**: don't stack 5 animations in a hero. Pick the one that amplifies the content.

If an animation doesn't serve the content, remove it.

### 3. Depth through layers, not shadows

Premium depth is created by stacking subtle layers:
- Base: noise texture overlay (CSS or SVG)
- Below content: warm/cool gradient wash (very subtle, 5-15% opacity)
- Mid-layer: decorative element (a large display character, a faded photograph, a grid)
- Foreground: content

Avoid `shadow-lg` / `shadow-2xl` — they read generic. Use `shadow-[0_1px_0_rgba(255,255,255,0.05)]` or gradient borders instead.

### 4. Restraint in color, confidence in composition

The palette is typically:
- **Background**: one warm or cool off-white/off-black (never pure `#000` or `#fff`). Examples: `#0A0908` (warm black), `#F7F5F1` (warm off-white), `#0F1117` (cool black).
- **Text**: high-contrast to bg, but softened. Examples: `#F7F5F1` on `#0A0908`, `#1A1A1A` on `#F7F5F1`.
- **Accent**: ONE color, used sparingly. Examples: `#C8522C` (terracotta), `#4C3F2F` (espresso), `#B8A978` (brass), `#D9C2A4` (champagne).

No rainbow gradients. No teal/purple tech-startup vibes.

### 5. Composition breaks the grid intentionally

Standard 3-column grids feel generic. Premium layouts use:
- **Asymmetry**: 2-column where one column is 2x the other, or 7-column grids with content spanning 3+4
- **Intentional whitespace**: a section with 60% whitespace, content in one corner
- **Scale contrast**: tiny label next to massive headline
- **Overlap**: elements that break out of their container bounds

When in doubt, remove a column or add more whitespace.

---

## What this skill is NOT for

If the user wants:
- Standard B2B SaaS landing page (chat bubbles, product mockups, feature grids) → use `design`
- Admin dashboard / data-dense UI → use `design`
- Mobile app landing with phone mockup → use `design`
- Corporate site with stock-photo hero → use `design`

This skill is for: fashion brands, luxury products, design agencies, creative portfolios, architecture firms, editorial publications, premium SaaS positioning as design-forward.

---

## Workflow — STEP 0: READ THE CATALOG

Before writing any page, READ:
1. `references/design-tokens.md` — colors, typography scale, spacing
2. `references/motion-principles.md` — easing, timing, motion philosophy
3. The matching category `.md` in `references/catalog/` — variants available

Then pick a variant and read its `.tsx` in `references/catalog/components/`.

**Page → Catalog file mapping:**

| Page type | Catalog file(s) |
|---|---|
| Landing / Home | `hero.md` + `features.md` + `testimonials.md` + `cta-sections.md` + `footers.md` |
| Pricing | `pricing.md` |
| About / Studio / Manifesto | `about.md` |
| Contact | `contact.md` |
| Portfolio / Work | `gallery.md` |
| FAQ / Remarks | `faq.md` |
| Navigation (all pages) | `navigation.md` |

**Current catalog inventory — 11 components, all genuinely original:**
- `navigation.md` — 1 variant (Editorial Masthead)
- `hero.md` — 1 variant (Kinetic Mask Hero)
- `features.md` — 1 variant (Editorial Index)
- `stats.md` — 1 variant (Editorial Numbers)
- `logos.md` — 1 variant (Editorial Client Ledger)
- `gallery.md` — 1 variant (Editorial Work Index)
- `about.md` — 1 variant (Editorial Story / Manifesto)
- `testimonials.md` — 1 variant (Editorial Pull Quote)
- `pricing.md` — 1 variant (Editorial Asymmetric)
- `faq.md` — 1 variant (Editorial FAQ / Remarks)
- `cta-sections.md` — 1 variant (Moment CTA)
- `contact.md` — 1 variant (Editorial Contact Form)
- `footers.md` — 1 variant (Editorial Manifesto Footer)

---

## Non-negotiable checklist

Before reporting done:

1. **Foundation read**: `design-tokens.md` + `motion-principles.md` were read BEFORE any code was written.
2. **Catalog consulted**: A specific variant was chosen from the catalog. Name it.
3. **Fonts loaded**: The required display + body fonts are loaded via `<link>` in `index.html` OR CSS `@import`. System fonts break the premium feel.
4. **Single accent color**: The design uses ONE accent color (plus neutrals). No rainbow palettes.
5. **Motion timing**: At least one section uses scroll-driven motion (not just page-load fades). Easing is `easeOutExpo` or similar — not default `easeOut`.
6. **Composition breaks**: At least one section uses asymmetric layout, intentional whitespace, or scale contrast. Not all equal-column grids.
7. **Mobile**: Tested at 375px. Display type scales down but keeps the character (bigger than standard mobile H1).

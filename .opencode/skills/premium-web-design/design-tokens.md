# Premium Design Token System -- Complete Reference

Copy-paste-ready CSS custom properties for premium web design. Use these as the foundation for any premium website.

## Complete Token System

```css
:root {
  /* ===== TYPOGRAPHY ===== */
  --font-heading: 'Playfair Display', Georgia, serif;
  --font-body: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;

  /* Font Sizes (Fluid, Major Third 1.250 scale) */
  --text-xs:   clamp(0.7rem, 0.65rem + 0.2vw, 0.8rem);
  --text-sm:   clamp(0.8rem, 0.76rem + 0.2vw, 0.9rem);
  --text-base: clamp(1rem, 0.95rem + 0.25vw, 1.125rem);
  --text-lg:   clamp(1.125rem, 1.05rem + 0.35vw, 1.406rem);
  --text-xl:   clamp(1.406rem, 1.3rem + 0.5vw, 1.758rem);
  --text-2xl:  clamp(1.758rem, 1.55rem + 0.95vw, 2.197rem);
  --text-3xl:  clamp(2.197rem, 1.85rem + 1.5vw, 2.747rem);
  --text-4xl:  clamp(2.747rem, 2.2rem + 2.5vw, 3.433rem);
  --text-5xl:  clamp(3.433rem, 2.5rem + 4vw, 4.768rem);

  /* Line Heights */
  --leading-none: 1; --leading-tight: 1.15; --leading-snug: 1.3;
  --leading-normal: 1.5; --leading-relaxed: 1.625; --leading-loose: 1.8;

  /* Letter Spacing */
  --tracking-tighter: -0.03em; --tracking-tight: -0.015em; --tracking-normal: 0;
  --tracking-wide: 0.05em; --tracking-wider: 0.1em; --tracking-widest: 0.15em;

  /* Font Weights */
  --weight-light: 300; --weight-regular: 400; --weight-medium: 500;
  --weight-semibold: 600; --weight-bold: 700;

  /* ===== SPACING (8px Grid) ===== */
  --space-1: 0.25rem; --space-2: 0.5rem; --space-3: 0.75rem;
  --space-4: 1rem; --space-5: 1.25rem; --space-6: 1.5rem;
  --space-8: 2rem; --space-10: 2.5rem; --space-12: 3rem;
  --space-16: 4rem; --space-20: 5rem; --space-24: 6rem;
  --space-32: 8rem; --space-40: 10rem;

  /* Section Spacing (fluid) */
  --section-sm: clamp(3rem, 6vw, 5rem);
  --section-md: clamp(5rem, 10vw, 7.5rem);
  --section-lg: clamp(7.5rem, 14vw, 12.5rem);

  /* ===== LAYOUT ===== */
  --container-sm: 640px; --container-md: 768px; --container-lg: 1024px;
  --container-xl: 1200px; --container-2xl: 1440px; --container-text: 70ch;
  --grid-gap: clamp(1rem, 2vw, 2rem);

  /* ===== COLORS -- Warm Premium Palette ===== */
  --color-white: #FFFFFF; --color-ivory: #F9F6F4; --color-pearl: #F5F0E6;
  --color-warm-100: #EFEAE5; --color-warm-200: #D9D0C1;
  --color-warm-300: #C6BDB5; --color-warm-400: #B8ADA0;
  --color-stone: #998B7E; --color-charcoal: #2F2F2F;
  --color-near-black: #1A1A1A; --color-gold: #D4AF37;

  /* ===== COLORS -- Cool Modern Palette ===== */
  --color-snow: #FAFAFA; --color-light-grey: #F5F5F5;
  --color-mid-grey: #E5E5E5; --color-slate: #6B7078;
  --color-dark-slate: #2E3136;

  /* ===== DARK MODE SURFACES ===== */
  --dark-surface-0: #121212; --dark-surface-1: #1E1E1E;
  --dark-surface-2: #242424; --dark-surface-3: #2C2C2C;
  --dark-surface-4: #333333;
  --dark-text-primary: #E0E0E0; --dark-text-secondary: #A0A0A0;
  --dark-text-muted: #6E6E6E;

  /* ===== BORDER RADIUS ===== */
  --radius-sm: 4px; --radius-md: 8px; --radius-lg: 12px;
  --radius-xl: 16px; --radius-2xl: 24px; --radius-full: 9999px;

  /* ===== SHADOWS (Layered, never plain black) ===== */
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.1);
  --shadow-md: 0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.06);
  --shadow-lg: 0 10px 15px rgba(0,0,0,0.1), 0 4px 6px rgba(0,0,0,0.05);
  --shadow-xl: 0 20px 25px rgba(0,0,0,0.1), 0 8px 10px rgba(0,0,0,0.04);
  --shadow-dreamy: 0 2px 4px rgba(0,0,0,0.07), 0 8px 16px rgba(0,0,0,0.07),
                   0 16px 32px rgba(0,0,0,0.07), 0 32px 64px rgba(0,0,0,0.07);

  /* ===== TRANSITIONS ===== */
  --transition-fast: 150ms ease; --transition-base: 200ms ease;
  --transition-slow: 300ms ease-in-out;
  --transition-enter: 200ms ease-out; --transition-exit: 150ms ease-in;

  /* ===== EASING CURVES ===== */
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);
  --ease-out-cubic: cubic-bezier(0.33, 1, 0.68, 1);
  --ease-in-out-expo: cubic-bezier(0.87, 0, 0.13, 1);
  --ease-out-back: cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

## Heading Sizes Quick Reference

| Level | Desktop | Mobile | Line-Height | Letter-Spacing |
|-------|---------|--------|-------------|----------------|
| H1 | 48-64px | 32-40px | 1.1-1.15 | -0.02em |
| H2 | 36-48px | 28-32px | 1.2-1.3 | -0.01em |
| H3 | 28-32px | 22-26px | 1.2-1.4 | normal |
| H4 | 22-26px | 18-20px | 1.3-1.4 | normal |
| Body | 16-18px | 16px | 1.5-1.8 | normal |
| UPPERCASE | -- | -- | -- | 0.05-0.15em |

## Premium Font Pairings by Genre

Choose based on project genre. **NEVER default to the first row for every project** -- that is an AI tell.

| Genre | Heading | Body | Best For |
|-------|---------|------|----------|
| **Elegant editorial** | Playfair Display | Inter | Fashion, wine, luxury goods |
| **Refined luxury** | Cormorant Garamond | DM Sans | Jewelry, hospitality, spa |
| **Modern warmth** | DM Serif Display | DM Sans | Food, lifestyle, wellness |
| **Clean tech** | Inter (600-700) | Inter (400) | SaaS, developer tools |
| **Bold authority** | Space Grotesk | Inter | Fintech, enterprise, B2B |
| **Swiss minimal** | Neue Montreal / Geist Sans | System UI stack | Portfolios, agencies, studios |
| **Editorial modern** | Sora | Source Serif 4 | Magazines, blogs, media |
| **Playful premium** | Cabinet Grotesk | General Sans | Consumer apps, startups |
| **Dark luxury** | Bebas Neue (caps only) | Manrope | Automotive, nightlife, audio |
| **Classic authority** | EB Garamond | Lato | Legal, finance, education |

### Font Selection Rule
1. Identify the project's genre from the table above
2. Use the recommended pairing OR one from an adjacent genre
3. For dark themes, prefer geometric sans-serifs (Space Grotesk, Geist, Inter) over serifs
4. For editorial/luxury, serif headings create authority that sans-serif cannot match

## Container & Grid

```css
.container { max-width: 1200px; margin-inline: auto; padding-inline: clamp(1rem, 5vw, 3rem); }
.container--wide { max-width: 1440px; }
.container--text { max-width: 70ch; }

.auto-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 30ch), 1fr));
  gap: var(--grid-gap);
}
```

## Section Spacing Reference

| Section Type | Desktop Padding | Mobile Padding |
|-------------|----------------|----------------|
| Hero | 120-200px | 80-120px |
| Standard content | 80-120px | 60-80px |
| CTA section | 60-100px | 48-64px |
| Footer | 60-80px | 48-60px |

## Premium Gradient Examples

```css
/* Warm premium background */
background: linear-gradient(135deg, #F9F6F4 0%, #EFEAE5 50%, #F5F0E6 100%);

/* Dark mode atmospheric */
background: linear-gradient(180deg, #121212 0%, #1A1A2E 50%, #16213E 100%);

/* Stripe-inspired mesh gradient -- USE ONLY for brand-specific projects with purple identity.
   WARNING: Purple mesh gradients are the #1 AI tell of 2024-2026. Do NOT use as a default. */
background: radial-gradient(at 20% 80%, rgba(76,110,245,0.15) 0%, transparent 50%),
            radial-gradient(at 80% 20%, rgba(159,122,234,0.12) 0%, transparent 50%),
            #0A0A0F;
```

## Neutral Color Anchors

| Name | Hex | Use |
|------|-----|-----|
| Snow | #FAFAFA | Subtle off-white background |
| Ivory | #F9F6F4 | Warm premium background |
| Pearl | #F5F0E6 | Luxury warm white |
| Warm Grey | #B8ADA0 | Supporting text, borders |
| Charcoal | #2F2F2F | Primary dark (luxury alternative) |
| Near Black | #1A1A1A | Rich dark background |

## Design Style Palettes

Choose based on brand personality. **NEVER default to Warm Premium for every project.**

### Warm Premium (Approachable Luxury)
```css
--bg-primary: #F9F6F4; --bg-secondary: #F5F0E6; --bg-card: #FFFFFF;
--text-primary: #2F2F2F; --text-secondary: #998B7E;
--accent: #D4AF37; --shadow-tint: rgba(153,139,126,0.12);
/* Best for: Luxury goods, hospitality, fashion, beauty */
```

### Cool Tech (Precise, Modern)
```css
/* Light mode */
--bg-primary: #FAFAFA; --bg-secondary: #F5F5F5; --bg-card: #FFFFFF;
--text-primary: #171717; --text-secondary: #525252;
--accent: #0066FF; --border: #E5E5E5;
/* Dark mode */
--bg-primary: #0A0A0F; --bg-secondary: #141414; --bg-card: #1A1A1A;
--text-primary: #EDEDED; --text-secondary: #A0A0A0;
--accent: #3B82F6; --border: #2A2A2A;
/* Best for: SaaS, developer tools, fintech, analytics */
```

### Bold Dark (Confident, Dramatic)
```css
--bg-primary: #0A0A0A; --bg-secondary: #111111; --bg-card: #1A1A1A;
--text-primary: #F5F5F5; --text-secondary: #888888;
--accent: #FF3B30; --border: #222222;
/* Cards: no shadow, 1px solid var(--border). White-as-accent works here. */
/* Best for: Automotive, audio, gaming, sports */
```

### Minimal Editorial (Restrained, Intellectual)
```css
--bg-primary: #FFFFFF; --bg-secondary: #F7F7F5; --bg-card: transparent;
--text-primary: #1A1A1A; --text-secondary: #666666;
--accent: #1A1A1A; --accent-warm: #C5A572;
/* Cards: no background, separated by hairline rules (1px #E0E0E0) */
/* Best for: Beauty (Aesop-style), architecture, editorial, portfolio */
```

### Colorful Modern (Energetic, Approachable)
```css
--bg-primary: #FFFFFF; --bg-secondary: #F6F9FC; --bg-card: #FFFFFF;
--text-primary: #0A2540; --text-secondary: #425466;
--accent: /* brand-primary vibrant -- e.g., Stripe #635BFF, Figma #A259FF */;
/* Cards: white with colored left-border or top-border accent */
/* Best for: Creative tools, marketplaces, consumer platforms */
```

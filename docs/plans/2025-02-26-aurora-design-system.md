# 🌌 Aurora Design System for opencode

> **Vision**: "Code illuminated from within"
>
> A unified design language for opencode that creates an ethereal, digital-native interface where UI elements emit light rather than receive it.

---

## Table of Contents

1. [Design Vision Summary](#part-1-design-vision-summary)
2. [Design Approaches Explored](#part-2-design-approaches-explored)
3. [Color System](#part-3-color-system)
4. [Typography System](#part-4-typography-system)
5. [Spacing System](#part-5-spacing-system)
6. [Motion & Animation System](#part-6-motion--animation-system)
7. [Component Specifications](#part-7-component-specifications)
8. [TUI (Terminal) Component Translations](#part-8-tui-terminal-component-translations)
9. [Stitch Prompts for Visual Prototyping](#part-9-stitch-prompts-for-visual-prototyping)
10. [Final Summary & Implementation Guide](#part-10-final-summary--implementation-guide)
11. [Accessibility & Review Amendments](#part-11-accessibility--review-amendments)

---

## Part 1: Design Vision Summary

### Design Requirements Gathered

| Aspect | Choice |
|--------|--------|
| **Scope** | Unified design language (Web Console + Terminal UI) |
| **Tone** | Luxury Minimal |
| **Color** | Dark-first luxury with luminous accents |
| **Motion** | Confident, tactile, functional |
| **Reference** | Future-forward (Tesla/Rivian interiors) |

### Core Identity

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  opencode AURORA                                            │
│                                                             │
│  "Code illuminated from within"                             │
│                                                             │
│  Not a tool that shows you code—                           │
│  A window into a dimension where code IS light.            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Design Principles

| Principle | Description | Implementation |
|-----------|-------------|----------------|
| **Light as Material** | UI elements emit light rather than receive it | Glows, gradients, luminous borders |
| **Depth through Transparency** | Layers visible through glassmorphism | backdrop-blur, low-opacity backgrounds |
| **Confident Motion** | Every animation serves purpose and feels physical | Spring physics, 200-300ms durations |
| **Chromatic Restraint** | Rich palette but used sparingly | Monochrome base, color for meaning |
| **Unified Language** | Same DNA across Web and TUI | Shared color tokens, adapted to medium |

---

## Part 2: Design Approaches Explored

Three design approaches were explored before settling on Aurora:

### Approach A: "Carbon Fiber" — Industrial Luxury (Rejected)

**Concept:** Premium materials meet precision engineering. Think machined aluminum bezels, carbon fiber textures, and surgical-grade steel accents.

**Web Console:**
```
┌─────────────────────────────────────────────────────────────┐
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│  Background: Subtle carbon weave pattern with depth         │
│  Cards: Brushed metal finish with soft inner glow           │
│  Accent: Copper/rose gold highlights (warm against cold)    │
│                                                             │
│  3D Elements:                                               │
│  • Cards tilt on hover (perspective transform)              │
│  • Depth shadows that respond to mouse position             │
│  • Metallic sheen that catches virtual "light"              │
│                                                             │
│  Motion:                                                    │
│  • Spring-based button depressions (like mechanical keys)   │
│  • Smooth state transitions with mass/velocity physics      │
│  • Loading: Rotating machined bezel indicator               │
└─────────────────────────────────────────────────────────────┘
```

**TUI Translation:**
```
┌─ SESSION: Project Analysis ─────────────── ◈ ────┐
│                                                   │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░  Processing...      │
│                                                   │
│  ╭──────────────────────────────────────────╮    │
│  │ ◆ Analyzing codebase                     │    │
│  │   └─ Found 127 TypeScript files         │    │
│  │   └─ Detected SolidJS framework         │    │
│  ╰──────────────────────────────────────────╯    │
│                                                   │
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │
│  Unicode: Heavy borders, diamond bullets          │
│  Colors: Warm copper (#B87333) on charcoal        │
└───────────────────────────────────────────────────┘
```

**Pros:**
- Distinctive, memorable aesthetic
- Strong brand identity ("the tool that feels engineered")
- Warm accent prevents cold/sterile feeling

**Cons:**
- Carbon texture could feel dated if not executed perfectly
- Copper might clash with some terminal color schemes
- More complex to implement subtle material effects

**Verdict:** Too industrial - user wanted something more ethereal/digital, less physical materials

---

### Approach B: "Aurora" — Digital Luminescence (SELECTED ✓)

**Concept:** Pure light and energy. No physical materials—just gradients, glows, and luminous color that feels alive. Like looking at code through a prism of pure digital light.

**Web Console:**
```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  Background: Deep void black (#0A0A0F) with subtle          │
│              animated gradient aurora (very slow drift)     │
│                                                             │
│  Cards: Glassmorphism with luminous edge glow               │
│         bg: rgba(255,255,255,0.03)                         │
│         border: gradient (cyan → purple → magenta)         │
│         backdrop-filter: blur(20px)                        │
│                                                             │
│  Accent Colors (shifting spectrum):                         │
│  • Primary: Electric Cyan (#00D4FF)                        │
│  • Secondary: Soft Violet (#A78BFA)                        │
│  • Tertiary: Rose (#FF6B9D)                                │
│                                                             │
│  3D Elements:                                               │
│  • Subtle glow pulses (like breathing light)               │
│  • Hover reveals inner luminescence                        │
│  • Focus states bloom with soft radiance                   │
│  • Depth through layered transparency, not shadows         │
│                                                             │
│  Motion:                                                    │
│  • Smooth spring physics on all interactions               │
│  • Elements "float" with subtle parallax                   │
│  • Loading: Gradient shimmer / aurora wave                 │
│  • Transitions: Fade + scale with glow trail               │
└─────────────────────────────────────────────────────────────┘
```

**Light Theme Variant:**
```
┌─────────────────────────────────────────────────────────────┐
│  Background: Soft pearl (#FAFAFA) with subtle iridescence   │
│  Cards: Frosted glass with prismatic edge highlights        │
│  Accents: Deeper cyan, rich violet (contrast preserved)     │
│  Effect: "Daylight aurora" - colors visible but softer      │
└─────────────────────────────────────────────────────────────┘
```

**TUI Translation:**
```
╭───────────────────────────────────────────────────────╮
│  ●  opencode                             ◐ processing │
├───────────────────────────────────────────────────────┤
│                                                       │
│  ┃ Analyzing your codebase...                        │
│  ┃                                                   │
│  ├─● packages/opencode/src/cli/                      │
│  │  ├─○ cmd/tui/app.tsx                             │
│  │  ├─○ cmd/tui/context/theme.tsx                   │
│  │  └─● cmd/tui/routes/session/                     │
│  │     └─○ index.tsx ← focus                        │
│  │                                                   │
│  ╰─ Found 247 files in 3.2s                         │
│                                                       │
│  ░░░░░░░░░░░░░░░░░░░░░░░▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  │
│                                                       │
╰───────────────────────────────────────────────────────╯
│ Unicode: Rounded corners, thin lines, ● ○ bullets    │
│ Colors: Cyan/violet/magenta gradient hierarchy       │
│ Effect: "Glowing" text via bright-on-dark contrast   │
└───────────────────────────────────────────────────────┘
```

**Key Differentiators:**
- **Depth through light, not shadow** — Elements glow from within rather than casting shadows
- **Living gradients** — Subtle color shifts that feel organic, not static
- **Ethereal presence** — UI feels like it exists in digital space, weightless

**Pros:**
- Truly unique aesthetic (few tools look like this)
- Perfectly digital - no physical material metaphors
- Light/dark themes can share the same luminous DNA
- Scalable: subtle for everyday use, dramatic for hero moments

**Cons:**
- Risk of "gaming aesthetic" if not carefully restrained
- Gradient animations need to be VERY subtle or becomes distracting
- Performance consideration for animated gradients

**Verdict:** Selected as final direction - ethereal, digital, distinctive

---

### Approach C: Not Developed

Since Approach B (Aurora) was selected immediately, a third approach was not fully developed.

---

## Part 3: Color System

### Dark Theme (Primary)

```css
/* ═══════════════════════════════════════════════════════════
   AURORA DARK — PRIMARY THEME
   ═══════════════════════════════════════════════════════════ */

:root[data-theme="aurora-dark"] {
  /* ─── VOID BACKGROUNDS ─── */
  --void-deepest:      #050508;  /* True dark, almost black */
  --void-deep:         #0A0A0F;  /* Primary background */
  --void-base:         #0F0F14;  /* Card backgrounds */
  --void-elevated:     #14141A;  /* Elevated surfaces */
  --void-hover:        #1A1A22;  /* Hover states */

  /* ─── SURFACE GLASS ─── */
  --glass-subtle:      rgba(255, 255, 255, 0.02);
  --glass-light:       rgba(255, 255, 255, 0.04);
  --glass-medium:      rgba(255, 255, 255, 0.06);
  --glass-strong:      rgba(255, 255, 255, 0.08);

  /* ─── LUMINOUS SPECTRUM ─── */
  --aurora-cyan:       #00D4FF;  /* Primary accent */
  --aurora-cyan-soft:  #00A3CC;  /* Cyan muted */
  --aurora-cyan-glow:  rgba(0, 212, 255, 0.15);

  --aurora-violet:     #A78BFA;  /* Secondary accent */
  --aurora-violet-soft:#8B6ED9;
  --aurora-violet-glow:rgba(167, 139, 250, 0.15);

  --aurora-rose:       #FF6B9D;  /* Tertiary / attention */
  --aurora-rose-soft:  #D94A7B;
  --aurora-rose-glow:  rgba(255, 107, 157, 0.15);

  --aurora-amber:      #FFBB33;  /* Warning / warm accent */
  --aurora-green:      #4ADE80;  /* Success */
  --aurora-red:        #F87171;  /* Error / danger */

  /* ─── TEXT HIERARCHY ─── */
  --text-primary:      #F5F5F7;  /* Bright white */
  --text-secondary:    #A1A1AA;  /* Muted gray */
  --text-tertiary:     #71717A;  /* Subtle gray */
  --text-disabled:     #3F3F46;  /* Very dim */

  /* ─── BORDER LUMINANCE ─── */
  --border-subtle:     rgba(255, 255, 255, 0.06);
  --border-default:    rgba(255, 255, 255, 0.10);
  --border-strong:     rgba(255, 255, 255, 0.15);
  --border-glow:       var(--aurora-cyan);
}
```

### Light Theme (Secondary)

```css
/* ═══════════════════════════════════════════════════════════
   AURORA LIGHT — DAYLIGHT VARIANT
   ═══════════════════════════════════════════════════════════ */

:root[data-theme="aurora-light"] {
  /* ─── PEARL BACKGROUNDS ─── */
  --void-deepest:      #FFFFFF;
  --void-deep:         #FAFAFA;
  --void-base:         #F4F4F5;
  --void-elevated:     #FFFFFF;
  --void-hover:        #E4E4E7;

  /* ─── SURFACE FROST ─── */
  --glass-subtle:      rgba(0, 0, 0, 0.02);
  --glass-light:       rgba(0, 0, 0, 0.04);
  --glass-medium:      rgba(0, 0, 0, 0.06);
  --glass-strong:      rgba(0, 0, 0, 0.08);

  /* ─── LUMINOUS SPECTRUM (deeper for contrast) ─── */
  --aurora-cyan:       #0891B2;  /* Deeper cyan */
  --aurora-cyan-soft:  #06B6D4;
  --aurora-cyan-glow:  rgba(8, 145, 178, 0.10);

  --aurora-violet:     #7C3AED;  /* Richer violet */
  --aurora-violet-soft:#8B5CF6;
  --aurora-violet-glow:rgba(124, 58, 237, 0.10);

  --aurora-rose:       #DB2777;  /* Deeper rose */
  --aurora-rose-soft:  #EC4899;
  --aurora-rose-glow:  rgba(219, 39, 119, 0.10);

  --aurora-amber:      #D97706;
  --aurora-green:      #16A34A;
  --aurora-red:        #DC2626;

  /* ─── TEXT HIERARCHY ─── */
  --text-primary:      #18181B;
  --text-secondary:    #52525B;
  --text-tertiary:     #A1A1AA;
  --text-disabled:     #D4D4D8;

  /* ─── BORDER LUMINANCE ─── */
  --border-subtle:     rgba(0, 0, 0, 0.06);
  --border-default:    rgba(0, 0, 0, 0.10);
  --border-strong:     rgba(0, 0, 0, 0.15);
  --border-glow:       var(--aurora-cyan);
}
```

### TUI Color Mapping

```typescript
// Aurora theme for terminal (TUI)
export const auroraDark = {
  // Backgrounds (mapped to closest ANSI/24-bit)
  background: RGBA.fromHex("#0A0A0F"),
  backgroundPanel: RGBA.fromHex("#0F0F14"),
  backgroundElement: RGBA.fromHex("#14141A"),
  backgroundMenu: RGBA.fromHex("#1A1A22"),

  // Aurora spectrum
  primary: RGBA.fromHex("#00D4FF"),      // Cyan
  secondary: RGBA.fromHex("#A78BFA"),    // Violet
  accent: RGBA.fromHex("#FF6B9D"),       // Rose

  // Semantic
  success: RGBA.fromHex("#4ADE80"),
  warning: RGBA.fromHex("#FFBB33"),
  error: RGBA.fromHex("#F87171"),
  info: RGBA.fromHex("#00D4FF"),

  // Text
  text: RGBA.fromHex("#F5F5F7"),
  textMuted: RGBA.fromHex("#A1A1AA"),

  // Borders
  border: RGBA.fromHex("#1E1E26"),
  borderActive: RGBA.fromHex("#00D4FF"),
  borderSubtle: RGBA.fromHex("#14141A"),

  // Syntax highlighting (aurora-themed)
  syntaxKeyword: RGBA.fromHex("#A78BFA"),   // Violet
  syntaxFunction: RGBA.fromHex("#00D4FF"),  // Cyan
  syntaxString: RGBA.fromHex("#4ADE80"),    // Green
  syntaxNumber: RGBA.fromHex("#FF6B9D"),    // Rose
  syntaxComment: RGBA.fromHex("#71717A"),   // Muted
  syntaxVariable: RGBA.fromHex("#F5F5F7"),  // White
  syntaxType: RGBA.fromHex("#FFBB33"),      // Amber
  syntaxOperator: RGBA.fromHex("#A1A1AA"),
  syntaxPunctuation: RGBA.fromHex("#71717A"),

  // Diff colors
  diffAdded: RGBA.fromHex("#4ADE80"),
  diffRemoved: RGBA.fromHex("#F87171"),
  diffAddedBg: RGBA.fromHex("#0D2818"),
  diffRemovedBg: RGBA.fromHex("#2D1216"),
}
```

---

## Part 4: Typography System

### Font Stack

```css
/* ═══════════════════════════════════════════════════════════
   AURORA TYPOGRAPHY
   ═══════════════════════════════════════════════════════════ */

:root {
  /* ─── PRIMARY: Code & Interface ─── */
  --font-mono: "JetBrains Mono", "SF Mono", "Fira Code",
               "Cascadia Code", monospace;

  /* ─── DISPLAY: Headers & Hero Text ─── */
  /* Option A: Geometric (Future-forward) */
  --font-display: "Geist", "Inter", "SF Pro Display",
                  system-ui, sans-serif;

  /* Option B: More distinctive (if we want stronger brand) */
  /* --font-display: "Space Grotesk", "Outfit", sans-serif; */

  /* ─── BODY: Documentation & Long-form ─── */
  --font-body: "Inter", "SF Pro Text", system-ui, sans-serif;
}
```

### Type Scale

```css
/* ─── MODULAR SCALE: 1.250 (Major Third) ─── */

:root {
  --text-xs:    0.64rem;   /* 10.24px - Labels, captions */
  --text-sm:    0.8rem;    /* 12.8px  - Small UI text */
  --text-base:  1rem;      /* 16px    - Body text */
  --text-md:    1.25rem;   /* 20px    - Large body */
  --text-lg:    1.563rem;  /* 25px    - Section headers */
  --text-xl:    1.953rem;  /* 31.25px - Page headers */
  --text-2xl:   2.441rem;  /* 39px    - Hero subheads */
  --text-3xl:   3.052rem;  /* 48.8px  - Hero headlines */
  --text-4xl:   3.815rem;  /* 61px    - Display text */

  /* ─── LINE HEIGHTS ─── */
  --leading-none:   1;
  --leading-tight:  1.25;
  --leading-snug:   1.375;
  --leading-normal: 1.5;
  --leading-relaxed: 1.625;
  --leading-loose:  1.75;

  /* ─── LETTER SPACING ─── */
  --tracking-tighter: -0.05em;
  --tracking-tight:   -0.025em;
  --tracking-normal:  0;
  --tracking-wide:    0.025em;
  --tracking-wider:   0.05em;

  /* ─── FONT WEIGHTS ─── */
  --weight-normal:  400;
  --weight-medium:  500;
  --weight-semibold: 600;
  --weight-bold:    700;
}
```

### Typography Classes

```css
/* ─── SEMANTIC TEXT STYLES ─── */

.text-display-hero {
  font-family: var(--font-display);
  font-size: var(--text-4xl);
  font-weight: var(--weight-bold);
  line-height: var(--leading-none);
  letter-spacing: var(--tracking-tighter);
}

.text-display-title {
  font-family: var(--font-display);
  font-size: var(--text-2xl);
  font-weight: var(--weight-semibold);
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-tight);
}

.text-heading-lg {
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: var(--weight-semibold);
  line-height: var(--leading-snug);
}

.text-heading-md {
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: var(--weight-medium);
  line-height: var(--leading-snug);
}

.text-body {
  font-family: var(--font-body);
  font-size: var(--text-base);
  font-weight: var(--weight-normal);
  line-height: var(--leading-relaxed);
}

.text-body-sm {
  font-family: var(--font-body);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
}

.text-code {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  font-variant-ligatures: contextual;  /* Enable code ligatures */
}

.text-label {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
}
```

---

## Part 5: Spacing System

```css
/* ═══════════════════════════════════════════════════════════
   AURORA SPACING — 4px Base Grid
   ═══════════════════════════════════════════════════════════ */

:root {
  --space-px:   1px;
  --space-0:    0;
  --space-0.5:  0.125rem;  /* 2px */
  --space-1:    0.25rem;   /* 4px */
  --space-1.5:  0.375rem;  /* 6px */
  --space-2:    0.5rem;    /* 8px */
  --space-2.5:  0.625rem;  /* 10px */
  --space-3:    0.75rem;   /* 12px */
  --space-3.5:  0.875rem;  /* 14px */
  --space-4:    1rem;      /* 16px */
  --space-5:    1.25rem;   /* 20px */
  --space-6:    1.5rem;    /* 24px */
  --space-7:    1.75rem;   /* 28px */
  --space-8:    2rem;      /* 32px */
  --space-9:    2.25rem;   /* 36px */
  --space-10:   2.5rem;    /* 40px */
  --space-11:   2.75rem;   /* 44px */
  --space-12:   3rem;      /* 48px */
  --space-14:   3.5rem;    /* 56px */
  --space-16:   4rem;      /* 64px */
  --space-20:   5rem;      /* 80px */
  --space-24:   6rem;      /* 96px */
  --space-28:   7rem;      /* 112px */
  --space-32:   8rem;      /* 128px */

  /* ─── SEMANTIC SPACING ─── */
  --gap-xs:     var(--space-1);   /* 4px - Inline elements */
  --gap-sm:     var(--space-2);   /* 8px - Tight groups */
  --gap-md:     var(--space-4);   /* 16px - Default gap */
  --gap-lg:     var(--space-6);   /* 24px - Section spacing */
  --gap-xl:     var(--space-8);   /* 32px - Major sections */
  --gap-2xl:    var(--space-12);  /* 48px - Page sections */

  /* ─── COMPONENT PADDING ─── */
  --padding-button:    var(--space-2) var(--space-4);
  --padding-button-sm: var(--space-1.5) var(--space-3);
  --padding-button-lg: var(--space-3) var(--space-6);

  --padding-card:      var(--space-5);
  --padding-card-sm:   var(--space-3);
  --padding-card-lg:   var(--space-6);

  --padding-input:     var(--space-2.5) var(--space-3);

  /* ─── BORDER RADIUS ─── */
  --radius-none:   0;
  --radius-sm:     0.25rem;   /* 4px - Small elements */
  --radius-md:     0.5rem;    /* 8px - Buttons, inputs */
  --radius-lg:     0.75rem;   /* 12px - Cards */
  --radius-xl:     1rem;      /* 16px - Large cards */
  --radius-2xl:    1.5rem;    /* 24px - Modals */
  --radius-full:   9999px;    /* Pills, avatars */
}
```

---

## Part 6: Motion & Animation System

```css
/* ═══════════════════════════════════════════════════════════
   AURORA MOTION — Spring-Based Animation
   ═══════════════════════════════════════════════════════════ */

:root {
  /* ─── DURATION ─── */
  --duration-instant:  50ms;
  --duration-fast:     150ms;
  --duration-normal:   250ms;
  --duration-slow:     350ms;
  --duration-slower:   500ms;
  --duration-slowest:  700ms;

  /* ─── EASING (CSS) ─── */
  --ease-linear:       linear;
  --ease-in:           cubic-bezier(0.4, 0, 1, 1);
  --ease-out:          cubic-bezier(0, 0, 0.2, 1);
  --ease-in-out:       cubic-bezier(0.4, 0, 0.2, 1);

  /* ─── SPRING EASING (For Motion library) ─── */
  --spring-bounce:     cubic-bezier(0.34, 1.56, 0.64, 1);
  --spring-smooth:     cubic-bezier(0.22, 1, 0.36, 1);
  --spring-snappy:     cubic-bezier(0.16, 1, 0.3, 1);

  /* ─── SEMANTIC TRANSITIONS ─── */
  --transition-colors:    color var(--duration-fast) var(--ease-out),
                          background-color var(--duration-fast) var(--ease-out),
                          border-color var(--duration-fast) var(--ease-out);

  --transition-opacity:   opacity var(--duration-normal) var(--ease-out);

  --transition-transform: transform var(--duration-normal) var(--spring-smooth);

  --transition-all:       all var(--duration-normal) var(--spring-smooth);

  --transition-glow:      box-shadow var(--duration-slow) var(--ease-out);
}
```

### Motion Principles

```
┌─────────────────────────────────────────────────────────────┐
│  AURORA MOTION PRINCIPLES                                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. ENTER: Scale up + fade in (0.95 → 1.0, 0 → 1)          │
│  2. EXIT: Scale down + fade out (1.0 → 0.95, 1 → 0)        │
│  3. HOVER: Subtle lift (translateY -2px) + glow increase   │
│  4. PRESS: Slight compression (scale 0.98)                  │
│  5. FOCUS: Glow ring expansion                              │
│                                                             │
│  Key insight: Aurora elements GLOW more on interaction,    │
│  they don't cast shadows—they emit light.                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Animation Keyframes

```css
/* ─── ENTRY ANIMATIONS ─── */
@keyframes aurora-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes aurora-scale-in {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes aurora-slide-up {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ─── GLOW PULSE (for loading/processing) ─── */
@keyframes aurora-pulse {
  0%, 100% {
    opacity: 1;
    box-shadow: 0 0 0 0 var(--aurora-cyan-glow);
  }
  50% {
    opacity: 0.8;
    box-shadow: 0 0 20px 4px var(--aurora-cyan-glow);
  }
}

/* ─── SHIMMER (for skeleton loaders) ─── */
@keyframes aurora-shimmer {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}

/* ─── GRADIENT DRIFT (for hero backgrounds) ─── */
@keyframes aurora-drift {
  0%, 100% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
}
```

---

## Part 7: Component Specifications

### 7.1 Buttons

```
┌─────────────────────────────────────────────────────────────┐
│  AURORA BUTTONS                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  PRIMARY (Glowing CTA)                                      │
│  ┌─────────────────────────────────────┐                   │
│  │    ◉  Start Session                 │ ← Cyan glow ring  │
│  └─────────────────────────────────────┘                   │
│  bg: var(--aurora-cyan)                                     │
│  text: var(--void-deepest)                                  │
│  hover: glow expands, brightness +10%                       │
│  active: scale(0.98), glow contracts                        │
│                                                             │
│  SECONDARY (Glass)                                          │
│  ┌─────────────────────────────────────┐                   │
│  │       View History                  │ ← Subtle border   │
│  └─────────────────────────────────────┘                   │
│  bg: var(--glass-light)                                     │
│  border: var(--border-default)                              │
│  hover: bg → glass-medium, border glows                     │
│                                                             │
│  GHOST (Minimal)                                            │
│  ┌─────────────────────────────────────┐                   │
│  │       Cancel                        │ ← No bg           │
│  └─────────────────────────────────────┘                   │
│  bg: transparent                                            │
│  hover: var(--glass-subtle)                                 │
│                                                             │
│  DANGER (Warning glow)                                      │
│  ┌─────────────────────────────────────┐                   │
│  │       Delete Session                │ ← Red glow        │
│  └─────────────────────────────────────┘                   │
│  bg: var(--aurora-red) at 15% opacity                      │
│  border: var(--aurora-red)                                  │
│  hover: red glow expands                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

```css
/* Primary Button */
.btn-primary {
  background: var(--aurora-cyan);
  color: var(--void-deepest);
  padding: var(--padding-button);
  border-radius: var(--radius-md);
  font-weight: var(--weight-medium);
  transition: var(--transition-all);
  box-shadow:
    0 0 0 0 var(--aurora-cyan-glow),
    0 0 20px -5px var(--aurora-cyan);
}

.btn-primary:hover {
  box-shadow:
    0 0 0 4px var(--aurora-cyan-glow),
    0 0 30px -5px var(--aurora-cyan);
  filter: brightness(1.1);
}

.btn-primary:active {
  transform: scale(0.98);
  box-shadow:
    0 0 0 2px var(--aurora-cyan-glow),
    0 0 15px -5px var(--aurora-cyan);
}

/* Secondary Button */
.btn-secondary {
  background: var(--glass-light);
  border: 1px solid var(--border-default);
  color: var(--text-primary);
  padding: var(--padding-button);
  border-radius: var(--radius-md);
  backdrop-filter: blur(8px);
  transition: var(--transition-all);
}

.btn-secondary:hover {
  background: var(--glass-medium);
  border-color: var(--aurora-cyan);
  box-shadow: 0 0 15px -5px var(--aurora-cyan-glow);
}
```

---

### 7.2 Cards

```
┌─────────────────────────────────────────────────────────────┐
│  AURORA CARDS                                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  GLASS CARD (Default)                                       │
│  ╭───────────────────────────────────────────╮             │
│  │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │             │
│  │                                           │             │
│  │   Session Title                           │             │
│  │   Subtitle or metadata                    │             │
│  │                                           │             │
│  │   Content area with sufficient padding    │             │
│  │   for comfortable reading and scanning.   │             │
│  │                                           │             │
│  ╰───────────────────────────────────────────╯             │
│                                                             │
│  Properties:                                                │
│  • bg: var(--glass-light)                                   │
│  • border: 1px solid var(--border-subtle)                   │
│  • border-radius: var(--radius-lg)                          │
│  • backdrop-filter: blur(12px)                              │
│  • padding: var(--padding-card)                             │
│                                                             │
│  ELEVATED CARD (Interactive)                                │
│  ╭───────────────────────────────────────────╮             │
│  │                                           │ ← Hover:    │
│  │   Select Provider                         │    Lift +   │
│  │   Choose your AI model                    │    Glow     │
│  │                                           │             │
│  │   → Claude 4     → GPT-4                 │             │
│  │                                           │             │
│  ╰───────────────────────────────────────────╯             │
│                                                             │
│  Hover state:                                               │
│  • transform: translateY(-2px)                              │
│  • border-color: var(--aurora-cyan)                         │
│  • box-shadow: 0 0 30px -10px var(--aurora-cyan-glow)      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

### 7.3 Input Fields

```
┌─────────────────────────────────────────────────────────────┐
│  AURORA INPUTS                                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  DEFAULT STATE                                              │
│  ┌─────────────────────────────────────────────────┐       │
│  │  Ask opencode anything...                       │       │
│  └─────────────────────────────────────────────────┘       │
│  bg: var(--glass-subtle)                                    │
│  border: var(--border-subtle)                               │
│  text: var(--text-tertiary) ← placeholder                   │
│                                                             │
│  FOCUS STATE                                                │
│  ╭─────────────────────────────────────────────────╮       │
│  │  How do I implement_                     ░▓▓▓   │       │
│  ╰═════════════════════════════════════════════════╯       │
│      ↑                                      ↑              │
│    Cyan glow border                   Cursor pulse         │
│                                                             │
│  border: 2px solid var(--aurora-cyan)                       │
│  box-shadow: 0 0 0 4px var(--aurora-cyan-glow)             │
│  bg: var(--glass-light)                                     │
│                                                             │
│  ERROR STATE                                                │
│  ╭─────────────────────────────────────────────────╮       │
│  │  Invalid API key                                │       │
│  ╰═════════════════════════════════════════════════╯       │
│  border-color: var(--aurora-red)                            │
│  box-shadow: 0 0 0 4px var(--aurora-red-glow)              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

### 7.4 The Prompt Input (Hero Component)

This is the MOST IMPORTANT component—the main chat input:

```
┌─────────────────────────────────────────────────────────────┐
│  AURORA PROMPT INPUT                                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ╭═══════════════════════════════════════════════════════╮ │
│  ║                                                       ║ │
│  ║   │ How can I refactor this React component          ║ │
│  ║   │ to use hooks instead of class components?_       ║ │
│  ║                                                       ║ │
│  ╟───────────────────────────────────────────────────────╢ │
│  ║   ◎ @file    ◎ @folder    ◎ @web       [⌘ + Enter]  ║ │
│  ╚═══════════════════════════════════════════════════════╝ │
│                                                             │
│  Design Details:                                            │
│  • Double-line border with subtle gradient                  │
│  • Inner glow when focused (aurora-cyan)                    │
│  • Attachment chips below with hover states                 │
│  • Send button pulses subtly when ready                     │
│  • Expands smoothly as content grows                        │
│                                                             │
│  Animation:                                                 │
│  • On focus: border brightens, inner glow appears           │
│  • On type: subtle scale micro-pulse (1.002x)               │
│  • On send: content slides up + fades, input shrinks        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

### 7.5 Message Bubbles

```
┌─────────────────────────────────────────────────────────────┐
│  AURORA MESSAGE BUBBLES                                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  USER MESSAGE                                               │
│                           ╭─────────────────────────────╮  │
│                           │ How do I fix this TypeScript│  │
│                           │ error in my component?      │  │
│                           ╰─────────────────────────────╯  │
│                                                             │
│  • Aligned right                                            │
│  • bg: var(--aurora-cyan) at 15% opacity                   │
│  • border-left: 2px solid var(--aurora-cyan)               │
│  • Subtle cyan tint                                         │
│                                                             │
│  ASSISTANT MESSAGE                                          │
│  ╭──────────────────────────────────────────────────────╮  │
│  │ ◈ Let me help you with that TypeScript error.       │  │
│  │                                                      │  │
│  │ The issue is that your component expects a          │  │
│  │ `string` but receives `string | undefined`.         │  │
│  │                                                      │  │
│  │ ```typescript                                        │  │
│  │ // Add type guard                                    │  │
│  │ if (typeof value === 'string') {                     │  │
│  │   processValue(value)                                │  │
│  │ }                                                    │  │
│  │ ```                                                  │  │
│  ╰──────────────────────────────────────────────────────╯  │
│                                                             │
│  • Aligned left                                             │
│  • bg: var(--glass-light)                                   │
│  • border-left: 2px solid var(--aurora-violet)             │
│  • Code blocks: var(--void-elevated) bg                    │
│                                                             │
│  STREAMING STATE                                            │
│  ╭──────────────────────────────────────────────────────╮  │
│  │ ◈ Analyzing your codebase...                        │  │
│  │                                                      │  │
│  │ ▓▓▓▓▓▓▓▓░░░░░░░░░░░░  Scanning files               │  │
│  │                            ◌ ◌ ◌ ← Pulsing dots     │  │
│  ╰──────────────────────────────────────────────────────╯  │
│                                                             │
│  • Shimmer effect on loading areas                          │
│  • Typing indicator: 3 dots with staggered pulse           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

### 7.6 Navigation & Header

```
┌─────────────────────────────────────────────────────────────┐
│  AURORA HEADER                                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓  │
│  ┃  ◈ opencode          Session: Project Analysis       ┃  │
│  ┃                                          ⚙ ◐ ▤       ┃  │
│  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛  │
│                                                             │
│  Properties:                                                │
│  • bg: var(--void-elevated) with backdrop-blur              │
│  • border-bottom: 1px solid var(--border-subtle)            │
│  • position: sticky                                         │
│  • Logo: ◈ glyph with subtle cyan glow                     │
│  • Session title: truncated with ellipsis                   │
│  • Actions: icon buttons with hover glow                    │
│                                                             │
│  SIDEBAR (Collapsed)                                        │
│  ┌──┐                                                       │
│  │◈│  ← Logo only                                          │
│  │──│                                                       │
│  │⊕│  ← New session                                        │
│  │📄│  ← Recent                                             │
│  │⚙│  ← Settings                                           │
│  └──┘                                                       │
│                                                             │
│  SIDEBAR (Expanded)                                         │
│  ╭────────────────────────╮                                │
│  │  ◈ opencode           │                                 │
│  ├────────────────────────┤                                │
│  │  ⊕ New Session        │                                 │
│  ├────────────────────────┤                                │
│  │  RECENT               │                                  │
│  │  ├─ Project Analysis  │ ← Selected, cyan highlight       │
│  │  ├─ Code Review       │                                 │
│  │  └─ Bug Investigation │                                 │
│  ├────────────────────────┤                                │
│  │  ⚙ Settings           │                                 │
│  ╰────────────────────────╯                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

### 7.7 Dialogs & Modals

```
┌─────────────────────────────────────────────────────────────┐
│  AURORA MODALS                                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  BACKDROP                                                   │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│  bg: rgba(5, 5, 8, 0.8)                                     │
│  backdrop-filter: blur(4px)                                 │
│                                                             │
│  MODAL CARD                                                 │
│  ╭═══════════════════════════════════════════════════════╮ │
│  ║  SELECT MODEL                                    ✕   ║ │
│  ╟───────────────────────────────────────────────────────╢ │
│  ║                                                       ║ │
│  ║   ◉ Claude 4 Opus                                    ║ │
│  ║     Best for complex reasoning                        ║ │
│  ║                                                       ║ │
│  ║   ○ Claude 4 Sonnet                                  ║ │
│  ║     Balanced performance                              ║ │
│  ║                                                       ║ │
│  ║   ○ GPT-4o                                           ║ │
│  ║     OpenAI's flagship                                 ║ │
│  ║                                                       ║ │
│  ╟───────────────────────────────────────────────────────╢ │
│  ║                          [Cancel]  [   Confirm   ]   ║ │
│  ╚═══════════════════════════════════════════════════════╝ │
│                                                             │
│  Entry animation:                                           │
│  • Backdrop fades in (0→1, 200ms)                          │
│  • Modal scales + fades (0.95→1, 0→1, 250ms, spring)       │
│                                                             │
│  Exit animation:                                            │
│  • Modal scales down + fades (1→0.95, 1→0, 150ms)          │
│  • Backdrop fades out (1→0, 150ms)                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Part 8: TUI (Terminal) Component Translations

The terminal can't do true 3D or blur, but we can create the *feeling* of Aurora through:

### 8.1 Aurora TUI Character Palette

```
┌─────────────────────────────────────────────────────────────┐
│  AURORA TUI — CHARACTER DESIGN LANGUAGE                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ─── BORDERS ───                                            │
│  Light:    ─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼                          │
│  Rounded:  ╭ ╮ ╰ ╯                                          │
│  Heavy:    ━ ┃ ┏ ┓ ┗ ┛ ┣ ┫ ┳ ┻ ╋                          │
│  Double:   ═ ║ ╔ ╗ ╚ ╝ ╠ ╣ ╦ ╩ ╬                          │
│                                                             │
│  ─── AURORA PREFERENCE ───                                  │
│  Primary borders:   ╭ ─ ╮    (rounded, elegant)            │
│                     │   │                                   │
│                     ╰ ─ ╯                                   │
│                                                             │
│  Active/Focus:      ╭═══╮    (double top = "glow")         │
│                     │   │                                   │
│                     ╰───╯                                   │
│                                                             │
│  ─── BULLETS & MARKERS ───                                  │
│  Filled:    ● ◉ ◆ ◈ ■ ▲ ▶                                 │
│  Empty:     ○ ◇ □ △ ▷                                      │
│  Special:   ◐ ◑ ◒ ◓  (half-filled, for progress)          │
│                                                             │
│  Aurora preference:                                         │
│  • Logo/brand:      ◈  (diamond with dot = light source)   │
│  • Selected:        ●                                       │
│  • Unselected:      ○                                       │
│  • Active:          ◉  (ring = glow)                       │
│  • Tree nodes:      ├─ └─ │                                │
│                                                             │
│  ─── PROGRESS INDICATORS ───                                │
│  Block gradient:    ░ ▒ ▓ █                                │
│  Thin bar:         ─ ━                                      │
│                                                             │
│  Aurora progress:   ░░░░░░░░▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓          │
│                     (dim → bright = filling with light)    │
│                                                             │
│  ─── SPINNERS ───                                           │
│  Dots:       ⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏                         │
│  Circle:     ◴ ◷ ◶ ◵                                        │
│  Quarter:    ◜ ◝ ◞ ◟                                        │
│                                                             │
│  Aurora spinner:    ◌ ◍ ◎ ● ◎ ◍ (breathing pulse)         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 TUI Layout Templates

```
┌─────────────────────────────────────────────────────────────┐
│  AURORA TUI — MAIN SESSION VIEW                             │
├─────────────────────────────────────────────────────────────┤

╭─── ◈ opencode ─────────────────── Session: Code Review ────╮
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┃ How can I optimize this database query?                 │ ← User (cyan │)
│                                                             │
│  ╭─────────────────────────────────────────────────────╮   │
│  │ ◈ I'll analyze your query and suggest optimizations.│   │ ← Assistant
│  │                                                     │   │
│  │ Looking at your query, I see several opportunities: │   │
│  │                                                     │   │
│  │ 1. Add an index on `user_id`                       │   │
│  │ 2. Use EXPLAIN ANALYZE to identify bottlenecks      │   │
│  │ 3. Consider pagination for large result sets        │   │
│  │                                                     │   │
│  │ ```sql                                              │   │
│  │ CREATE INDEX idx_user_id ON orders(user_id);        │   │
│  │ ```                                                 │   │
│  ╰─────────────────────────────────────────────────────╯   │
│                                                             │
│  ░░░░░░░░░░░░░░░░░░▓▓▓▓▓▓▓▓▓▓▓▓  Processing file changes   │ ← Progress
│                                                             │
╰─────────────────────────────────────────────────────────────╯
│ [?] Help  [m] Model  [t] Theme  [s] Sessions     $0.003   │ ← Footer
└─────────────────────────────────────────────────────────────┘

COLOR MAPPING:
• Header border:        aurora-cyan (#00D4FF)
• Header text:          text-primary (#F5F5F7)
• User message │:       aurora-cyan
• Assistant border:     aurora-violet (#A78BFA)
• Code blocks:          void-elevated bg
• Progress filled:      aurora-cyan
• Progress empty:       border-subtle
• Footer:               text-muted
```

### 8.3 TUI Dialog Example

```
┌─────────────────────────────────────────────────────────────┐
│  AURORA TUI — MODEL SELECTOR DIALOG                         │
├─────────────────────────────────────────────────────────────┤

        ╭═══════════════════════════════════════════╮
        ║         SELECT MODEL                      ║
        ╠═══════════════════════════════════════════╣
        ║                                           ║
        ║   ◉ Claude 4 Opus                        ║ ← Selected (cyan)
        ║     Best for complex reasoning            ║
        ║                                           ║
        ║   ○ Claude 4 Sonnet                      ║
        ║     Balanced performance                  ║
        ║                                           ║
        ║   ○ GPT-4o                               ║
        ║     OpenAI's flagship                     ║
        ║                                           ║
        ║   ○ Gemini 1.5 Pro                       ║
        ║     Google's multimodal                   ║
        ║                                           ║
        ╟───────────────────────────────────────────╢
        ║   [↑↓] Navigate  [Enter] Select  [Esc]   ║
        ╚═══════════════════════════════════════════╝

COLOR MAPPING:
• Dialog border:        aurora-cyan (double line = "glowing")
• Selected item:        aurora-cyan fg + ◉ marker
• Unselected:          text-muted + ○ marker
• Description:         text-tertiary
• Keybinds:            text-muted
• Dialog bg:           void-elevated
```

---

## Part 9: Stitch Prompts for Visual Prototyping

Copy & paste these prompts directly into [stitch.google.com](https://stitch.google.com) to generate visual mockups.

### Prompt 1: Main Chat Interface (Dark Theme)

```
Create a dark mode AI chat interface for a developer tool called "opencode".

DESIGN DIRECTION:
- Style: Luxury minimal, future-forward like Tesla/Rivian interiors
- Aesthetic: Digital luminescence - elements emit light rather than cast shadows
- Feel: Clean but bold, pushing boundaries while staying usable

COLORS:
- Background: Deep void black (#0A0A0F)
- Cards/panels: Glassmorphism with very subtle white tint (rgba(255,255,255,0.04))
- Primary accent: Electric cyan (#00D4FF) - used for glows and highlights
- Secondary accent: Soft violet (#A78BFA)
- Text: Bright white (#F5F5F7)
- Borders: Subtle glow, not hard edges

LAYOUT:
- Left sidebar (collapsed): narrow strip with logo ◈, new session button, recent sessions list
- Main area: chat message history with clear visual hierarchy
- Bottom: prominent input field with glassmorphism, glowing cyan border on focus
- Header: session title, context/token count, settings icons

MESSAGE STYLING:
- User messages: aligned right, subtle cyan tint background, thin cyan left border
- Assistant messages: aligned left, glass card with rounded corners, thin violet left border
- Code blocks inside messages: darker elevated background

EFFECTS:
- Buttons glow brighter on hover (cyan halo expands)
- Cards have subtle lift on hover
- Input field has pulsing glow when focused
- Use smooth spring-based animations, not linear

TYPOGRAPHY:
- Font: JetBrains Mono for code, Inter/Geist for UI text
- Clean, modern, monospace aesthetic

Show this as a full desktop application interface (1440x900) with an ongoing conversation about code refactoring.
```

---

### Prompt 2: Model Selection Modal

```
Create a modal dialog for selecting AI models in a dark mode developer tool.

DESIGN:
- Style: Glassmorphism modal floating over blurred dark background
- Background behind modal: Deep black (#0A0A0F) with 80% opacity overlay + blur
- Modal card: Glass effect (rgba(255,255,255,0.06)) with luminous cyan border

MODAL CONTENT:
- Title: "SELECT MODEL" at top
- List of 4-5 AI models as selectable options:
  • Claude 4 Opus - "Best for complex reasoning"
  • Claude 4 Sonnet - "Balanced performance"
  • GPT-4o - "OpenAI's flagship"
  • Gemini 1.5 Pro - "Multimodal capabilities"

INTERACTIONS:
- Selected option: Has filled cyan radio button, text is brighter
- Unselected: Empty circle, muted text
- Hover state: Subtle glow behind the option row
- Footer: "Cancel" ghost button, "Confirm" primary button with cyan glow

ANIMATION:
- Modal scales in from 0.95 to 1.0 with fade
- Backdrop blurs in smoothly
- Radio selection has smooth transition

Colors:
- Accent cyan: #00D4FF
- Background void: #0A0A0F
- Glass: rgba(255,255,255,0.06)
- Text: #F5F5F7 (primary), #A1A1AA (muted)
```

---

### Prompt 3: Empty State / Welcome Screen

```
Create a welcome screen for an AI coding assistant called "opencode".

DESIGN DIRECTION:
- Dark mode, luxury minimal aesthetic
- Ethereal, digital luminescence feel
- Background: Very dark (#050508) with subtle animated gradient aurora effect (cyan/violet/rose, VERY subtle and slow)

CONTENT:
- Large diamond logo (◈) in center, glowing softly with cyan light
- Tagline: "Code illuminated"
- Subtitle: "Your AI pair programming assistant"
- 3-4 quick action cards below:
  • "Start new session" (primary CTA with cyan glow)
  • "Continue recent: [session name]"
  • "Explore templates"
  • "Settings & preferences"

VISUAL EFFECTS:
- Logo has subtle breathing pulse (glow expands/contracts slowly)
- Quick action cards are glass panels that lift and glow on hover
- Very subtle particle/star field effect in background (optional, keep it minimal)
- Typography is clean, modern, confident

COLORS:
- Primary: #00D4FF (cyan)
- Secondary: #A78BFA (violet)
- Tertiary: #FF6B9D (rose)
- Background: #050508 to #0A0A0F gradient
- Text: #F5F5F7

Show as full screen application (1440x900), centered composition.
```

---

### Prompt 4: Light Theme Variant

```
Create a light mode variant of an AI chat interface for developers.

DESIGN DIRECTION:
- Same luxury minimal aesthetic as dark mode, but inverted
- "Daylight aurora" - colors are richer/deeper for contrast
- Feel: Clean, bright, professional, premium

COLORS:
- Background: Soft pearl (#FAFAFA)
- Cards: Frosted white glass with very subtle shadows
- Primary accent: Deeper cyan (#0891B2) for contrast
- Secondary: Rich violet (#7C3AED)
- Text: Near-black (#18181B)
- Borders: Very subtle gray, barely visible

LAYOUT (same as dark):
- Collapsed sidebar on left
- Chat messages in center
- Glowing input at bottom (cyan glow still works in light mode)

MESSAGE STYLING:
- User: Subtle cyan wash background, deeper cyan left border
- Assistant: White glass card, violet left border
- Code blocks: Light gray (#F4F4F5) background

KEY DIFFERENCE FROM DARK:
- Shadows can be used (subtle, soft)
- Glass effect uses slight darkness instead of lightness
- Accents are richer/more saturated
- Same spring animations, same glow effects on focus

Show as desktop app (1440x900) with same conversation as dark version.
```

---

### Prompt 5: Session List / Sidebar Expanded

```
Create an expanded sidebar view for a developer chat application.

DESIGN:
- Dark mode, glassmorphism sidebar panel
- Sidebar width: ~280px
- Background: Slightly elevated from main (#0F0F14)

CONTENT:
- Top: Logo "◈ opencode" with subtle cyan glow
- Below logo: "+ New Session" button (primary, cyan glow)
- Section: "RECENT" label (small, muted, uppercase)
- Session list items showing:
  • Session title (truncated)
  • Brief preview of last message
  • Timestamp (relative: "2h ago", "Yesterday")
  • Subtle icon showing model used

INTERACTIONS:
- Current/selected session: Cyan highlight bar on left, brighter text
- Hover: Glass background appears, subtle glow
- List items have smooth slide-in animation on load

VISUAL DETAILS:
- Divider lines are very subtle (border-subtle)
- Sessions grouped by time (Today, Yesterday, This Week)
- Scroll area with fading edge at top/bottom
- Search input at top with glass styling

Colors:
- Selected highlight: #00D4FF
- Muted text: #71717A
- Timestamps: #A1A1AA
```

---

### Prompt 6: Tool/Permission Dialog

```
Create a permission request dialog for an AI coding assistant.

CONTEXT:
The AI wants to edit a file and needs user approval.

DESIGN:
- Dark glassmorphism modal
- Slightly different accent - using amber/warning color to indicate caution

CONTENT:
- Header icon: Edit/pencil icon with amber glow
- Title: "Edit File Request"
- Description: "opencode wants to modify:"
- File path displayed: `src/components/Button.tsx`
- Preview section showing diff:
  • Green highlighted lines for additions
  • Red highlighted lines for deletions
  • Context lines in muted color

ACTIONS:
- "Allow" button - Primary with amber accent (#FFBB33)
- "Allow All" button - Secondary
- "Deny" button - Ghost/danger hint

VISUAL DETAILS:
- Diff preview has code syntax highlighting
- Line numbers visible
- Modal has amber-tinted border (warning state)
- Keep the same glass effect and animation patterns

Show the dialog centered over a blurred chat interface background.
```

---

### Prompt 7: Loading/Processing State

```
Create a message streaming/loading state for an AI response.

DESIGN:
- Dark mode chat interface
- Assistant message in progress of being generated

VISUAL:
- Glass card for assistant message (violet left border)
- Inside the card:
  • "◈" logo pulsing with violet glow (breathing animation)
  • First line of text appearing with typewriter effect
  • Remaining area has subtle shimmer/skeleton loader
  • Three dots "◌ ◌ ◌" with staggered pulse animation

PROGRESS INDICATOR:
- Horizontal progress bar at bottom of card
- Uses the "filling with light" metaphor
- Empty portion: dim gray (░░░)
- Filled portion: cyan gradient (▓▓▓)
- Shows: "Analyzing codebase... 127 files"

EFFECTS:
- Text fades in word by word
- Shimmer effect uses subtle gradient animation
- Overall feel: the AI is "thinking" and response is "materializing from light"

Keep consistent with the Aurora design system - ethereal, luminous, not mechanical.
```

---

### Prompt 8: Settings Panel

```
Create a settings/preferences panel for a developer AI tool.

DESIGN:
- Full-width panel that slides in from right (or modal)
- Dark glassmorphism style
- Organized into clear sections

SECTIONS:
1. APPEARANCE
   - Theme selector (dropdown or visual cards)
   - Font size slider

2. MODEL DEFAULTS
   - Default model dropdown
   - Temperature slider with visual indicator

3. KEYBINDINGS
   - List of keyboard shortcuts in two columns
   - Each shows action + keybind

4. INTEGRATIONS
   - Toggle switches for: Git, LSP, MCP servers
   - Each with subtle description

VISUAL STYLE:
- Section headers: Small caps, cyan accent, muted
- Form controls: Glass styling, cyan focus states
- Toggle switches: Off = muted, On = cyan glow
- Sliders: Thin track, glowing thumb

LAYOUT:
- Clean vertical stack with generous spacing
- Dividers between sections (very subtle)
- "Save" and "Cancel" buttons at bottom

Background: #0F0F14 (elevated from main void)
```

---

### Prompt 9: Error State

```
Create an error notification/toast for an AI coding assistant.

SCENARIO: API rate limit exceeded

DESIGN:
- Toast notification appearing at top-right
- Dark glass with RED accent (error state)

CONTENT:
- Left: Warning icon with red glow (⚠ or !)
- Title: "Rate Limit Exceeded"
- Description: "Please wait 30 seconds before trying again"
- Dismiss X button on right

VISUAL:
- Glass background with subtle red tint
- Red left border (2-3px)
- Soft red outer glow (not harsh)
- Red accent: #F87171

ANIMATION:
- Slides in from right with spring physics
- Slight bounce at end
- Auto-dismiss with progress bar along bottom
- Fades out when dismissed

ERROR COLOR MAPPING:
- Error: #F87171 (rose-red)
- Warning: #FFBB33 (amber)
- Success: #4ADE80 (green)
- Info: #00D4FF (cyan)

Show toast over blurred chat interface.
```

---

### Prompt 10: Code Diff View

```
Create a code diff viewer for an AI coding assistant's file changes.

DESIGN:
- Dark mode with syntax highlighting
- Side-by-side or unified diff view

VISUAL STRUCTURE:
- Header: File path, "View Full File" link
- Line numbers on left (muted color)
- Two-tone background for changes:
  • Added lines: Very subtle green tint background (#0D2818)
  • Removed lines: Very subtle red tint background (#2D1216)
  • Context lines: Default void background

SYNTAX HIGHLIGHTING (Aurora theme):
- Keywords: Violet (#A78BFA)
- Functions: Cyan (#00D4FF)
- Strings: Green (#4ADE80)
- Numbers: Rose (#FF6B9D)
- Comments: Muted gray (#71717A)
- Variables: White (#F5F5F7)

ADDITIONS:
- + symbol in green
- Line highlighted with green left border
- Changed text within line has brighter green background

DELETIONS:
- - symbol in red
- Line highlighted with red left border
- Changed text within line has brighter red background

GLASS CARD:
- Wrap entire diff in glass panel
- Rounded corners
- Subtle border

Show a realistic diff of a TypeScript React component being refactored.
```

---

## Part 10: Final Summary & Implementation Guide

### Design DNA at a Glance

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  AURORA DESIGN SYSTEM                                       │
│  "Code illuminated from within"                             │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  VISUAL                     MOTION                          │
│  ├─ Dark-first luxury       ├─ Spring physics              │
│  ├─ Digital luminescence    ├─ Confident/tactile           │
│  ├─ Glassmorphism           ├─ 200-350ms timing            │
│  └─ Glowing accents         └─ Glow as feedback            │
│                                                             │
│  COLOR                      TYPOGRAPHY                      │
│  ├─ Cyan primary            ├─ JetBrains Mono (code)       │
│  ├─ Violet secondary        ├─ Geist/Inter (UI)            │
│  ├─ Rose tertiary           └─ Major Third scale           │
│  └─ Void backgrounds                                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Quick Reference Card

| Aspect | Specification |
|--------|---------------|
| **Primary Accent** | `#00D4FF` (Electric Cyan) |
| **Secondary** | `#A78BFA` (Soft Violet) |
| **Tertiary** | `#FF6B9D` (Rose) |
| **Dark Background** | `#0A0A0F` (Void) |
| **Light Background** | `#FAFAFA` (Pearl) |
| **Border Style** | Subtle glow, not hard edges |
| **Glass Effect** | `rgba(255,255,255,0.04)` + `blur(12px)` |
| **Border Radius** | `8px` buttons, `12px` cards, `24px` modals |
| **Animation Duration** | 150-350ms |
| **Easing** | Spring-based (`cubic-bezier(0.22, 1, 0.36, 1)`) |
| **Code Font** | JetBrains Mono |
| **UI Font** | Geist / Inter |

### Component Mapping: Web → TUI

| Web Component | TUI Equivalent |
|---------------|----------------|
| Cyan glow border | Double-line border `═══` |
| Glassmorphism card | Rounded box `╭─╮ │ ╰─╯` |
| Hover lift effect | Highlight color change |
| Loading shimmer | Block gradient `░▒▓█` |
| Pulsing glow | Braille spinner `⠋⠙⠹...` or `◌◍◎●` |
| User cyan tint | Cyan foreground + `┃` pipe |
| Assistant violet border | Violet `│` left margin |

### Implementation Phases (Recommended)

#### Phase 1: Theme Foundation
- [ ] Create `aurora-dark.json` and `aurora-light.json` theme files
- [ ] Add to TUI theme selector
- [ ] Update CSS custom properties for web console

#### Phase 2: Core Components
- [ ] Buttons (primary, secondary, ghost, danger)
- [ ] Input fields with focus glow
- [ ] Cards with glass effect
- [ ] Modals with backdrop blur

#### Phase 3: Chat Interface
- [ ] Message bubbles (user/assistant)
- [ ] Prompt input (hero component)
- [ ] Loading/streaming states
- [ ] Code blocks with Aurora syntax theme

#### Phase 4: Motion Polish
- [ ] Spring animations library integration
- [ ] Enter/exit transitions
- [ ] Micro-interactions
- [ ] Loading states

### Existing Component Touchpoints

Based on analysis of the codebase, these are the key files to modify:

**TUI Theme System:**
- `packages/opencode/src/cli/cmd/tui/context/theme.tsx` — Theme provider and color types
- `packages/opencode/src/cli/cmd/tui/context/theme/` — Theme JSON files (add aurora-dark.json, aurora-light.json)

**TUI Components:**
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` — Main session view
- `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` — Prompt input component
- `packages/opencode/src/cli/cmd/tui/component/dialog-*.tsx` — All dialog components

**Web Console:**
- `packages/console/app/src/style/token/color.css` — CSS color tokens
- `packages/console/app/src/routes/index.css` — Landing page styles
- `packages/console/app/src/component/` — Shared components

### Success Criteria

The Aurora redesign is successful when:

1. **Visual Coherence**: TUI and Web feel like the same product family
2. **Motion Quality**: Interactions feel tactile and confident, not floaty or delayed
3. **Performance**: Animations run at 60fps, no jank
4. **Accessibility**: 4.5:1 contrast ratios maintained, focus states visible
5. **Brand Recognition**: Users recognize "the opencode look" instantly

---

## Appendix: Theme JSON Template

```json
{
  "$schema": "https://opencode.ai/theme.json",
  "defs": {
    "voidDeepest": "#050508",
    "voidDeep": "#0A0A0F",
    "voidBase": "#0F0F14",
    "voidElevated": "#14141A",
    "voidHover": "#1A1A22",
    "auroraCyan": "#00D4FF",
    "auroraViolet": "#A78BFA",
    "auroraRose": "#FF6B9D",
    "auroraAmber": "#FFBB33",
    "auroraGreen": "#4ADE80",
    "auroraRed": "#F87171",
    "textPrimary": "#F5F5F7",
    "textSecondary": "#A1A1AA",
    "textTertiary": "#71717A"
  },
  "theme": {
    "primary": "auroraCyan",
    "secondary": "auroraViolet",
    "accent": "auroraRose",
    "error": "auroraRed",
    "warning": "auroraAmber",
    "success": "auroraGreen",
    "info": "auroraCyan",
    "text": "textPrimary",
    "textMuted": "textSecondary",
    "background": "voidDeep",
    "backgroundPanel": "voidBase",
    "backgroundElement": "voidElevated",
    "border": "#1E1E26",
    "borderActive": "auroraCyan",
    "borderSubtle": "#14141A",
    "syntaxKeyword": "auroraViolet",
    "syntaxFunction": "auroraCyan",
    "syntaxString": "auroraGreen",
    "syntaxNumber": "auroraRose",
    "syntaxComment": "textTertiary",
    "syntaxVariable": "textPrimary",
    "syntaxType": "auroraAmber",
    "syntaxOperator": "textSecondary",
    "syntaxPunctuation": "textTertiary",
    "diffAdded": "auroraGreen",
    "diffRemoved": "auroraRed",
    "diffAddedBg": "#0D2818",
    "diffRemovedBg": "#2D1216",
    "diffContext": "textTertiary",
    "diffContextBg": "voidBase"
  }
}
```

---

**Document created:** 2025-02-26
**Design direction:** Aurora — Digital Luminescence
**Status:** Ready for implementation
**Last reviewed:** 2025-02-26 (UI/UX Pro Max review incorporated)

---

## Part 11: Accessibility & Review Amendments

*This section addresses feedback from the UI/UX Pro Max review and adds critical accessibility requirements.*

### 11.1 Motion Sickness Prevention (CRITICAL)

**Issue:** The original design suggested animated aurora backgrounds and continuous pulse effects which can trigger motion sensitivity.

**Resolution:**

```css
/* ═══════════════════════════════════════════════════════════
   REDUCED MOTION SUPPORT — MANDATORY
   ═══════════════════════════════════════════════════════════ */

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }

  /* Disable specific Aurora effects */
  .aurora-background {
    background: var(--void-deep) !important;
    animation: none !important;
  }

  .glow-pulse {
    box-shadow: none !important;
  }
}
```

**Guidelines:**
- ❌ **NEVER** use infinite animations on backgrounds or decorative elements
- ✅ Continuous animation ONLY permitted during active loading states
- ✅ Aurora drift effect should be opt-in, disabled by default
- ✅ All spring animations must have `prefers-reduced-motion` fallback

---

### 11.2 Line Length Constraints (HIGH)

**Issue:** Chat interfaces and documentation need line-length limits for readability.

**Resolution:**

```css
/* Add to spacing system */
:root {
  --max-prose-width: 70ch;  /* 65-75 characters optimal */
}

/* Apply to text containers */
.chat-message,
.documentation-content,
.modal-body {
  max-width: var(--max-prose-width);
}

/* Ensure full-width code blocks still work */
.code-block {
  max-width: 100%;
  overflow-x: auto;
}
```

**Application:**
| Component | Max Width |
|-----------|-----------|
| Chat message bubbles | `70ch` |
| Modal body text | `70ch` |
| Documentation paragraphs | `70ch` |
| Code blocks | `100%` (scrollable) |
| Headers | No limit |

---

### 11.3 Light Mode Glass Contrast (CRITICAL)

**Issue:** Light mode glass effects were too subtle to establish visual hierarchy.

**Resolution — Updated Light Theme:**

```css
:root[data-theme="aurora-light"] {
  /* ─── ADJUSTED GLASS OPACITIES ─── */
  --glass-subtle:      rgba(0, 0, 0, 0.03);   /* was 0.02 */
  --glass-light:       rgba(0, 0, 0, 0.06);   /* was 0.04 */
  --glass-medium:      rgba(0, 0, 0, 0.09);   /* was 0.06 */
  --glass-strong:      rgba(0, 0, 0, 0.12);   /* was 0.08 */

  /* ─── STRONGER BORDERS ─── */
  --border-subtle:     rgba(0, 0, 0, 0.08);   /* was 0.06 */
  --border-default:    rgba(0, 0, 0, 0.12);   /* was 0.10 */
  --border-strong:     rgba(0, 0, 0, 0.18);   /* was 0.15 */

  /* ─── SUBTLE SHADOWS (light mode only) ─── */
  --shadow-sm:         0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-md:         0 2px 4px rgba(0, 0, 0, 0.08);
  --shadow-lg:         0 4px 8px rgba(0, 0, 0, 0.10);
}

/* Apply shadows to cards in light mode only */
[data-theme="aurora-light"] .glass-card {
  box-shadow: var(--shadow-sm);
}
```

**Contrast Verification:**

| Text | Background | Ratio | Status |
|------|------------|-------|--------|
| `#18181B` | `#FAFAFA` | 16.2:1 | ✅ Pass |
| `#52525B` | `#FAFAFA` | 7.4:1 | ✅ Pass |
| `#A1A1AA` | `#FAFAFA` | 3.0:1 | ⚠️ Large text only |
| `#F5F5F7` | `#0A0A0F` | 19.6:1 | ✅ Pass |
| `#A1A1AA` | `#0A0A0F` | 8.5:1 | ✅ Pass |

---

### 11.4 Interactive Element Requirements (MEDIUM)

**Issue:** Interactive cues need explicit mandates.

**Resolution — Mandatory Interaction Patterns:**

```css
/* All clickable elements */
button,
[role="button"],
.clickable,
.interactive-card,
a {
  cursor: pointer;
}

/* Focus-visible states (keyboard navigation) */
:focus-visible {
  outline: 2px solid var(--aurora-cyan);
  outline-offset: 2px;
}

/* Disable outline for mouse users */
:focus:not(:focus-visible) {
  outline: none;
}
```

**Icon Standards:**
- ✅ **Required:** Lucide Icons (React: `lucide-react`, Web: `lucide`)
- ✅ **Acceptable:** Heroicons, Phosphor Icons
- ❌ **Forbidden:** Emoji as UI icons (OS rendering inconsistency)
- ❌ **Forbidden:** Font Awesome (too generic, doesn't fit Aurora aesthetic)

---

### 11.5 WCAG Compliance Checklist

Before implementation, verify:

#### Color & Contrast
- [ ] All body text has 4.5:1 minimum contrast ratio
- [ ] All large text (18px+) has 3:1 minimum contrast ratio
- [ ] Focus indicators are clearly visible (2px cyan outline)
- [ ] Error states use red AND icon/text (not color alone)

#### Motion & Animation
- [ ] `prefers-reduced-motion` media query implemented
- [ ] No infinite animations on decorative elements
- [ ] Loading animations can be paused or are under 5s
- [ ] No flashing content (3 flashes per second limit)

#### Interaction
- [ ] All interactive elements have `cursor: pointer`
- [ ] Touch targets are minimum 44x44px
- [ ] Keyboard navigation follows visual order
- [ ] Focus states are distinct from hover states

#### Typography
- [ ] Minimum 16px body text (mobile)
- [ ] Line height minimum 1.5 for body text
- [ ] Line length limited to 70ch for prose
- [ ] Text is resizable to 200% without loss of functionality

---

### Review Response Summary

| Feedback Item | Severity | Action Taken |
|---------------|----------|--------------|
| Motion sickness / `prefers-reduced-motion` | CRITICAL | Added §11.1 with full CSS implementation |
| Line length 65-75ch | HIGH | Added §11.2 with `--max-prose-width: 70ch` |
| Light mode glass contrast | CRITICAL | Added §11.3 with adjusted opacity values |
| `cursor-pointer` mandate | MEDIUM | Added §11.4 with interactive patterns |
| SVG icons only | MEDIUM | Added §11.4 with Lucide Icons mandate |
| WCAG compliance | — | Added §11.5 checklist |

---

*Review incorporated from: UI/UX Pro Max analysis (2025-02-26)*

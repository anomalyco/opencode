---
name: ui-ux-hypermezcla
description: Unified UI/UX design skill merging three expert disciplines: ADHD-friendly cognitive architecture (reduce load, time visibility, dopamine feedback), Anthropics frontend aesthetics (distinctive production-grade, no AI-slop), and Typography Expert (font pairing, type scales, OpenType, variable fonts). Use when building web interfaces, apps, or any digital UI that needs to be simultaneously accessible, visually distinctive, and typographically refined. Activates on 'UI design', 'web interface', 'ADHD-friendly', 'cognitive load', 'typography', 'font pairing', 'type scale', 'frontend', 'accessible UI', 'neurodivergent UX'.
allowed-tools: Read,Write,Edit,WebFetch,Browse
category: Design & Creative
tags:
  - ui-design
  - ux
  - adhd-friendly
  - cognitive-load
  - typography
  - frontend
  - accessible
  - neurodivergent
  - font-pairing
  - type-scale
  - production-grade
source-skills:
  - name: adhd-design-expert
    url: https://github.com/majiayu000/claude-skill-registry/blob/fc98f4ec9f4271ca0e1e19f5b4e7951c10d984cf/skills/other/other/adhd-design-expert/SKILL.md
    contribution: "Cognitive load reduction patterns, time blindness solutions, dopamine-driven engagement, compassionate UX copy, executive function support"
  - name: frontend-design
    url: https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md
    contribution: "Distinctive production-grade frontend, anti-AI-slop aesthetics, bold design direction, motion & micro-interactions, spatial composition"
  - name: typography-expert
    url: https://github.com/majiayu000/claude-skill-registry/blob/fc98f4ec9f4271ca0e1e19f5b4e7951c10d984cf/skills/other/other/typography-expert/SKILL.md
    contribution: "Font pairing psychology, type scale systems, variable fonts, OpenType features, web font performance, fluid type"
pairs-with:
  - skill: design-system-creator
    reason: Build design systems with the hypermezcla visual language
  - skill: web-design-expert
    reason: Apply hypermezcla principles to web projects
---

# UI/UX Hypermezcla — Unified Design Skill

Three expert streams fused into one coherent design system: **ADHD cognitive architecture** + **Anthropics frontend aesthetics** + **Typography mastery**. The result is interfaces that are simultaneously accessible, visually distinctive, and typographically refined.

## When to Use This Skill

**Use for:**
- Designing web interfaces, apps, dashboards, landing pages
- Building ADHD-friendly UIs that reduce cognitive load
- Creating distinctive, production-grade frontend that avoids AI-slop aesthetics
- Implementing sophisticated typography systems (font pairing, type scales, variable fonts)
- Combining accessibility with visual excellence
- Any project needing "this looks genuinely designed" quality

**NOT for:**
- Logo design or brand identity (→ design-system-creator)
- Backend-only work with no UI component
- Simple content sites without design requirements

---

## Design Thinking — Choose Your Direction First

Before writing any code, commit to a clear aesthetic direction:

```
1. PURPOSE     → What problem does this solve? Who uses it?
2. TONE        → Pick one and own it: brutally minimal / maximalist chaos /
                 retro-futuristic / organic natural / luxury refined /
                 playful toy-like / editorial magazine / brutalist raw /
                 soft pastel / industrial utilitarian
3. CONSTRAINTS → Framework, performance, accessibility targets
4. HOOK        → What's the ONE thing someone will remember?
```

Then implement with full intentionality. Bold maximalism and refined minimalism both work — what doesn't work is timid mediocrity.

---

## Integrated Design Principles

### 🧠 ADHD-Friendly Cognitive Architecture

| ADHD Challenge | Design Solution |
|----------------|-----------------|
| Working Memory (3-5 items vs 7±2) | One primary action per screen; wizard/stepped flows |
| Time Blindness | Visual countdowns, concrete durations, progress bars |
| Task Initiation | Obvious first step, low friction start |
| Dopamine Seeking | Immediate feedback, micro-celebrations, progress rewards |
| Object Permanence | Everything visible; no hidden menus or buried options |
| Context Switching | Minimal transitions; inline editing over page navigation |
| Rejection Sensitivity | Compassionate copy; no shame, no blame |

**Cognitive Load Rules (Ruthlessly Apply):**
```
❌ BAD:  "Choose your settings" [50 checkboxes on one page]
✅ GOOD: "Let's set this up in 3 quick steps"
         Step 1: [One clear choice] → Next
```

Patterns to always apply:
- Progressive disclosure — show only what matters now
- Sensible defaults pre-selected
- Persistent "You are here" progress indicators
- Time estimates that are concrete, never vague ("~2 min" not "a while")
- Positive, non-shaming error messages

### ✨ Anthropics Frontend Aesthetics — No AI Slop

**Core forbidden list — never default to these:**
- Fonts: Inter, Roboto, Arial, system-ui defaults
- Colors: Purple gradients on white backgrounds
- Layouts: Centered single-column with generic card grids
- Components: Cookie-cutter buttons, shadow-heavy cards

**What to do instead:**
```
TYPOGRAPHY  → Distinctive font pairs. Choose a characterful display
              font + a refined body font. Avoid the obvious choices.
              Unexpected pairings beat safe ones.

COLOR       → Commit to a cohesive aesthetic with CSS variables.
              Dominant base + sharp accents. Contrast creates
              memorability; timid palettes create forgettability.

MOTION      → One well-orchestrated entrance (staggered reveals,
              animation-delay) creates more delight than scattered
              micro-interactions. Prioritize CSS-only when possible.

SPATIAL     → Unexpected layouts: asymmetry, overlap, diagonal flow,
              grid-breaking elements, generous negative space OR
              controlled density. Never just "card grid centered."

TEXTURES    → Add atmosphere: gradient meshes, noise overlays,
              geometric patterns, layered transparencies, dramatic
              shadows, grain. Flat solid = forgettable.
```

### 🔤 Typography Mastery

**Font Pairing Decision Tree:**
```
IF formal/traditional/authoritative    → Serif (Garamond, Minion, Crimson)
IF modern/clean/technical             → Sans-Serif (Helvetica-ish, not Inter)
IF humanist/friendly/approachable      → Humanist Sans (Gill Sans, Source Sans)
IF geometric/structured/tech-forward  → Geometric Sans (Futura, Avenir, Poppins)
IF editorial/long-form reading         → Transitional Serif (Georgia, Charter, Lora)
```

**Pairing rules:**
1. Contrast, not conflict — distinct personalities but compatible x-heights
2. Same designer rule — fonts from same foundry often harmonize
3. Historical compatibility — fonts from same era share design DNA
4. Superfamily shortcut — use superfamily (Alegreya + Alegreya Sans)

**Type Scale — Use a Modular Scale:**
```
Ratio     → Use case
1.067     → Dense UIs, small screens
1.125     → Simple UIs, mobile apps
1.200     → Standard web, dashboards
1.250     → Editorial, long-form
1.333     → Marketing, landing pages
1.414     → Headlines, display
```

**Variable Fonts — Always prefer for performance:**
```css
/* Use CSS custom properties for fluid type */
:root {
  --font-display: 'Inter', sans-serif;
  --font-body: 'Source Serif 4', serif;
  --type-scale: clamp(1rem, 0.5rem + 0.5vw, 1.25rem);
}
```

**OpenType features — implement intentionally:**
- Ligatures: `font-feature-settings: "liga" 1, "dlig" 1`
- Small caps: `"smcp"` for labels and eyebrows
- Tabular numerals: `"tnum"` for data tables
- Swash/stylistic alternates for display fonts

---

## Unified Design Checklist

Apply all three streams together:

- [ ] **ADHD**: One primary action visible at a time; progress always visible
- [ ] **Aesthetics**: Distinctive font pair (not Inter/Roboto/system); cohesive color system with CSS variables; motion that delights on entrance
- [ ] **Typography**: Type scale applied; variable fonts; no layout shift (font-display: swap); OpenType features for refinement
- [ ] **Cognitive Load**: No vague time estimates; concrete feedback; no shame in errors; defaults pre-selected; everything visible
- [ ] **Visual**: Spatial composition interesting (not just centered cards); atmosphere beyond flat colors; hook element that creates memorability
- [ ] **Responsive**: Mobile-first; fluid type scales; no horizontal scroll

---

## Example Integration — Button Design

A button that applies all three streams:

```
ADHD stream    → Obvious affordance; low friction; immediate
                visual feedback on interaction

Aesthetics     → Not a generic blue pill; matches the design
                system; distinctive shape/gradient/hover state;
                motion on hover (scale + shadow lift)

Typography     → Label in a refined typeface; possibly small caps;
                letter-spacing adjusted for optical precision
```

```css
/* Good ADHD-friendly, aesthetic, typographic button */
.btn-primary {
  font-family: var(--font-body);
  font-feature-settings: "smcp" 1, "liga" 1;
  font-size: var(--type-scale-sm);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  
  /* ADHD: high contrast, obvious affordance */
  background: var(--color-accent);
  color: var(--color-on-accent);
  
  /* Aesthetics: distinctive shadow + motion */
  box-shadow: 0 4px 16px var(--color-accent-glow);
  transition: transform 150ms ease, box-shadow 150ms ease;
}
.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px var(--color-accent-glow);
}
```

---

## Output Standard

Every UI implementation guided by this skill should be:
- **Production-grade**: No placeholder content, no TODO comments, fully functional
- **Accessible**: ADHD-friendly cognitive flow, but also technically accessible (color contrast, focus states)
- **Distinctive**: Won't be mistaken for AI-generated slop
- **Typographically refined**: Type scale, font pairing, variable font support
- **Performance-conscious**: Font-display strategies, no layout shift, optimized loading
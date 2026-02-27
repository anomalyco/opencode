# 🔍 Aurora Design System — Design Review, Verification & Validation

> **Reviewer:** Frontend-PE + Backend-PE Systematic Review  
> **Date:** 2025-02-27  
> **Spec Under Review:** `docs/plans/2025-02-26-aurora-design-system.md`  
> **Codebase State:** Branch `prax-dev` @ commit `6007c82`

---

## Executive Summary

**Overall Implementation Score: ~13% (Infrastructure Only)**

The Aurora Design System spec is comprehensive and well-structured, but **virtually none of it has been implemented**. The existing codebase has a sophisticated, mature theme system that the Aurora spec doesn't account for — creating a gap between spec and reality. The good news: the architecture is **fully ready** to support Aurora as a new theme. The spec needs minor reconciliation with the actual theme system before implementation can begin.

---

## Part 1: Architecture Reconciliation

### 1.1 Spec Assumes Manual CSS Variables — Codebase Uses Algorithmic Generation

| Aspect | Aurora Spec | Current Codebase |
|--------|-------------|------------------|
| **Token naming** | `--void-*`, `--glass-*`, `--aurora-*` | `--background-*`, `--surface-*`, `--text-*`, `--border-*` |
| **Color generation** | Manual hex values per token | OKLCH seed-based (9 seeds → 200+ tokens automatically) |
| **Theme format** | Custom JSON with `defs` + `theme` | Structured JSON with `seeds` + `overrides` per variant |
| **Theme count** | 2 (dark + light) | 20 Desktop themes + 33 TUI themes |
| **Color space** | Hex (#RRGGBB) | OKLCH (perceptually uniform) with hex fallback |
| **Dark/Light** | Separate token blocks | Single theme with `light` + `dark` variant objects |

**Verdict:** The Aurora spec's CSS variable approach (`--void-deep`, `--aurora-cyan`, etc.) **cannot be used directly**. Instead, Aurora must be expressed as seed colors + overrides within the existing `DesktopTheme` schema for Desktop UI, and as a `defs` + `theme` mapping for TUI.

**Risk Level:** 🟡 MEDIUM — Spec needs translation, not rewrite. The algorithmic generation may produce slightly different shades than the hand-picked Aurora hex values, but overrides can force exact matches.

### 1.2 Two Separate Theme Systems

The codebase has **two independent theme systems** that must both receive Aurora:

| System | Location | Format | Count |
|--------|----------|--------|-------|
| **Desktop/Web UI** | `packages/ui/src/theme/themes/*.json` | `DesktopTheme` (seeds + overrides) | 20 themes |
| **TUI (Terminal)** | `packages/opencode/src/cli/cmd/tui/context/theme/*.json` | `defs` + `theme` mapping | 33 themes |

The Aurora spec provides a single unified design language but **doesn't distinguish** between these two systems. Implementation must create separate theme files for each.

---

## Part 2: Section-by-Section Verification

### 2.1 Color System 🔴 NOT IMPLEMENTED

**Spec Requirement:** Aurora-specific color tokens (void backgrounds, glass surfaces, luminous spectrum, text hierarchy, border luminance) for both dark and light themes.

**Current State:** No Aurora color tokens exist anywhere in the codebase. Searched for "aurora" across all packages — zero results (the "aura" theme is unrelated).

**What Exists Instead:**
- 20 desktop themes with OKLCH-generated color scales
- Primitive color palette in `colors.css` (~600+ CSS variables: gray, smoke, yuzu, cobalt, apple, ember, solaris, lilac, coral, mint, blue, ink, amber)
- Semantic tokens in `theme.css` (~300+ variables)

**Gap Analysis:**
| Aurora Token | Nearest Existing Token | Match Quality |
|-------------|----------------------|---------------|
| `--void-deep: #0A0A0F` | `--background-base` | 🟡 Varies per theme |
| `--glass-light: rgba(255,255,255,0.04)` | `--surface-base` | 🔴 No glass/alpha system |
| `--aurora-cyan: #00D4FF` | `--primary-base` | 🟡 Maps to seed `primary` |
| `--aurora-violet: #A78BFA` | `--info-base` or override | 🟡 Expressible as seed |
| `--aurora-rose: #FF6B9D` | No direct mapping | 🔴 Would need override |
| `--text-primary: #F5F5F7` | `--text-base` | ✅ Auto-generated from neutral seed |

**Action Required:** Create `aurora.json` theme files for both Desktop UI and TUI with:
- Desktop: Map Aurora hex colors to 9 OKLCH seeds + extensive overrides for exact color matching
- TUI: Create `defs` + `theme` mapping with Aurora colors

---

### 2.2 Typography System 🟡 PARTIALLY ALIGNED

**Spec Requirement:** JetBrains Mono (code), Geist/Inter (UI), Major Third scale (1.250)

**Current State:**
| Aspect | Aurora Spec | Current | Status |
|--------|-------------|---------|--------|
| Code font | JetBrains Mono | IBM Plex Mono (default), JetBrains available as option | 🟡 Available, not default |
| UI font | Geist / Inter | Geist Sans (already default for UI) | ✅ Matches |
| Type scale | Major Third (1.250): 10.24, 12.8, 16, 20, 25, 31.25, 39, 48.8, 61px | Fixed: 13, 14, 16, 20px | 🔴 Different approach |
| Font weights | 400, 500, 600, 700 | 400, 500 | 🟡 Missing 600, 700 |
| Letter spacing | 5 levels (-0.05em to 0.05em) | 3 levels (normal, tight, tightest) | 🟡 Partial |
| Line heights | 6 levels (1 to 1.75) | 4 levels (normal, large, x-large, 2x-large) | 🟡 Partial |

**Assessment:** Typography is ~40% aligned. The font choices overlap but the modular scale approach differs significantly. The existing fixed-size approach is actually more practical for a code editor UI.

**Recommendation:** Don't implement the full Major Third scale — the existing 13/14/16/20px sizes are appropriate for a developer tool. Add JetBrains Mono as the Aurora theme's recommended code font via documentation, not code change.

---

### 2.3 Spacing System 🟡 PARTIALLY ALIGNED

**Spec:** 4px base grid with semantic spacing tokens (`--gap-xs` through `--gap-2xl`)

**Current:** `--spacing: 0.25rem` (4px) base with Tailwind spacing utilities. `--radius-xs/sm/md/lg/xl` for border radius.

**Assessment:** ~60% aligned. The 4px base grid matches. Specific semantic spacing tokens differ in naming but conceptually overlap. Border radius tokens exist with slightly different values.

**Recommendation:** No action needed — existing spacing system is sufficient. Aurora-specific padding/margin values can be applied at the component level.

---

### 2.4 Motion & Animation System 🟡 PARTIALLY IMPLEMENTED

**Spec:** Spring-based physics, 6 duration levels, semantic transitions, 7+ keyframe animations (aurora-fade-in, aurora-scale-in, aurora-slide-up, aurora-pulse, aurora-shimmer, aurora-drift)

**Current State:**

| Feature | Aurora Spec | Current | Status |
|---------|-------------|---------|--------|
| Duration tokens | 6 levels (50-700ms) | 5 levels (75-450ms) | 🟡 Close |
| Spring easing | `cubic-bezier(0.22, 1, 0.36, 1)` | `--ease-spring: cubic-bezier(0.22, 1, 0.36, 1)` | ✅ Exact match |
| Smooth easing | `cubic-bezier(0.34, 1.56, 0.64, 1)` | `--ease-smooth: cubic-bezier(0.16, 1, 0.3, 1)` | 🟡 Similar |
| fadeIn keyframe | opacity 0→1 | `fadeIn` exists | ✅ Matches |
| scaleIn keyframe | scale(0.95) + opacity | `fadeInScale` exists | ✅ Matches |
| slideUp keyframe | translateY(8px) + opacity | `fadeUp` with translateY(5px) | 🟡 Close |
| Glow pulse | box-shadow aurora-cyan-glow | `subtleGlow` exists | 🟡 Different color |
| Shimmer | background-position sweep | `shimmer` exists | ✅ Matches |
| Aurora drift | slow gradient background shift | ❌ Not implemented | 🔴 Missing |
| `prefers-reduced-motion` | Full disable of all animations | Partial — only in dialog.css | 🟠 Incomplete |

**Assessment:** ~35% implemented. Core timing and easing infrastructure is solid. Aurora-specific glow animations and the drift effect are missing. `prefers-reduced-motion` coverage needs expansion.

**Action Required:**
1. Add Aurora-specific keyframes (aurora-pulse with cyan glow, aurora-drift for backgrounds)
2. Expand `prefers-reduced-motion` to global scope per spec §11.1
3. The existing spring easing is already perfect — no changes needed

---

### 2.5 Glassmorphism Effects 🔴 MINIMAL IMPLEMENTATION

**Spec:** `backdrop-filter: blur(12-20px)`, `rgba(255,255,255,0.02-0.08)` glass layers, luminous gradient borders

**Current State:**
- `backdrop-blur` used only on dialog overlays (`dialog.css`)
- No systematic glass card styling
- No luminous/gradient borders
- No `--glass-*` CSS variables

**Assessment:** ~15% implemented. The CSS `backdrop-filter` property is used but not as a design system primitive.

**Action Required:**
1. Create `.glass-card` utility class with backdrop-blur + rgba background
2. Add `--glass-subtle/light/medium/strong` CSS variables
3. These should be Aurora-theme-specific additions, not global changes

---

### 2.6 Component Specifications

#### Buttons 🔴 1/10
**Spec:** 4 variants (Primary/Glowing, Secondary/Glass, Ghost, Danger) with glow effects  
**Current:** Button component exists with variants but no glow box-shadow effects  
**Gap:** Glow halos on hover/active states are the key Aurora differentiator — not implemented

#### Cards 🔴 1/10
**Spec:** Glass cards with backdrop-blur, luminous borders, hover lift + glow  
**Current:** Card component exists with basic styling, no glass treatment  
**Gap:** Entire glassmorphism card system missing

#### Input Fields 🔴 1.5/10
**Spec:** Glass background, cyan glow border on focus, error glow states  
**Current:** Input fields have focus rings but no glow shadow effects  
**Gap:** Focus glow (box-shadow with aurora-cyan-glow) not implemented

#### Prompt Input (Hero Component) 🔴 0.5/10
**Spec:** Double-line border with gradient, inner glow, expanding animation, attachment chips  
**Current:** Functional prompt input exists, no Aurora visual treatment  
**Gap:** This is the most impactful component to Aurora-ify

#### Message Bubbles 🔴 1/10
**Spec:** User (cyan tint + cyan left border) vs Assistant (glass + violet left border)  
**Current:** Messages have basic styling, no color-coded left borders  
**Gap:** Color-coded message differentiation not implemented

#### Dialogs/Modals 🟡 3/10
**Spec:** Glass modal, blurred backdrop, spring entry/exit, 0.95→1.0 scale  
**Current:** Dialogs have backdrop blur, fadeInScale animation, spring-like easing  
**Gap:** Glass effect on modal body missing, timing close but not exact

---

### 2.7 Accessibility (Spec §11) 🟠 25% IMPLEMENTED

| Requirement | Status | Notes |
|------------|--------|-------|
| `prefers-reduced-motion` | 🟡 Partial | Only in `dialog.css`, needs global scope |
| `--max-prose-width: 70ch` | 🔴 Missing | No line-length constraints on chat messages |
| Light mode glass contrast fix | 🔴 N/A | No glass effects to fix yet |
| `cursor: pointer` on interactives | 🟡 Partial | `utilities.css` sets cursor on buttons/links |
| Lucide Icons mandate | ✅ Present | `lucide-solid` is used in the app |
| WCAG 4.5:1 contrast ratios | 🟡 Unverified | Likely OK for existing themes, needs audit for Aurora |
| Touch targets 44x44px | 🟡 Unverified | Needs measurement |

---

## Part 3: Validation Against Design Principles

### 3.1 "Light as Material" — UI elements emit light rather than receive it
**Score: 🔴 0/10**  
No glow effects, no luminous borders, no light-emission metaphor anywhere in current CSS. This is the CORE Aurora identity and is completely missing.

### 3.2 "Depth through Transparency" — Layers visible through glassmorphism
**Score: 🔴 1/10**  
Only dialog backdrop uses blur. No card or surface transparency.

### 3.3 "Confident Motion" — Every animation serves purpose, feels physical
**Score: 🟡 4/10**  
Spring easing exists. Animations are purposeful. But Aurora-specific motion (glow as feedback, breathing pulse) is absent.

### 3.4 "Chromatic Restraint" — Rich palette used sparingly
**Score: 🟡 5/10**  
Existing themes use color sparingly. This principle is about application, not implementation — would be evaluated after Aurora colors exist.

### 3.5 "Unified Language" — Same DNA across Web and TUI
**Score: 🟡 3/10**  
Two separate theme systems exist. No Aurora in either. The existing "opencode" theme in TUI and "oc-1" in Desktop UI are not visually unified.

---

## Part 4: Implementation Roadmap

### Phase 0: Theme Files (Immediate — 1 day)
- [ ] Create `packages/ui/src/theme/themes/aurora.json` — Desktop UI Aurora theme
  - Map Aurora colors to 9 OKLCH seeds
  - Use overrides for exact void background colors (#050508, #0A0A0F, #0F0F14, #14141A, #1A1A22)
  - Use overrides for exact accent colors (cyan #00D4FF, violet #A78BFA, rose #FF6B9D)
- [ ] Create `packages/opencode/src/cli/cmd/tui/context/theme/aurora.json` — TUI Aurora theme
  - Use existing defs+theme format
  - Map all Aurora hex colors to defs, wire semantic tokens
- [ ] Register Aurora in `default-themes.ts` (Desktop) and TUI theme loader
- [ ] Verify theme renders in both Desktop and TUI

### Phase 1: CSS Enhancement Layer (Short-term — 2-3 days)
- [ ] Add `--glass-*` CSS custom properties (subtle, light, medium, strong)
- [ ] Create `.glass-card` utility class (backdrop-blur + rgba + border)
- [ ] Add Aurora glow keyframes (aurora-pulse, aurora-drift)
- [ ] Expand `prefers-reduced-motion` to global scope
- [ ] Add `--max-prose-width: 70ch` for chat message containers

### Phase 2: Component Enhancements (Medium-term — 1 week)
- [ ] Button glow variants (box-shadow on hover/active)
- [ ] Card glass variant
- [ ] Input focus glow (cyan box-shadow)
- [ ] Message bubble color-coded left borders
- [ ] Dialog glass body effect
- [ ] Prompt input hero treatment

### Phase 3: Polish & Accessibility (Ongoing)
- [ ] WCAG contrast audit for Aurora dark + light
- [ ] Touch target audit (44x44px minimum)
- [ ] Full `prefers-reduced-motion` test pass
- [ ] Performance profiling of backdrop-filter effects
- [ ] Cross-browser testing (Safari backdrop-filter quirks)

---

## Part 5: Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| OKLCH seed generation produces wrong shades | 🟡 Medium | Use extensive `overrides` to force exact hex values |
| Glassmorphism performance on low-end devices | 🟠 High | Use `will-change` sparingly, offer "reduce transparency" setting |
| Aurora glow effects look "gaming" if overdone | 🟡 Medium | Keep glow subtle (15% opacity max), review in context |
| Two theme systems diverge visually | 🟡 Medium | Review both side-by-side during implementation |
| `backdrop-filter` not supported in all browsers | 🟢 Low | All modern browsers support it; graceful fallback to solid bg |

---

## Part 6: Conclusions

### What's Good About the Spec
1. **Comprehensive** — Covers colors, typography, spacing, motion, components, TUI translations, accessibility
2. **Practical** — Includes Stitch prompts for prototyping, implementation phases, file touchpoints
3. **Accessibility-aware** — §11 amendments show thoughtful review

### What Needs Updating in the Spec
1. **Token naming must match codebase** — Spec uses `--void-*`, `--aurora-*`; codebase uses `--background-*`, `--surface-*`
2. **Theme format must match codebase** — Spec provides raw CSS; needs translation to seed-based JSON
3. **Two theme systems acknowledged** — Spec should distinguish Desktop UI vs TUI implementations
4. **Typography scale is impractical** — Major Third produces sizes (48.8px, 61px) rarely needed in a code editor

### Bottom Line
**The Aurora vision is strong. The implementation is zero.** The codebase architecture is ready — it just needs the actual theme files created and registered. The glassmorphism/glow effects layer is the biggest new work beyond theme creation.

---

*Review completed: 2025-02-27*  
*Methodology: Frontend-PE systematic design review + Backend-PE architecture verification*  
*Files examined: 60+ across packages/ui, packages/app, packages/opencode*

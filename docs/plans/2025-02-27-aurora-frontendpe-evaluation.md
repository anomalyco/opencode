# 🔬 Aurora Design System — FrontendPE Principal Evaluation

> **Evaluator:** FrontendPE (Distinguished Principal Frontend Engineer)  
> **Date:** 2025-02-27  
> **Documents Reviewed:**  
> - `docs/plans/2025-02-26-aurora-design-system.md` (The Spec)  
> - `docs/plans/2025-02-27-aurora-design-review.md` (Architecture Review)  
> **Codebase:** Branch `prax-dev`, SolidJS + Tauri Desktop App  

---

## Executive Verdict

**The Aurora vision is exceptional. The spec is 85% implementable. 15% needs redesign for the actual codebase architecture.**

The Aurora Design System represents a genuinely distinctive aesthetic direction — "digital luminescence" is a rare and compelling design language that avoids the tired glassmorphism-for-its-own-sake trap. However, the spec was written in isolation from the actual theme infrastructure, creating friction points that need resolution before any code touches production.

---

## Part 1: What Is ABSOLUTELY Feasible (Do This)

### ✅ 1.1 Aurora Theme Files — Both Systems (Effort: 1 day)

**This is the highest-ROI item.** The codebase already has two mature theme systems that are plug-and-play:

**Desktop UI Theme** (`packages/ui/src/theme/themes/aurora.json`):
- 9 OKLCH seed colors map cleanly to Aurora's palette
- Extensive `overrides` can force exact hex values where algorithmic generation drifts
- Registration in `default-themes.ts` is trivial

**Seed Mapping (Aurora → DesktopTheme):**

| Aurora Concept | Seed Slot | Dark Value | Light Value |
|---|---|---|---|
| Void backgrounds | `neutral` | `#0A0A0F` | `#FAFAFA` |
| Electric Cyan | `primary` | `#00D4FF` | `#0891B2` |
| Success Green | `success` | `#4ADE80` | `#16A34A` |
| Amber Warning | `warning` | `#FFBB33` | `#D97706` |
| Error Red | `error` | `#F87171` | `#DC2626` |
| Soft Violet | `info` | `#A78BFA` | `#7C3AED` |
| Cyan (interactive) | `interactive` | `#00D4FF` | `#0891B2` |
| Diff Green | `diffAdd` | `#4ADE80` | `#16A34A` |
| Diff Red | `diffRemove` | `#F87171` | `#DC2626` |

**Override Requirements (exact void scale):**
```json
"overrides": {
  "background-base": "#0A0A0F",
  "background-weak": "#0F0F14",
  "background-strong": "#050508",
  "surface-base": "#14141A",
  "surface-raised-base": "#1A1A22"
}
```

**TUI Theme** (`packages/opencode/src/cli/cmd/tui/context/theme/aurora.json`):
- The spec's Appendix JSON is almost directly usable
- Just needs `$schema` field and dark/light variant wrapping

**Verdict: ✅ DO THIS FIRST. Immediate visual impact with zero risk.**

---

### ✅ 1.2 Glow Box-Shadows on Focus/Hover States (Effort: 0.5 days)

The core Aurora identity — "elements emit light" — is achievable with pure CSS `box-shadow`:

```css
/* Aurora glow system — add to theme.css or a new aurora-effects.css */
[data-theme="aurora"] {
  --glow-cyan: 0 0 20px -5px rgba(0, 212, 255, 0.4);
  --glow-cyan-hover: 0 0 30px -5px rgba(0, 212, 255, 0.5), 0 0 0 4px rgba(0, 212, 255, 0.15);
  --glow-violet: 0 0 20px -5px rgba(167, 139, 250, 0.4);
  --glow-rose: 0 0 20px -5px rgba(255, 107, 157, 0.4);
  --glow-red: 0 0 20px -5px rgba(248, 113, 113, 0.4);
}
```

These are **pure CSS, no JS, no perf cost, no animation frames**. They work on any element:
- Buttons: `box-shadow: var(--glow-cyan)` on hover
- Inputs: `box-shadow: var(--glow-cyan-hover)` on focus
- Cards: `box-shadow: var(--glow-violet)` on hover

**Verdict: ✅ DO THIS. It's the single most impactful Aurora differentiator and costs nothing.**

---

### ✅ 1.3 Color-Coded Message Borders (Effort: 0.5 days)

User messages get a `2px` cyan left border, assistant messages get violet. This is trivial CSS:

```css
[data-theme="aurora"] [data-role="user"] {
  border-left: 2px solid var(--aurora-cyan, #00D4FF);
  background: rgba(0, 212, 255, 0.05);
}

[data-theme="aurora"] [data-role="assistant"] {
  border-left: 2px solid var(--aurora-violet, #A78BFA);
}
```

**Verdict: ✅ DO THIS. Excellent UX improvement — instant visual parsing of who said what.**

---

### ✅ 1.4 Aurora Keyframe Animations (Effort: 0.5 days)

The spec's keyframes are standard CSS and the codebase already has an `animation.css` with similar patterns:

| Aurora Keyframe | Existing Equivalent | Action |
|---|---|---|
| `aurora-fade-in` | `fadeIn` ✅ | Already exists |
| `aurora-scale-in` | `fadeInScale` ✅ | Already exists |
| `aurora-slide-up` | `fadeUp` ✅ | Already exists (5px vs 8px — negligible) |
| `aurora-pulse` | `subtleGlow` 🟡 | Needs cyan color variant |
| `aurora-shimmer` | `shimmer` ✅ | Already exists |
| `aurora-drift` | ❌ Missing | Add — but **disabled by default** |

**Action:** Add `aurora-pulse` (cyan glow breathing) and `aurora-drift` (slow background gradient shift). Both should respect `prefers-reduced-motion`.

**Verdict: ✅ DO THIS. Minimal new CSS, reuses existing animation infrastructure.**

---

### ✅ 1.5 `prefers-reduced-motion` Global (Effort: 0.25 days)

The spec's §11.1 is correct and critical. Currently only `dialog.css` respects this. Needs a global rule:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

**Verdict: ✅ DO THIS. Accessibility requirement, not optional. Apply globally regardless of Aurora.**

---

### ✅ 1.6 `--max-prose-width: 70ch` on Chat Messages (Effort: 0.25 days)

The review correctly identified missing line-length constraints. Chat messages currently expand to full width which hurts readability:

```css
:root {
  --max-prose-width: 70ch;
}

.message-content, .chat-message-body {
  max-width: var(--max-prose-width);
}
```

**Verdict: ✅ DO THIS. UX improvement independent of Aurora — should be global.**

---

## Part 2: What Is FEASIBLE WITH CAVEATS (Do Carefully)

### 🟡 2.1 Glassmorphism Cards (Effort: 1-2 days)

`backdrop-filter: blur()` is supported in all modern browsers and Tauri's WebView. The spec's glass system is sound:

```css
.glass-card {
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: var(--radius-lg);
}
```

**Caveats:**
1. **Performance:** `backdrop-filter` triggers compositing layers. On a chat interface with 50+ messages, each with a glass card = 50+ compositing layers. This WILL cause jank on scroll.
2. **Mitigation:** Apply glass ONLY to:
   - The prompt input (1 element, always visible)
   - Modal dialogs (1 element, overlay)
   - Sidebar (1 element, fixed)
   - **NOT** to every message bubble (use solid `var(--surface-base)` instead)
3. **Tauri WebView:** Uses WebKit on macOS — `backdrop-filter` is well-supported but `will-change: transform` should be set on glass elements.

**Verdict: 🟡 DO THIS SELECTIVELY. Glass on 3-5 fixed elements = premium feel. Glass on every message = scroll jank death.**

---

### 🟡 2.2 Light Theme Aurora (Effort: 1 day)

The spec's light theme is feasible but the review correctly identified contrast issues with glass effects on light backgrounds. The amended §11.3 values are better:

```css
/* Light mode glass needs higher opacity */
--glass-light: rgba(0, 0, 0, 0.06);  /* not 0.04 */
--glass-medium: rgba(0, 0, 0, 0.09); /* not 0.06 */
```

**Caveat:** Light mode Aurora will feel less dramatic than dark mode. The "luminescence" metaphor works naturally in dark mode (bright on dark = glow) but in light mode it's just... accent colors. This is inherent to the concept, not a bug.

**Verdict: 🟡 DO THIS but accept that dark mode is the hero. Light mode is the "professional variant."**

---

### 🟡 2.3 Prompt Input Hero Treatment (Effort: 1-2 days)

The spec's prompt input with double-line gradient border and inner glow is the single most impactful component. This is feasible:

```css
[data-theme="aurora"] .prompt-input-container {
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-lg);
  transition: box-shadow 0.25s cubic-bezier(0.22, 1, 0.36, 1),
              border-color 0.25s cubic-bezier(0.22, 1, 0.36, 1);
}

[data-theme="aurora"] .prompt-input-container:focus-within {
  border-color: var(--aurora-cyan);
  box-shadow:
    0 0 0 4px rgba(0, 212, 255, 0.15),
    0 0 30px -10px rgba(0, 212, 255, 0.3);
}
```

**Caveats:**
1. The spec mentions a "gradient border" (cyan → purple → magenta). CSS gradient borders require the `border-image` hack or a pseudo-element overlay. Both work but add complexity.
2. The "micro-pulse on type" (`scale(1.002x)`) is imperceptible at that magnitude and adds a transform on every keystroke — skip it.
3. The "content slides up on send" animation is a nice touch but needs careful integration with SolidJS's reactivity system.

**Verdict: 🟡 DO THIS. Focus glow + glass background = immediate premium feel. Skip the gradient border and micro-pulse.**

---

### 🟡 2.4 Typography — Font Choices (Effort: 0.5 days)

The spec recommends JetBrains Mono for code. The app already ships 16 Nerd Font variants including JetBrains Mono. Making it the Aurora theme default is a config change, not a code change.

**Caveat:** The Major Third modular scale (10.24, 12.8, 16, 20, 25, 31.25, 39, 48.8, 61px) is overkill for a code editor. The existing 4-size system (13, 14, 16, 20px) is more practical. The spec's hero/display sizes (39px, 48px, 61px) would only be used on a welcome screen — not worth the CSS bloat.

**Verdict: 🟡 Use the existing type scale. Set JetBrains Mono as Aurora's default code font. Don't add display sizes.**

---

## Part 3: What Is NOT FEASIBLE / NOT RECOMMENDED (Don't Do This)

### 🔴 3.1 Animated Aurora Background Drift

The spec describes a "subtle animated gradient aurora" on the background that slowly drifts. The review's §11.1 even flags this as a motion sickness risk.

**Why Not:**
1. **Motion sickness:** Even "very subtle" background animation is distracting for extended coding sessions (hours, not minutes)
2. **Performance:** A full-viewport CSS gradient animation running continuously consumes GPU cycles for zero functional benefit
3. **Battery drain:** On a Tauri desktop app, continuous animation = battery murder
4. **Distraction:** In a tool where you stare at text for hours, ANY background movement fights for attention with code

**Alternative:** Use a **static** gradient on the welcome/empty state screen only. No animation. The void-deep background (#0A0A0F) is beautiful on its own.

**Verdict: 🔴 DO NOT IMPLEMENT. Static dark void > animated distraction. Zero users will miss this.**

---

### 🔴 3.2 WebGL/Shader Effects

The FrontendPE workflow suggests WebGL for "boring DOM" scenarios. This is NOT one of those scenarios:

- OpenCode is a **productivity tool**, not a portfolio site
- WebGL in a Tauri WebView adds memory pressure and GPU contention
- The terminal emulator (ghostty-web/xterm) already needs GPU for text rendering
- Adding shaders would fight with the terminal renderer

**Verdict: 🔴 DO NOT IMPLEMENT. This is a code editor, not a demo reel.**

---

### 🔴 3.3 Parallax / Float Effects on Messages

The spec mentions "elements float with subtle parallax." In a scrolling chat interface:

- Parallax on scroll = nausea trigger for many users
- Transform-based parallax causes layer promotion for every affected element
- With 100+ messages in a session, this means 100+ compositing layers

**Verdict: 🔴 DO NOT IMPLEMENT. Chat messages should be static, scannable blocks.**

---

### 🔴 3.4 Gradient Borders on Everything

The spec uses gradient borders (cyan → purple → magenta) on cards. CSS gradient borders are expensive:

```css
/* The "proper" way — requires extra DOM or pseudo-element */
.gradient-border {
  position: relative;
  background: var(--void-base);
}
.gradient-border::before {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  background: linear-gradient(135deg, #00D4FF, #A78BFA, #FF6B9D);
  z-index: -1;
}
```

**Why Not:**
- Pseudo-element approach requires `overflow: visible` which breaks `backdrop-filter` clipping
- `border-image` doesn't work with `border-radius`
- For every card, you need an extra pseudo-element = double the DOM compositing
- Solid colored borders with glow achieve 90% of the visual impact at 10% of the cost

**Alternative:** Use `border-color: var(--aurora-cyan)` on active/hover states. Single color, no gradient. The glow box-shadow provides the "luminous" feel.

**Verdict: 🔴 DO NOT IMPLEMENT on cards/messages. Reserve gradient border for the prompt input only (1 element, worth the cost).**

---

### 🔴 3.5 Full Spec Token Rename

The spec uses `--void-*`, `--glass-*`, `--aurora-*` naming. The codebase uses `--background-*`, `--surface-*`, `--text-*`. Renaming the entire token system would:

- Break every component in the app
- Create merge conflicts with upstream
- Provide zero user-visible benefit

**Verdict: 🔴 DO NOT RENAME. Map Aurora concepts to existing token names via the theme's `overrides`.**

---

## Part 4: Implementation Priority Matrix

| Priority | Item | Effort | Impact | Risk |
|----------|------|--------|--------|------|
| **P0** | Aurora theme JSON files (Desktop + TUI) | 1 day | 🔥🔥🔥🔥🔥 | Low |
| **P0** | `prefers-reduced-motion` global | 0.25 day | 🔥🔥🔥 (a11y) | None |
| **P1** | Glow box-shadows on focus/hover | 0.5 day | 🔥🔥🔥🔥🔥 | None |
| **P1** | Color-coded message left borders | 0.5 day | 🔥🔥🔥🔥 | None |
| **P1** | `--max-prose-width: 70ch` | 0.25 day | 🔥🔥🔥 | None |
| **P2** | Prompt input hero treatment (glass + glow) | 1 day | 🔥🔥🔥🔥🔥 | Low |
| **P2** | Aurora keyframes (pulse, drift-static) | 0.5 day | 🔥🔥🔥 | Low |
| **P3** | Glassmorphism on sidebar + dialogs | 1 day | 🔥🔥🔥 | Medium |
| **P3** | Light theme variant | 1 day | 🔥🔥 | Low |
| **P3** | JetBrains Mono as Aurora default | 0.25 day | 🔥🔥 | None |
| **SKIP** | Animated aurora background | — | — | High |
| **SKIP** | WebGL/shaders | — | — | Critical |
| **SKIP** | Parallax on messages | — | — | High |
| **SKIP** | Gradient borders on all elements | — | — | Medium |
| **SKIP** | Token rename | — | — | Critical |

---

## Part 5: Total Effort Estimate

| Phase | Items | Days | Cumulative |
|-------|-------|------|------------|
| **Phase 0** | Theme files + a11y global | 1.25 days | 1.25 days |
| **Phase 1** | Glow effects + message borders + prose width | 1.25 days | 2.5 days |
| **Phase 2** | Prompt input hero + keyframes | 1.5 days | 4 days |
| **Phase 3** | Glass on fixed elements + light theme + font | 2.25 days | 6.25 days |

**Total: ~6 working days for a complete, production-grade Aurora implementation.**

This does NOT include:
- QA/cross-browser testing (add 1-2 days)
- Upstream merge conflict resolution (varies)
- TUI-specific component visual adjustments (add 1 day)

---

## Part 6: The Wow Factor

The single most impactful Aurora technique is **glow as interactive feedback**. When every other code editor uses flat shadows or material elevation, Aurora makes elements *radiate*:

```
Other tools:   hover → darken background → feels heavy
Aurora:        hover → emit light → feels alive, weightless, digital
```

This is achieved with ONE CSS property (`box-shadow` with colored, spread, blurred shadows) that:
- Costs zero JS
- Costs near-zero GPU (single compositing operation)
- Works in both Tauri WebView and browsers
- Respects `prefers-reduced-motion` (glow is not motion)
- Is unique — no other code editor does this

**That's the soul of Aurora. Everything else is polish.**

---

## Appendix: Spec Corrections

| Spec Statement | Correction |
|---|---|
| "Create aurora-dark.json and aurora-light.json" | Single `aurora.json` with `light` and `dark` variant objects |
| "Use `--void-*` CSS variables" | Map to existing `--background-*` tokens via overrides |
| "Major Third type scale" | Keep existing 4-size scale (13/14/16/20) |
| "Animated aurora drift on background" | Static gradient on welcome screen only |
| "Glass cards on everything" | Glass on prompt input, sidebar, dialogs only |
| "Spring physics via JS library" | CSS `cubic-bezier(0.22, 1, 0.36, 1)` already matches — no library needed |
| "Gradient borders on cards" | Solid color borders + glow shadows instead |

---

*Evaluation completed: 2025-02-27*  
*Methodology: FrontendPE Principal-level design review with codebase architecture validation*  
*Conclusion: Aurora is a strong, implementable design system. Scope to ~6 days of work by cutting the impractical 15% and focusing on the high-impact 85%.*

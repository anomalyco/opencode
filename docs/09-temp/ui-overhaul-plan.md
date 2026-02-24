# UI/UX Overhaul Plan — OpenCode Desktop

**Date:** 2026-02-24
**Status:** ✅ PHASE 1 COMPLETE

## User Requirements
- UI looks "very bad" — needs visual polish and tactile feel ✅
- More themes and theme customization ✅
- Better UI rendering quality ✅
- Font size ✅ (fixed in PR #14821)
- Zoom in/out ✅ (already works via Cmd+/-/0)
- Wide mode ✅ (added in PR #14835)
- More UI settings options needed (future)

## Phase 1 Changes (Completed)

### 1. Font Rendering (`base.css`)
- Added `-webkit-font-smoothing: antialiased` for crisp text on macOS
- Added `-moz-osx-font-smoothing: grayscale` for Firefox
- Added `text-rendering: optimizeLegibility` for better kerning
- Added `scroll-behavior: smooth` for smooth scrolling

### 2. Animation System (`animations.css`)
- Added CSS custom property easing tokens (`--ease-out-expo`, `--ease-spring`, etc.)
- Added duration tokens (`--duration-instant` through `--duration-slower`)
- Added new keyframes: `fadeIn`, `fadeInScale`, `slideInFromRight/Left/Bottom`
- Added `subtleGlow` for focus states, `shimmer` for loading, `spin`
- Halved stagger delay (50ms instead of 100ms) for snappier text reveals
- Added `prefers-reduced-motion: reduce` media query for accessibility

### 3. Utilities (`utilities.css`)
- Added `::selection` styling with theme-aware color
- Added global transition defaults for all interactive elements
- Added `:focus-visible` ring with theme color
- Added thin scrollbar styling for scroll views
- Suppressed focus ring for components that handle their own

### 4. Shadow/Depth System (`theme.css`)
- Refined `--shadow-xs` with slightly stronger presence
- Added new `--shadow-sm` level for subtle elevation
- Enhanced `--shadow-md` with deeper, more dramatic depth
- Enhanced `--shadow-lg` with softer, more premium feel
- Added new `--shadow-xl` for maximum elevation (modals, floating panels)

### 5. Button Micro-Interactions (`button.css`)
- Added explicit transition for bg-color, border, box-shadow, transform, opacity
- Primary: hover now lifts with `--shadow-sm`, active presses with `scale(0.98)`
- Ghost: icon color transitions on hover, active presses with `scale(0.97)`
- Secondary: hover adds border shadow hint, active presses
- Disabled states now use `opacity: 0.6` for clearer visual feedback

### 6. Card Polish (`card.css`)
- Upgraded border-radius from `--radius-md` to `--radius-lg`
- Added full transition for bg-color, border-color, box-shadow, transform
- Hover state now shows subtle border highlight and `--shadow-xs` elevation

### 7. Dialog Animations (`dialog.css`)
- Overlay now uses `backdrop-filter: blur(4px)` for frosted glass effect
- Overlay opacity increased from 0.2 to 0.35 for better focus
- Content now uses combined `scale(0.96) + translateY(4px)` entrance
- Animation uses `cubic-bezier(0.16, 1, 0.3, 1)` expo-out for premium feel
- Added subtle 1px border ring on dialog content for depth definition
- Overlay entrance/exit now animated separately

### 8. Icon Button Interactions (`icon-button.css`)
- Added explicit transitions for bg-color, box-shadow, transform
- Ghost variant: icon color now transitions on hover (to `--icon-hover`)
- Active state now scales to `0.92` for satisfying tactile press
- Icon SVG color now properly transitions through states
- Disabled state uses `opacity: 0.5`

### 9. New Themes (3 premium additions)
- **Rosé Pine** — Dreamy, soft palette with purple/rose accents. Very popular community theme.
- **Kanagawa** — Japanese-inspired warm palette. Distinctive golden/purple tones based on "The Great Wave."
- **Everforest** — Calming green/earth tones nature-inspired palette. Easy on the eyes for long sessions.

All themes include full light + dark variants with seeds, borders, surfaces, text, syntax highlighting, and markdown colors.

## Files Modified
- `packages/ui/src/styles/base.css` — Font rendering
- `packages/ui/src/styles/animations.css` — Animation system
- `packages/ui/src/styles/utilities.css` — Selection, focus, transitions, scrollbars
- `packages/ui/src/styles/theme.css` — Shadow system
- `packages/ui/src/components/button.css` — Button interactions
- `packages/ui/src/components/card.css` — Card polish
- `packages/ui/src/components/dialog.css` — Dialog animations
- `packages/ui/src/components/icon-button.css` — Icon button interactions
- `packages/ui/src/theme/themes/rosepine.json` — NEW
- `packages/ui/src/theme/themes/kanagawa.json` — NEW
- `packages/ui/src/theme/themes/everforest.json` — NEW
- `packages/ui/src/theme/default-themes.ts` — Theme registration

## Build Status
✅ `vite build` passes with zero errors (7.98s)

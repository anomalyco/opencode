# Bejazzle Progressive Mode - SAVED WORK

**Date:** November 12, 2025  
**Issue:** Layout was broken by transform animations with !important  
**Solution:** Removed all layout-breaking animations, kept only gradient spotlight + retina fonts

---

## What We KEPT (222 lines)

### 1. **Gradient Spotlight Effect** (~130 lines)

Bottom-up gradient on all panels with 5 progressive levels:

- **Level 1**: Barely visible white gradient (0.01 opacity)
- **Level 2**: Subtle blue hint (0.015 blue, 0.025 white)
- **Level 3**: Noticeable blue + green tint (0.03 blue, 0.02 green)
- **Level 4**: Clear color shift (blue → green → gold → white)
- **Level 5**: "Retina cinema display" with breathing animation

**Color Palette:**

- Blue: `#61afef` (rgba(97, 175, 239))
- Green: `#98c379` (rgba(152, 195, 121))
- Gold: `#e5c07b` (rgba(229, 192, 123))
- White: `#ffffff` (rgba(255, 255, 255))

**Technical Details:**

- Uses `::after` pseudo-element for overlay
- `position: absolute` with `pointer-events: none`
- `z-index: 0` for overlay, children at `z-index: 1`
- Only Level 5 has animation (opacity breathing)

### 2. **Retina Font Rendering** (~90 lines)

Progressive font thinning for high-DPI displays:

- **Level 1**: `font-weight: 400`, `letter-spacing: 0.01em`
- **Level 2**: `font-weight: 350`, `letter-spacing: 0.015em`
- **Level 3**: `font-weight: 300`, `letter-spacing: 0.02em`
- **Level 4**: `font-weight: 275`, `letter-spacing: 0.025em`
- **Level 5**: `font-weight: 250`, `letter-spacing: 0.03em`

**Font Smoothing:**

- `-webkit-font-smoothing: antialiased` (Levels 1-2)
- `-webkit-font-smoothing: subpixel-antialiased` (Levels 3-5)
- `text-rendering: geometricPrecision` (All levels)
- Font features: `kern`, `liga`, `calt`, `ss01`

**Special Cases:**

- Code/pre/monospace: `font-weight: 350` (no letter-spacing)
- Headers: `font-weight: 400` (maintain hierarchy)
- Buttons: `font-weight: 400` (maintain clickability)

---

## What We REMOVED (3300+ lines - BROKE LAYOUT)

### Animations with `transform: translateY()`

```css
/* REMOVED - Broke panel positioning */
body[data-bejazzle="true"] .grid-panel {
  animation: bejazzle-float 6s ease-in-out infinite !important;
}

@keyframes bejazzle-float {
  transform: translateY(-4px) !important; /* ❌ BREAKS LAYOUT */
}
```

### Animations with `transform: scale()`

```css
/* REMOVED - Broke button layout */
body[data-bejazzle="true"] button {
  animation: bejazzle-breathe 4s ease-in-out infinite !important;
}

@keyframes bejazzle-breathe {
  transform: scale(1.02) !important; /* ❌ BREAKS LAYOUT */
}
```

### Input Shimmer with `::before`

```css
/* REMOVED - Broke input positioning */
body[data-bejazzle="true"] textarea::before {
  position: absolute !important;
  animation: bejazzle-shimmer-sweep 8s !important; /* ❌ BREAKS LAYOUT */
}
```

### Rotation Animations

```css
/* REMOVED - Broke spinner layout */
@keyframes bejazzle-slow-spin {
  transform: rotate(360deg) !important; /* ❌ BREAKS LAYOUT */
}
```

### Rounded Corners (All levels)

```css
/* REMOVED - Unnecessary */
body[data-bejazzle="true"][data-bejazzle-level="1"] .grid-panel {
  border-radius: 4px !important;
}
/* ... levels 2-5 with increasing border-radius */
```

---

## WHY IT BROKE

**Root Cause:** `transform` with `!important` overrides inline styles that position panels.

The grid layout uses **inline styles with character-based positioning**:

```tsx
<div style={{ left: `${leftCol}ch`, width: `${width}ch` }}>
```

When CSS applies `transform: translateY(-4px) !important`, it:

1. Overrides the inline positioning
2. Breaks the grid alignment
3. Causes panels to overlap or disappear

**The fix:** Remove ALL transform-based animations.

---

## Bejazzle Context & State Management

### Files Involved

- `/src/context/bejazzle.tsx` - State management
- `/src/components/TerminalViewNew.tsx` - Body attribute binding
- `/src/grid-components/TerminalLayout.tsx` - Toggle handler
- `/src/theme/bejazzle-progressive.css` - Gradient + font styles

### How It Works

1. **State stored in localStorage:**
   - `bejazzle-mode` (boolean)
   - `bejazzle-level` (0-5)
   - `bejazzle-message-count` (number)

2. **Applied via body attributes:**

   ```tsx
   createEffect(() => {
     if (bejazzleMode()) {
       document.body.setAttribute("data-bejazzle", "true")
       document.body.setAttribute("data-bejazzle-level", String(bejazzleLevel()))
     }
   })
   ```

3. **CSS targets body attributes:**
   ```css
   body[data-bejazzle="true"][data-bejazzle-level="1"] .grid-panel::after { ... }
   ```

### Progressive Level-Up System

- **Level 0 → 1**: 3 messages
- **Level 1 → 2**: 6 messages
- **Level 2 → 3**: 10 messages
- **Level 3 → 4**: 15 messages
- **Level 4 → 5**: 25 messages

---

## Current State

✅ **WORKING:**

- Gradient spotlight effect (5 levels)
- Retina font rendering (5 levels)
- Progressive level-up on message count
- Bejazzle toggle in command menu (Ctrl+P)
- State persistence in localStorage
- Body attribute application

❌ **REMOVED (Broke Layout):**

- All transform animations
- Floating panels
- Breathing buttons
- Input shimmer
- Rotation effects
- Rounded corners

---

## Next Steps (If Needed)

If you want to add animations back:

1. **Use opacity/filter only** - Never use transform
2. **Test on small elements first** - Not on layout panels
3. **Avoid `!important`** - Let inline styles win
4. **Test with grid layout** - Ensure no overlap

**Safe animations:**

- `opacity: 0.8 → 1` ✅
- `filter: brightness(1 → 1.1)` ✅
- `box-shadow: 0 → 8px` ✅

**Unsafe animations:**

- `transform: translateY()` ❌
- `transform: scale()` ❌
- `transform: rotate()` ❌
- `position: absolute` on pseudo-elements in grid containers ❌

---

## File Size Comparison

- **Before:** 3500+ lines (120KB)
- **After:** 222 lines (8KB)
- **Reduction:** 93% smaller

---

## Testing Checklist

- [ ] Enable Bejazzle (Ctrl+P → Toggle Bejazzle)
- [ ] Check gradient visible on panels
- [ ] Send 3+ messages, verify level-up
- [ ] Check font gets thinner with each level
- [ ] Level 5: Gradient should breathe (opacity animation)
- [ ] Disable Bejazzle, verify effects disappear
- [ ] Refresh page, verify localStorage persists
- [ ] Check no layout breakage (panels aligned correctly)

---

## Lessons Learned

### 1. **Never use `transform` with `!important` on grid-based layouts**

CSS animations must respect the layout system. When using character-based grid positioning (like `left: 40ch`), any transform will break alignment.

**Alternative approach for future:**

- Use a wrapper div with `position: relative`
- Apply transform to wrapper, not the grid element
- Or: Use filter/opacity effects instead of transform

### 2. **Never set `overflow: hidden` on panels with `!important`** (November 12, 2025)

**Issue:** Setting `overflow: hidden !important` on all panels made content invisible.

**Root Cause:** The panels use `overflow: auto` or `overflow: visible` to show scrollable content. Forcing `overflow: hidden` with `!important` hid all the content inside panels.

**The Fix:** Removed `overflow: hidden !important` from line 14 of bejazzle-progressive.css

**Why it worked before:** The `::after` pseudo-element for the gradient has `pointer-events: none` and `position: absolute`, so it doesn't need the parent to have `overflow: hidden` to work properly.

**Key Rule:** Only set `overflow` properties when absolutely necessary, and never with `!important` on layout containers.

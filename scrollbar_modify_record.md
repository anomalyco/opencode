# Scrollbar Proportional Thumb Fix

> Fix scrollbar thumb always filling the entire track height, making it impossible to gauge scroll position in long conversations.

## Background

The TUI has a vertical scrollbar in the session view, hidden by default. To show it, open the command palette (`Ctrl+P`) and select **"Toggle Session Scrollbar"**.

## Problem

The vertical scrollbar's thumb always filled the entire track height, regardless of content length. This made it impossible for users to visually determine their scroll position within long conversations.

## Root Cause

A bug in `@opentui/core` (<=0.2.12) within `ScrollBarRenderable.updateSliderFromScrollState()`:

1. The method sets `slider.max` (total scroll range) **after** assigning `slider.viewPortSize`.
2. However, the `Slider.set viewPortSize` setter internally clamps the value to `slider.max - slider.min`.
3. Since `slider.max` is still at its initial value (~0) when `viewPortSize` is assigned, the viewport size gets clamped to approximately 0-1.
4. This results in `getVirtualThumbSize()` calculating: `track * (viewPortSize / max)` ≈ `track * (1 / max)` ≈ full track (when max is small) or a tiny sliver, never proportional.

## Fix Location

**File:** `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`  
**Helper function:** `patchScrollbarProportionalThumb()` (line 178, immediately above `Session` component)  
**Invocation:** `ref` callback of `<scrollbox>` (line 1137)

## Fix Details

The patching logic is encapsulated in a standalone helper function `patchScrollbarProportionalThumb(scrollbox)`, called from the scrollbox `ref` callback:

```typescript
ref={(r) => {
  scroll = r
  patchScrollbarProportionalThumb(r)
}}
```

The helper applies two monkey-patches:

### Patch 1: Re-sync `viewPortSize` after state update

```typescript
const origUpdate = bar.updateSliderFromScrollState.bind(bar)
bar.updateSliderFromScrollState = function () {
  origUpdate()
  slider.viewPortSize = Math.max(1, bar._viewportSize)
}
```

After the original `updateSliderFromScrollState` runs (which correctly sets `slider.max`), we re-assign `slider.viewPortSize` from `bar._viewportSize`. Now the clamping in the setter succeeds because `slider.max` already has the correct value.

### Patch 2: Enforce minimum thumb size

```typescript
const origThumb = slider.getVirtualThumbSize
slider.getVirtualThumbSize = function (this: any) {
  const raw: number = origThumb.call(this)
  const track =
    this.orientation === "vertical" ? this.height * 2 : this.width * 2
  if (track <= 0) return raw
  const minSize = Math.max(6, Math.floor(track * 0.1))
  return Math.max(minSize, Math.min(raw, track))
}
```

Ensures the scrollbar thumb is never smaller than 10% of the track or 3 cells (6 half-cells), preventing an invisible thumb in extremely long conversations.

### Visual Enhancement

Changed the scrollbar thumb color from `theme.border` to `theme.primary` (cyan) for better contrast against the track background (`theme.backgroundElement`):

```typescript
verticalScrollbarOptions={{
  paddingLeft: 1,
  visible: showScrollbar(),
  trackOptions: {
    backgroundColor: theme.backgroundElement,
    foregroundColor: theme.primary,
  },
}}
```

## Result

The scrollbar thumb now correctly reflects the viewport-to-content ratio. For example, if a conversation is 10,000 lines and the viewport shows 50 lines, the thumb occupies approximately 0.5% of the track (clamped to at least 10% minimum for visibility), and its position accurately represents the current scroll offset.

## How to Verify

1. Start the TUI with `bun dev` and open or create a session with a long conversation (scroll content significantly exceeds viewport height).
2. Open the command palette (`Ctrl+P`) and select **"Toggle Session Scrollbar"** to make the scrollbar visible.
3. Observe that the cyan thumb size is proportional to viewport/content ratio (small for very long conversations, larger for shorter ones).
4. Scroll up/down and confirm the thumb position moves proportionally along the track.
5. Verify the thumb never becomes invisibly small (minimum 10% of track or 3 cells).

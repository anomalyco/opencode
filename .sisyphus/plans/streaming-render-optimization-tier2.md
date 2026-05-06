# Streaming Render Optimization — Tier 2 Implementation Plan

## Problem Statement

When a user scrolls to a historical turn, IntersectionObserver triggers `setMathSeen(true)`,
causing markdown mode to upgrade from `defer` (no KaTeX) to `full` (with KaTeX). The
morphdom replacement swaps inline math text (~20px) with KaTeX DOM trees (30-70px), producing
a height mutation. The current code has no compensation mechanism for non-streaming mode
upgrades — `view()`/`snap()` are only invoked when `isStreaming=true`. The height change
pushes content below the upgraded turn downward, causing a visible scroll jump for the user.

## Why the Original `minHeight` Locking Plan Was Rejected

The original PRD proposed "two-phase minHeight locking": set `container.style.minHeight`
before morphdom, release it in rAF after morphdom. This approach is **fundamentally flawed**
because:

- `min-height` is a CSS **lower bound**, not a fixed height. When KaTeX content makes the
  container taller than `min-height`, the container expands immediately — the height jump
  is not prevented.
- `minHeight = 20px` with content at 50px → container renders at 50px. No locking occurs.

To truly lock height would require `height + overflow: hidden`, which clips KaTeX content.
The better approach is **synchronous scroll compensation after DOM replacement**, which is
the established pattern in this codebase (see `file.tsx:550-571`).

## Goals

1. **Eliminate scroll jump** when KaTeX mode upgrades from `defer` to `full`
2. **Zero visual regression**: streaming path, scroll-to-bottom, message jumping unchanged
3. **Follow existing patterns**: use the `preserve()` pattern from `file.tsx`
4. **Synchronous compensation**: fix scroll position in the same microtask as DOM replacement

## Change: Synchronous Scroll Compensation on Mode Upgrade

**File**: `packages/ui/src/components/markdown.tsx`
**Type**: Edit (html() createEffect, ~30 lines modified)
**Risk**: Low (extends existing view/snap pattern, non-streaming path was previously uncovered)

### Current State (lines 819-979)

The `createEffect` that handles html() changes currently only captures scroll state when
`isStreaming=true`:

```typescript
const pane = isStreaming ? view(container) : null
const before = isStreaming ? snap(pane) : undefined
```

And in `done()`:

```typescript
if (isStreaming && before) {
  const after = snap(pane)
  // ... scroll jump detection/warning only, no compensation
}
```

There is **no** scroll state capture or compensation for non-streaming mode upgrades
(e.g., KaTeX `defer → full` triggered by IntersectionObserver).

### Change

#### 1. Track "DOM-committed mode" for upgrade detection

Add a persistent variable inside the component scope (after line 722) to track the mode
that was last committed to DOM, so we can detect upgrades reliably:

```typescript
let domMathMode: "full" | "defer" | undefined
```

#### 2. Extend state capture to cover mode upgrades

Replace lines 835-838 with:

```typescript
const isStreaming = local.streaming
const chunked = local.chunked

// Detect mode upgrade: non-streaming, previously rendered with defer, now rendering full
const upgrading = !isStreaming && domMathMode === "defer"
  && src()?.math === "full"

const pane = (isStreaming || upgrading) ? view(container) : null
const before = (isStreaming || upgrading) ? snap(pane) : undefined
const upgradeHeight = upgrading && pane ? container.offsetHeight : 0
const upgradeBox = upgrading && pane ? container.getBoundingClientRect() : undefined
const paneBox = upgrading && pane ? pane.getBoundingClientRect() : undefined
```

**Design rationale**:

- `upgrading` uses `domMathMode` (the last committed math mode) rather than `mode()` directly,
  because `html()` is a resource result — by the time it resolves, `mode()` may have changed
  again. `src()?.math` is the math mode that produced this specific html content.
- `upgradeHeight`: container height before DOM replacement, used to compute delta after.
- `upgradeBox`: container position before replacement, used to determine if the turn is
  above the viewport (deserves compensation).
- `paneBox`: viewport position, used for the "above viewport" check.

#### 3. Add synchronous compensation in done()

Extend the `done()` function (after line 887) with:

```typescript
if (upgrading && pane && upgradeBox && paneBox && upgradeHeight) {
  const delta = container.offsetHeight - upgradeHeight
  if (delta > 0 && upgradeBox.bottom <= paneBox.top) {
    pane.scrollTop += delta
  }
}
```

Then at the end of `done()`, record the committed math mode:

```typescript
// Record the math mode that produced this DOM state
domMathMode = src()?.math
```

**Design rationale**:

- **Synchronous**: Compensation happens in the same microtask as `morphdom` completion,
  before the browser paints. No intermediate frame with wrong scroll position.
- **`delta > 0`**: Only compensate when content grew (KaTeX is taller than source text).
  If content shrinks (unlikely but safe), no compensation needed.
- **`upgradeBox.bottom <= paneBox.top`**: Only compensate when the upgraded turn is
  **entirely above the viewport**. This is the safe case — the user doesn't see this turn,
  but its growth pushes visible content downward. Compensating `scrollTop` keeps the visible
  content in place.
- **Partially visible turns are NOT compensated**: When a turn is partially in the viewport,
  its KaTeX expansion is visible to the user. Compensating the full delta would make the
  visible content scroll upward, which feels worse than the natural content expansion.
- **Uses `upgradeBox` (pre-replacement position)**: The before-replacement bounding rect
  is the correct basis for the "above viewport" check. After replacement, the height change
  may shift the bounding rect, making the condition unreliable.

#### 4. Also set domMathMode on initial render

In the `done()` function, ensure `domMathMode` is initialized on first render too.
If `domMathMode === undefined` (first render), it's not an upgrade, so no compensation,
but we still need to record the mode:

```typescript
// At the very end of done(), after all other logic:
domMathMode = src()?.math
```

This naturally handles the first-render case since `upgrading` requires
`domMathMode === "defer"`, which is false when `domMathMode === undefined`.

### Complete Modified done() Function

```typescript
const done = (mode: string) => {
  const took = performance.now() - time
  container.dataset.html = content

  if (took > DOM_WARN_MS) {
    console.warn("[markdown] slow dom", {
      key: local.cacheKey ?? "",
      mode,
      streaming: isStreaming,
      text: local.text.length,
      prev: prevHtml.length,
      next: content.length,
      nodes: container.childNodes.length,
      took: Math.round(took),
    })
  }

  // Streaming scroll jump detection (unchanged)
  if (isStreaming && before) {
    const after = snap(pane)
    if (after) {
      const jump = after.top - before.top
      const shrink = after.height - before.height
      if (jump < -24) {
        console.warn("[markdown] scroll jump", {
          key: local.cacheKey ?? "",
          mode,
          jump,
          grow: shrink,
          htmlPrev: prevHtml.length,
          htmlNext: content.length,
          text: local.text.length,
          before,
          after,
        })
      }
    }
  }

  // NEW: Mode upgrade scroll compensation
  if (upgrading && pane && upgradeBox && paneBox && upgradeHeight) {
    const delta = container.offsetHeight - upgradeHeight
    if (delta > 0 && upgradeBox.bottom <= paneBox.top) {
      pane.scrollTop += delta
    }
  }

  // Copy button setup (unchanged)
  if (copySetupTimer) clearTimeout(copySetupTimer)
  copySetupTimer = setTimeout(() => {
    if (!live || !container.isConnected) {
      console.debug("[markdown] skip stale copy setup", {
        key: info.key,
        text: info.text,
      })
      return
    }
    if (copyCleanup) copyCleanup()
    copyCleanup = setupCodeCopy(container, next)
    setLabels(container, next)
  }, 150)

  // NEW: Record committed math mode
  domMathMode = src()?.math
}
```

### Behavior Matrix

| Scenario | Compensation |
|----------|-------------|
| Streaming, text growth | Existing detection only (no compensation) — unchanged |
| Non-streaming, first render | No compensation (domMathMode undefined, not "defer") |
| Non-streaming, defer→full, turn above viewport | `pane.scrollTop += delta` — compensated |
| Non-streaming, defer→full, turn partially visible | No compensation — natural expansion |
| Non-streaming, defer→full, turn fully in viewport | No compensation — natural expansion |
| Non-streaming, defer→full, turn below viewport | No compensation — user won't see it |
| Non-streaming, same-mode update (e.g. text edit) | `upgrading=false` — no compensation path |
| KaTeX renders but height decreases | `delta <= 0` — no compensation |

### Interaction with Tier 1

Tier 1's `content-visibility: auto` (`turn-content-skip` class) reduces the **frequency**
of KaTeX upgrades by skipping layout/paint for off-screen turns. However, it does NOT
guarantee that IntersectionObserver won't fire for off-screen turns — the element still
has a placeholder box, and `rootMargin: 200px` may still trigger the observer.

Tier 2 handles the **residual** KaTeX upgrades that do occur, regardless of whether
content-visibility is active. The two tiers are independent and complementary.

---

## Edge Cases & Mitigations

| Edge Case | Mitigation |
|-----------|------------|
| `view(container)` returns null (no scroll parent) | `pane` is null → `upgrading` capture skipped → no compensation |
| `container.offsetHeight` is 0 before upgrade | `upgradeHeight` is 0 → `delta > 0` still works (height becomes positive) |
| Multiple turns upgrade in same frame | Each Markdown instance independently compensates its own delta |
| User is scrolled to bottom when upgrade occurs | If upgraded turn is above viewport → compensation preserves current view; if at bottom → `isAtBottom` logic in timeline handles follow |
| Font loading causes KaTeX to resize after first render | Second resize handled by ResizeObserver → turnHeights → scheduleWindow. Tier 2 only covers synchronous first-replacement. |
| `src()?.math` returns undefined | `upgrading` condition requires `=== "full"`, undefined fails → no compensation |
| Fast scrolling: mode changes multiple times before html resolves | `domMathMode` records the last committed mode, not the transient memo value. Each html result carries its own `src().math`. |
| `isStreaming` becomes true during an upgrade | `upgrading` requires `!isStreaming`, so mixed state is skipped. Streaming path has its own handling. |

---

## Verification Plan

**Tool**: Desktop app (`bun dev:desktop`, open `http://localhost:4444`)

### Mode upgrade compensation
- **Tool**: Desktop app, session `ses_222c3a1f3ffeKdZxmCyui1E189` (149 messages / 2855 parts, contains math)
- Scroll to a position where historical math turns are above the viewport
- Open DevTools Performance panel, record a 5-second trace
- Scroll up slowly to trigger IntersectionObserver on historical math turns
- **Expected**: visible content does NOT shift downward when math turns upgrade
- **Without fix**: visible content jumps down by the KaTeX height delta (~30-50px per turn)
- **With fix**: `scrollTop` is compensated, visible content stays in place
- **Confirm via DevTools**: search console for `[markdown] scroll jump` warnings — should NOT appear for non-streaming upgrades

### No regression on streaming
- **Tool**: Desktop app, start a new streaming conversation with math content
- Send a prompt that triggers long streaming output containing LaTeX
- **Expected**: scroll-to-bottom auto-follows as before
- **Expected**: `[timeline] slow mutation scroll` warnings may still appear but no new ones
- **Expected**: append/morph DOM paths unchanged — no `[markdown] non-prefix morph` warnings

### Partially visible turn
- **Tool**: Desktop app, same long session with math
- Scroll so a math turn is partially visible at the top of viewport (about 50% clipped)
- Wait for KaTeX to render (watch DOM mutation via DevTools Elements panel)
- **Expected**: turn expands in place, no `scrollTop` compensation applied
- **Confirm**: the visible portion of the turn grows downward, content above stays stable

### Performance
- **Tool**: DevTools Performance panel
- Compensation is synchronous (no rAF, no setTimeout)
- `getBoundingClientRect()` and `offsetHeight` are cheap reads after morphdom
- Record a trace during mode upgrade: confirm no layout thrashing
- **Expected**: single layout pass after morphdom + compensation, no forced reflow loop

---

## Non-Goals (Out of Scope)

- Height locking/clipping during upgrade (would require `height + overflow: hidden`)
- Partial-visibility proportional compensation (complex, diminishing returns)
- Font-load-induced secondary height changes (ResizeObserver handles this)
- `overflow-anchor: auto` as primary fix (conflicts with existing manual scroll management)
- Tier 3: session/project switching optimization

---

## References

- Established pattern: `packages/ui/src/components/file.tsx:550-571` — `preserve()` function
- Key source: `packages/ui/src/components/markdown.tsx:819-979` — html() effect
- Mode chain: `markdown.tsx:650-656` — `mathReady()`, `mode()` memos
- IntersectionObserver: `markdown.tsx:788-816` — math observer
- Tier 1 plan: `.sisyphus/plans/streaming-render-optimization-tier1.md`
- Oracle review session: `ses_2026810b1ffeCCZOEpNDuvf4GO`

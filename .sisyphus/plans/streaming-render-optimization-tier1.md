# Streaming Render Optimization — Tier 1 Implementation Plan

## Problem Statement

During streaming text generation (`isWorking()=true`), the message timeline renders ALL turns without windowing. With 149 messages / 2855 parts, every 16ms SSE flush triggers:
1. Layout/paint for all 149 turns
2. MutationObserver with `subtree:true + characterData:true` observing the entire `contentRef`
3. `scrollTop = scrollHeight` forced reflow on every DOM change
4. ResizeObserver measuring every TimelineItem

This causes severe UI lag or complete unresponsiveness.

## Goals

1. **Reduce layout/paint cost** during streaming: skip rendering for inactive (non-eager) turns
2. **Reduce unnecessary MutationObserver callbacks**: only observe the active turn's DOM subtree
3. **Zero visual regression**: scroll position, scroll-to-bottom, message jumping, and session switching must behave identically to current

## Existing Conditions (Already Verified, No Change Needed)

| Condition | Location | Status |
|-----------|----------|--------|
| `overflow-anchor: none` | `scroll-view.css:11` — `.scroll-view__viewport` | ✅ Present |
| `overflow-anchor: none` | `session-turn.css:34` — `[data-slot="session-turn-message-container"]` | ✅ Present |
| `contain: layout style paint` | `scroll-view.css:4` — `.scroll-view` | ✅ Present |
| `contain: layout style paint` | `session-turn.css:9` — `[data-component="session-turn"]` | ✅ Present |
| `content-visibility: auto` (no intrinsic-size) | `message-part.css:2` — `[data-component="assistant-message"]` | ✅ Present (always-on, different DOM level) |
| `estimatedTurnHeight = 680` | `message-timeline.tsx:57` | ✅ Present |
| `eager()` memo | `message-timeline.tsx:1611` — `active() \|\| index >= length - 3` | ✅ Present |
| `activeMessageID()` memo | `message-timeline.tsx:724` | ✅ Present |

---

## Change 1: CSS Utility Class

**File**: `packages/ui/src/styles/utilities.css`
**Type**: Append (end of file, +6 lines)
**Risk**: Very Low (CSS degradation-safe)

### Current State

File ends at line 140 with `.backdrop-blur-2xl { ... }`. No `content-visibility` or `turn-content-skip` rules exist.

### Change

Append after line 140:

```css
/* Streaming optimization: skip rendering for off-screen inactive turns
   while preserving box model so scrollHeight / sticky positioning unchanged */
.turn-content-skip {
  content-visibility: auto;
  contain-intrinsic-size: auto 680px;
}
```

### Design Rationale

- `content-visibility: auto`: Browser skips layout/paint/compositing for off-screen elements. Box model (scrollHeight, offsetHeight, getBoundingClientRect) preserved. Standard since Sep 2024 (Chrome 85+, Safari 15.4+).
- `contain-intrinsic-size: auto 680px`: The `auto` keyword is critical — after first render, browser caches the real measured height and uses it on subsequent scroll-away events, eliminating scrollbar jitter. 680px matches `estimatedTurnHeight` constant at message-timeline.tsx:57.
- Firefox: Property ignored → graceful degradation (behavior identical to current).

---

## Change 2A: Conditional Class on TimelineItem

**File**: `packages/app/src/pages/session/message-timeline.tsx`
**Type**: Edit (TimelineItem function, ~5 lines modified)
**Risk**: Low (uses existing memos, non-destructive)

### Current State (lines 1696-1714)

```typescript
    return (
      <div
        ref={(el) => {
          stop?.()
          rootRef = el
          el.addEventListener("mousedown", onLinkDown, { capture: true })
          el.addEventListener("click", onLink, { capture: true })
          stop = () => { ... }
        }}
        id={props.anchor(item.messageID)}
        data-message-id={item.messageID}
        classList={{
          "min-w-0 w-full max-w-full": true,
        }}
        style={itemStyle(props.centered)}
      >
```

### Change

Add `skipRender` memo before the return (after existing `eager`/`highlight`/`math` memos at lines 1611-1616), then add classList entry:

```typescript
    // Streaming: skip rendering for inactive turns with content-visibility
    const skipRender = createMemo(() => isWorking() && !eager())

    return (
      <div
        ref={(el) => { ... }}
        id={props.anchor(item.messageID)}
        data-message-id={item.messageID}
        classList={{
          "min-w-0 w-full max-w-full": true,
          "turn-content-skip": skipRender(),
        }}
        style={itemStyle(props.centered)}
      >
```

### Design Rationale

- `skipRender = isWorking() && !eager()`: Only activates during streaming AND only for non-eager turns. Eager turns = active turn + last 3 turns (from `eager()` at line 1611).
- When streaming ends: `isWorking()` → false → `skipRender()` → false → class auto-removed → all turns restore full rendering.
- Session switch / message jump: target turn becomes `active` → `eager()` → true → `skipRender()` → false → normal rendering.
- The outer div's `ref` callback and event listeners still run — only the visual rendering of the subtree is deferred.

### Behavior Matrix

| Scenario | TimelineItem div classList |
|----------|---------------------------|
| Streaming, active turn (being generated) | No `turn-content-skip` |
| Streaming, last 3 turns | No `turn-content-skip` |
| Streaming, older historical turns | `turn-content-skip` applied |
| User scrolls to a skipped turn | Browser auto-restores rendering (seamless) |
| Streaming ends | All `turn-content-skip` removed |
| Session switch → jump to message | Target becomes eager → no skip |
| Firefox | `content-visibility` ignored → normal rendering |

---

## Change 2B: MutationObserver Target Narrowing

**File**: `packages/app/src/pages/session/message-timeline.tsx`
**Type**: Edit (existing createEffect at lines 676-722, ~15 lines modified)
**Risk**: Low (three-tier fallback, non-destructive)

### Current State (lines 676-722)

```typescript
  createEffect(() => {
    const body = contentRef
    if (!body) return
    if (!isWorking()) return
    if (!props.live && !props.scroll.bottom) return

    let queued = false
    const flush = () => {
      queued = false
      mutationFrame = undefined
      const root = viewport
      if (!root) return
      if (!isWorking()) return
      if (!props.live && !props.scroll.bottom) return
      const time = performance.now()
      root.scrollTop = root.scrollHeight
      props.onScheduleScrollState(root)
      const took = performance.now() - time
      if (took > SCROLL_WARN_MS) {
        console.warn("[timeline] slow mutation scroll", {
          height: Math.round(root.scrollHeight),
          top: Math.round(root.scrollTop),
          took: Math.round(took),
        })
      }
    }
    const schedule = () => {
      if (queued) return
      queued = true
      mutationFrame = requestAnimationFrame(flush)
    }

    const observer = new MutationObserver(schedule)
    observer.observe(body, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    onCleanup(() => {
      observer.disconnect()
      if (mutationFrame === undefined) return
      cancelAnimationFrame(mutationFrame)
      mutationFrame = undefined
      queued = false
    })
  })
```

### Change

Keep the guard checks, flush, and schedule functions identical. Only change the target resolution and observer.observe call:

```typescript
  createEffect(() => {
    const body = contentRef
    if (!body) return
    if (!isWorking()) return
    if (!props.live && !props.scroll.bottom) return

    let queued = false
    const flush = () => {
      queued = false
      mutationFrame = undefined
      const root = viewport
      if (!root) return
      if (!isWorking()) return
      if (!props.live && !props.scroll.bottom) return
      const time = performance.now()
      root.scrollTop = root.scrollHeight
      props.onScheduleScrollState(root)
      const took = performance.now() - time
      if (took > SCROLL_WARN_MS) {
        console.warn("[timeline] slow mutation scroll", {
          height: Math.round(root.scrollHeight),
          top: Math.round(root.scrollTop),
          took: Math.round(took),
        })
      }
    }
    const schedule = () => {
      if (queued) return
      queued = true
      mutationFrame = requestAnimationFrame(flush)
    }

    // Locate the active turn's DOM element, observing only its subtree
    const activeID = activeMessageID()
    let target: Element = body
    if (activeID) {
      const key = typeof CSS === "undefined" ? activeID : CSS.escape(activeID)
      const el = body.querySelector(`[data-message-id="${key}"]`)
      if (el) target = el
      else if (body.lastElementChild) target = body.lastElementChild
    }

    const observer = new MutationObserver(schedule)
    observer.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    onCleanup(() => {
      observer.disconnect()
      if (mutationFrame === undefined) return
      cancelAnimationFrame(mutationFrame)
      mutationFrame = undefined
      queued = false
    })
  })
```

### Design Rationale

- **Target resolution** (new): Locates the active message's DOM element via `[data-message-id]` attribute query. Reads `activeMessageID()` (a createMemo) which establishes reactive dependency — effect auto-re-executes when active message changes.
- **CSS.escape**: Handles messageIDs containing special characters (colons, underscores commonly found in UUID-like IDs).
- **Three-tier fallback**:
  1. `body.querySelector('[data-message-id="..."]')` — exact match for active turn
  2. `body.lastElementChild` — latest rendered message when querySelector fails (e.g., DOM not yet rendered)
  3. `body` (contentRef) — full tree, identical to current behavior (extreme edge case)
- **subtree: true** scope: Now only covers the active turn's subtree (~1 turn) instead of all 149 turns. Historical turn Shiki/KaTeX completions, tool state updates, and ResizeObserver-triggered layout changes no longer fire the MutationObserver callback.
- **Behavior preserved**: flush and schedule functions are byte-identical to current. Scroll lock triggers only for active turn content growth (correct behavior).

### Behavior Comparison

| DOM Change Source | Before (body subtree:true) | After (target subtree:true) |
|---|---|---|
| Active turn markdown text growth | Triggers MO | Triggers MO (correct) |
| Historical turn Shiki highlight complete | Triggers MO (unnecessary) | Does NOT trigger |
| Historical turn KaTeX render complete | Triggers MO (unnecessary) | Does NOT trigger |
| Historical turn tool status update | Triggers MO (unnecessary) | Does NOT trigger |
| Historical turn ResizeObserver reflow | Triggers MO (unnecessary) | Does NOT trigger |

### Reactivity Note

Since `activeMessageID()` is read inside the effect body, SolidJS automatically tracks it as a dependency. When the active message changes during streaming (e.g., new chunk completes, new message becomes active), the effect re-executes: `onCleanup` disconnects the old observer, a new observer is created pointing to the new target. This is SolidJS standard behavior — no manual cleanup needed.

---

## Edge Cases & Mitigations

| Edge Case | Mitigation |
|-----------|------------|
| `activeMessageID()` returns undefined | Effect skips target resolution, uses `body` as target |
| Query for active turn returns null (not yet in DOM) | Falls back to `body.lastElementChild`, then `body` |
| MessageID contains `:` or special chars | `CSS.escape()` sanitizes for querySelector |
| Firefox no content-visibility support | Property ignored, rendering unchanged — graceful degradation |
| `contain-intrinsic-size: 680px` far from actual height | `auto` keyword caches real height after first render; subsequent off-screen estimates use cached value |
| Streaming ends while MO callback is queued | `flush()` guards check `!isWorking()` and return early; `onCleanup` cancels pending rAF |
| Session switch during streaming | Both `isWorking()` and `sessionSwitching()` change → effect re-executes with new guards |
| `content-visibility: auto` with `position: sticky` children | Box model preserved; sticky positioning calculation unaffected (verified: CSS Containment Level 2 spec) |
| ResizeObserver on TimelineItem coexisting with content-visibility | When content-visibility skips rendering, ResizeObserver does NOT fire callbacks (no actual layout occurs). When user scrolls element into viewport, browser restores rendering → ResizeObserver fires → turnHeights updated. This is correct behavior. |

---

## Verification Plan

### Change 1 (CSS class exists)
- Open DevTools → Elements → check `<style>` or CSS panel for `.turn-content-skip` rule

### Change 2A (conditional class application)
- Start streaming conversation
- Inspect DOM: non-eager TimelineItem divs have `turn-content-skip` class
- Inspect DOM: active turn + last 3 TimelineItem divs do NOT have class
- After streaming completes: no TimelineItem div has `turn-content-skip` class

### Change 2B (MO scope narrowed)
- Start streaming conversation
- Check console: historical turn content changes (e.g., Shiki highlight completing) should NOT trigger `[timeline] slow mutation scroll`
- Active turn text growth should STILL trigger the scroll lock
- Scroll-to-bottom behavior unchanged

### Performance
- Performance panel: Record streaming session, compare Layout/Paint timings
- Before: 30-100ms/frame (estimated for 149 messages)
- Target: <16ms/frame for layout work
- Verify no scroll jumping or content flickering during streaming

---

## Non-Goals (Out of Scope)

- Enabling full virtualization (windowed start/end) during streaming (requires separate height estimation fixes)
- KaTeX height pre-compensation for defer-to-full upgrades (Tier 2)
- turnHeights persistence across session switches (Tier 3)
- Event-driven sessionSwitching replacement (Tier 3)
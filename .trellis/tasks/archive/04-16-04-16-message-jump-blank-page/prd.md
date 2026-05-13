# Fix Message List Jump And Blank Page Issues In Long Conversations

## Problem Statement

Long conversation sessions in `packages/app/src/pages/session/message-timeline.tsx` have two related regressions:

1. **Blank page after switching sessions**
   - Switching from one long session to another can render a large blank area or effectively blank page.
   - The issue appears during virtualized timeline recalculation after session switch.

2. **Message list jump stops working after switching away and back**
   - In the session header, the user-message jump popover initially works.
   - After jumping to an early message, switching to another session, then switching back, the popover may show more items than before.
   - Clicking these newly visible items does nothing.
   - Console logs show the target DOM node is not found after retries.

## Reproduction

### Bug 1: Blank page on session switch

1. Open a long conversation such as `04-13-wolfram-persistent-kernel...`
2. Switch from another long session such as `持久化 session 性能基准研究`
3. Observe large blank area / blank page in the timeline

### Bug 2: Jump list becomes non-functional

1. Open `04-13-wolfram-...`
2. Open the header user-message jump list
3. Initially only part of the historical user messages are listed
4. Click an early item; viewport jumps near the `加载更早的消息` threshold
5. Switch to another session
6. Switch back to `04-13-wolfram-...`
7. Open the jump list again
8. More items are now visible in the list
9. Click one of these items
10. Nothing happens

## Observed Evidence

### Evidence for blank page bug

Representative logs:

```text
[buildWindow] ... total=26 → start=26 end=27
[syncWindow] adjusted window ... inputStart=26 inputEnd=27 → start=0 end=27
[captureWindowAnchor] found ... top=-92712.00
```

Key signals:
- Virtualization computed an out-of-range window (`start=26 end=27` for only 26 messages)
- Anchor position could become abnormally negative during session switch
- Height estimation and DOM timing were inconsistent during switch

### Evidence for jump bug

Representative logs from failed click:

```text
[visibleRendered] windowed: total=26 window=[25,26] visible=1
[scrollToMessage] called: messageId=msg_d911970420018ICyOxwzkGMBrV behavior=auto currentMessageId=undefined
[scrollToMessage] setting active message: messageId=msg_d911970420018ICyOxwzkGMBrV
[seek] element not found, retrying...
[seek] element not found after retries: messageId=msg_d911970420018ICyOxwzkGMBrV
```

Key signals:
- After returning to the session, virtualization collapsed to the tail window (`window=[25,26]`)
- The jump target was not rendered in DOM
- `seek()` retried but could not find the element
- Earlier hypothesis that `activeMessageID()` should pull the target into the window was **not sufficient**

## Current Understanding

### Blank page bug

This is a virtualization consistency bug caused by at least two factors:
- unstable anchor measurement during session switch
- bad estimated window bounds when heights are stale

Temporary mitigations were added:
- abnormal anchor detection
- clamped window bounds
- temporary windowing disable during session switch

These changes reduced risk but need further validation.

### Jump bug

The current failure mode is:
- the jump popover contains messages from `props.renderedUserMessages`
- but the actual DOM is still virtualized to a much smaller tail window
- `navigate(#hash)` / `seek()` expects the target element to already exist in DOM
- the target element is absent, so jump fails silently except for retry logs

This strongly suggests the jump path still lacks a guaranteed way to:
- promote the selected target into the virtualization window before trying DOM lookup, or
- temporarily disable windowing while resolving a jump, or
- coordinate hash-scroll state with timeline virtualization state

## Changes Attempted So Far

### Files touched

1. `packages/app/src/pages/session/message-timeline.tsx`
2. `packages/app/src/pages/session/use-session-hash-scroll.ts`

### Instrumentation added

#### `message-timeline.tsx`
- debug sequence counter
- logs in:
  - `captureWindowAnchor()`
  - `buildWindow()`
  - `syncWindow()`
  - `applyWindow()`
  - `visibleRendered()`
  - `_virtualizationSync`
  - `onScroll`
  - session switch handling

#### `use-session-hash-scroll.ts`
- logs in:
  - `scrollToMessage()`
  - `seek()`
  - auto-load-more effect

### Behavior changes attempted

#### For blank page
- ignore abnormal anchor values
- clamp computed window bounds into valid range
- disable windowing briefly on session switch

#### For jump bug
- attempted to make `activeMessageID()` include pending jumped message when it has no `parentID`
- this did **not** fully resolve the bug

## Likely Root Cause Still Open

The remaining jump bug likely lives in cross-layer coordination between:
- header jump popover selection
- hash-scroll logic in `use-session-hash-scroll.ts`
- `active(sessionMessages())` / `pendingMessage()` semantics
- virtualized render window in `message-timeline.tsx`

Possible concrete issue:
- `pendingMessage()` is not actually the selected jump target in the failing path, so `activeMessageID()` remains ineffective
- or the window recalculation happens too late, after `seek()` has already exhausted retries
- or `navigate(#hash)` updates hash state without ensuring the timeline first materializes the target node

## Next Investigation Directions

1. Trace how `jumpTo(message)` interacts with hash-scroll state end-to-end
   - `jumpTo()` currently does `navigate(#anchor)` only
   - verify whether it should also explicitly set active jump state before hash navigation

2. Inspect `use-session-hash-scroll.ts`
   - understand when `setActiveMessage()` is called on popover click versus hash changes
   - verify whether retries are enough once virtualization is involved

3. Inspect the source of `props.renderedUserMessages`
   - determine why the popover can list more user messages than are currently renderable in DOM
   - check whether this is expected or whether the list should align with virtualized availability

4. Consider a stronger jump contract
   - on selecting a message from the popover, first force virtualization window to include the target
   - only after target enters DOM, perform the actual scroll/hash update

5. Add targeted logs around `jumpTo(message)` and any setter feeding `pendingMessage()`
   - confirm whether selected message ID propagates into timeline state at all

## Testing Checklist

- [ ] Switching between long sessions never shows blank page
- [ ] Jump popover still works before any history switch
- [ ] After switching away and back, popover items still jump correctly
- [ ] Clicking a jump target that is outside current virtualized DOM still succeeds
- [ ] `seek()` no longer exhausts retries for valid message IDs in this scenario
- [ ] No regressions for live/streaming sessions pinned to bottom

## Relevant Files

- `packages/app/src/pages/session/message-timeline.tsx`
- `packages/app/src/pages/session/use-session-hash-scroll.ts`

## Notes

- A trellis task was created to preserve this debugging context because the issue remains unresolved.
- Current debug logs are useful and should not be removed until the bug is fully fixed and verified.

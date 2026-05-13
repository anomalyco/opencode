# Cherry Studio Scroll Research

Date: 2026-04-02

## Scope

Investigated Cherry Studio main chat scroll behavior in:

- `src/renderer/src/pages/home/Messages/Messages.tsx`
- `src/renderer/src/pages/home/Messages/shared.tsx`
- `src/renderer/src/hooks/useScrollPosition.ts`
- `src/renderer/src/pages/home/Messages/ChatNavigation.tsx`
- `src/renderer/src/pages/home/Messages/MessageAnchorLine.tsx`

Repository examined: `https://github.com/CherryHQ/cherry-studio`

## Key Mechanism

Cherry Studio keeps the chat scroll model comparatively simple:

1. The main chat container uses `flex-direction: column-reverse`.
2. The scroll container also uses `column-reverse`.
3. Newest content visually sits at the bottom, but scroll state is inverted:
   - bottom is effectively `scrollTop = 0`
   - older history is reached by moving upward into negative scroll space / reverse layout semantics
4. Upward history loading is delegated to `react-infinite-scroll-component` with `inverse`.
5. Scroll restoration is per-topic and stores only one number: container `scrollTop`.
6. Auto-scroll to latest is explicit and event-driven, not a general resize-driven state machine.

Relevant source points:

- `MessagesContainer` and `ScrollContainer` both use `column-reverse` in `src/renderer/src/pages/home/Messages/shared.tsx`.
- `Messages.tsx` uses `InfiniteScroll inverse` and appends older messages into local display state.
- `scrollToBottom()` in `Messages.tsx` scrolls to `{ top: 0 }`, not `scrollHeight`.
- `useScrollPosition.ts` persists the raw `scrollTop` keyed by topic id and restores it on mount.

## Why It Feels Stable

### 1. Single dominant scroll owner

The main chat pane has one obvious scroll container and one obvious persisted position.

Cherry Studio does not appear to layer these behaviors in the main chat pane:

- history window pin/restore logic
- virtualization flip restoration
- nested turn-level auto-scroll
- hash-target recovery with repeated settle loops
- resize-driven follow-bottom orchestration across multiple layers

That removes many opportunities for conflicting `scrollTop` writes.

### 2. Reverse layout simplifies "follow latest"

Because the list is reversed, following the newest message is just "stay at `top: 0`".

In practice this avoids a lot of bottom math based on:

- `scrollHeight - clientHeight - scrollTop`
- bottom thresholds
- browser `overflow-anchor`
- growth compensation after content height changes

Cherry Studio explicitly documents this in PR #8360: with `column-reverse`, bottom is `0`, not `scrollHeight`.

### 3. Older history loading is structural, not compensatory

Older messages are loaded through `InfiniteScroll inverse` in the reversed container. The implementation does not rely on a custom viewport pinning algorithm like our `hold/snap/restore/keep` loop.

That means fewer layout reads/writes per history expansion.

### 4. Scroll persistence is intentionally shallow

`useScrollPosition.ts` stores one throttled `scrollTop` value per topic key and restores it on topic switch.

This is much narrower than restoring:

- active message id
- hash target
- virtualizer index
- rendered history window start
- pin message and relative viewport offset

Less state means fewer invalid combinations.

### 5. Auto-scroll is event-scoped

Cherry Studio auto-scrolls on explicit events like `SEND_MESSAGE` and some topic operations, rather than on every content resize.

This is important: they are not treating every DOM height change as a reason to reassert follow-bottom.

## Upward History Loading

Cherry Studio does support upward history loading, but the mechanism is simpler than ours:

1. It keeps the full topic message list in state/store.
2. It derives a local `displayMessages` window.
3. It initially renders only a slice.
4. `loadMoreMessages()` appends more older messages into `displayMessages`.
5. `InfiniteScroll inverse` handles the trigger behavior.

Notable detail:

- `computeDisplayMessages()` iterates the source array in reverse and returns a reversed display slice.
- It also preserves grouped assistant/user relationships by counting user ids and assistant `askId`s rather than naively slicing rows.

So they do have a "history window", but it is data-windowing only. They do not combine it with DOM virtualization in the main chat view.

## What Is Worth Learning

### A. Prefer one scroll authority

Main lesson: keep exactly one layer responsible for final `scrollTop` writes.

For OpenCode session view, that suggests:

- page-level scroller owns `scrollTop`
- turn/message components should not independently auto-scroll their own content regions unless they are truly isolated nested scrollers
- history loading, hash navigation, and "jump to latest" should produce intents for the page scroller instead of each writing scroll directly

### B. Separate data windowing from DOM virtualization

Cherry Studio appears to use:

- windowed data in the main chat view
- no main-chat virtualization

That is a strong hint for our bug surface:

- history-window rendering limits can stay
- virtualization in the main session timeline may be the more fragile layer

If stability is the priority, one plausible direction is:

1. keep history slicing
2. drop or heavily constrain main timeline virtualization
3. only reintroduce virtualization with a single, well-defined scroll owner

### C. Use event-driven bottom following, not resize-driven bottom following by default

Cherry Studio mostly scrolls to latest on semantic events:

- send message
- clear/new context cases
- explicit navigation actions

This is cleaner than treating every resize, markdown upgrade, collapse toggle, or streaming DOM mutation as a bottom-follow trigger.

For OpenCode, a useful rule would be:

- content resize alone should not imply "scroll to latest"
- resize should only preserve the current anchor or do nothing
- semantic events decide whether latest-follow should resume

### D. Keep scroll restoration shallow when switching conversations

Cherry Studio persists only per-topic scroll position.

For OpenCode, we may be over-restoring on session switch by mixing:

- pending message targeting
- hash targeting
- rendered turn start
- auto-follow state
- history prefetch state

Likely improvement:

- restore one of either "raw scroll offset" or "message anchor"
- avoid restoring several overlapping representations of the same user position

### E. Be cautious with nested scroll systems

Cherry Studio's main chat flow does not seem to embed another auto-scroll system inside each message turn.

OpenCode currently has both:

- page-level auto-scroll
- turn-level auto-scroll

This is likely one of the biggest sources of fighting behavior.

## What Not To Copy Blindly

### 1. `column-reverse` changes the coordinate system

This simplifies latest-follow, but it also makes many assumptions non-standard:

- bottom is `0`
- upward movement may involve negative `scrollTop` semantics
- top/bottom helpers become less intuitive
- bugs are easy if any code assumes normal flow

This is not a free win.

### 2. Their chat flow appears less feature-dense than ours

OpenCode session view also combines:

- sticky session header/title behavior
- hash deep-linking to specific messages
- message seeking across partially rendered history
- markdown lazy upgrades
- embedded tool outputs
- optional virtualization path

Cherry Studio's simpler model is easier partly because it has fewer simultaneous scroll concerns in the same pane.

### 3. Persisting raw `scrollTop` alone may be insufficient for OpenCode

For plain topic switching it is fine. For OpenCode's hash navigation and session jump flows, we likely still need message-anchor based restoration in some cases.

The lesson is not "store only scrollTop everywhere".

The lesson is "avoid storing multiple overlapping notions of position at the same time unless there is a clear precedence model".

## Suggested Direction For OpenCode

Based on this comparison, the safest simplification path is:

1. Keep one page-level scroll authority.
2. Remove turn-level auto-scroll from the main session timeline.
3. Treat main timeline virtualization as optional, not foundational.
4. Keep history slicing, because it is lower-risk than virtualization.
5. Trigger follow-latest only from semantic events:
   - new outbound prompt
   - explicit jump-to-latest
   - explicit hash clear / return-to-live
6. On passive layout changes:
   - preserve anchor if user is reading history
   - preserve bottom only if already in follow-latest mode
   - otherwise do nothing
7. Define precedence explicitly:
   - hash target / explicit jump
   - user manual scroll position
   - follow-latest

## Concrete Takeaways

- Cherry Studio is stable largely because its scroll model is narrower, not because its compensation logic is more advanced.
- The most transferable idea is reducing the number of systems that can write `scrollTop`.
- The second most transferable idea is preferring data-windowing over virtualization for the main chat pane.
- The third is making auto-follow event-driven instead of resize-driven.

# Session Review Cross-Diff Search Plan

One search input for all diffs in the review pane

---

## Goal

Add a single search UI to `SessionReview` that searches across all diff files in the accordion and supports next/previous navigation across files.

Navigation should auto-open the target accordion item and reveal the active match inside the existing unified `File` diff viewer.

---

## Non-goals

- Do not change diff rendering visuals, line comments, or file selection behavior.
- Do not add regex, fuzzy search, or replace.
- Do not change `@pierre/diffs` internals.

---

## Current behavior

- `SessionReview` renders one `File` diff viewer per accordion item, but only mounts the viewer when that item is expanded.
- Large diffs may be blocked behind the `MAX_DIFF_CHANGED_LINES` gate until the user clicks "render anyway".
- `File` owns a local search engine (`createFileFind`) with:
  - query state
  - hit counting
  - current match index
  - highlighting (CSS Highlight API or overlay fallback)
  - `Cmd/Ctrl+F` and `Cmd/Ctrl+G` keyboard handling
- `FileSearchBar` is currently rendered per viewer.
- There is no parent-level search state in `SessionReview`.

---

## UX requirements

- Add one search bar in the `SessionReview` header (input, total count, prev, next, close).
- Show a global count like `3/17` across all searchable diffs.
- `Cmd/Ctrl+F` inside the session review pane opens the session-level search.
- `Cmd/Ctrl+G`, `Shift+Cmd/Ctrl+G`, `Enter`, and `Shift+Enter` navigate globally.
- Navigating to a match in a collapsed file auto-expands that file.
- The active match scrolls into view and is highlighted in the target viewer.
- Media/binary diffs are excluded from search.
- Empty query clears highlights and resets to `0/0`.

---

## Architecture proposal

Use a hybrid model:

- A **session-level match index** for global searching/counting/navigation across all diffs.
- The existing **per-viewer search engine** for local highlighting and scrolling in the active file.

This avoids mounting every accordion item just to search while reusing the existing DOM highlight behavior.

### High-level pieces

- `SessionReview` owns the global query, hit list, and active hit index.
- `File` exposes a small controlled search handle (register, set query, clear, reveal hit).
- `SessionReview` keeps a map of mounted file viewers and their search handles.
- `SessionReview` resolves next/prev hits, expands files as needed, then tells the target viewer to reveal the hit.

---

## Data model and interfaces

```ts
type SessionSearchHit = {
  file: string
  side: "additions" | "deletions"
  line: number
  col: number
  len: number
}

type SessionSearchState = {
  query: string
  hits: SessionSearchHit[]
  active: number
}
```

```ts
type FileSearchReveal = {
  side: "additions" | "deletions"
  line: number
  col: number
  len: number
}

type FileSearchHandle = {
  setQuery: (value: string) => void
  clear: () => void
  reveal: (hit: FileSearchReveal) => boolean
  refresh: () => void
}
```

```ts
type FileSearchControl = {
  shortcuts?: "global" | "disabled"
  showBar?: boolean
  register: (handle: FileSearchHandle | null) => void
}
```

---

## Integration steps

### Phase 1: Expose controlled search on `File`

- Extend `createFileFind` and `File` to support a controlled search handle.
- Keep existing per-viewer search behavior as the default path.
- Add a way to disable per-viewer global shortcuts when hosted inside `SessionReview`.

#### Acceptance

- `File` still supports local search unchanged by default.
- `File` can optionally register a search handle and accept controlled reveal calls.

### Phase 2: Add session-level search state in `SessionReview`

- Add a single search UI in the `SessionReview` header (can reuse `FileSearchBar` visuals or extract shared presentational pieces).
- Build a global hit list from `props.diffs` string content.
- Index hits by file/side/line/column/length.

#### Acceptance

- Header search appears once for the pane.
- Global hit count updates as query changes.
- Media/binary diffs are excluded.

### Phase 3: Wire global navigation to viewers

- Register a `FileSearchHandle` per mounted diff viewer.
- On next/prev, resolve the active global hit and:
  1. expand the target file if needed
  2. wait for the viewer to mount/render
  3. call `handle.setQuery(query)` and `handle.reveal(hit)`

#### Acceptance

- Next/prev moves across files.
- Collapsed targets auto-open.
- Active match is highlighted in the target diff.

### Phase 4: Handle large-diff gating

- Lift `render anyway` state from local accordion item state into a file-keyed map in `SessionReview`.
- If navigation targets a gated file, force-render it before reveal.

#### Acceptance

- Global search can navigate into a large diff without manual user expansion/render.

### Phase 5: Keyboard and race-condition polish

- Route `Cmd/Ctrl+F`, `Cmd/Ctrl+G`, `Shift+Cmd/Ctrl+G` to session search when focus is in the review pane.
- Add token/cancel guards so fast navigation does not reveal stale targets after async mounts.

#### Acceptance

- Keyboard shortcuts consistently target session-level search.
- No stale reveal jumps during rapid navigation.

---

## Edge cases

- Empty query: clear all viewer highlights, reset count/index.
- No results: keep the search bar open, disable prev/next.
- Added/deleted files: index only the available side.
- Collapsed files: queue reveal until `onRendered` fires.
- Large diffs: auto-force render before reveal.
- Split diff mode: handle duplicate text on both sides without losing side info.
- Do not clear line comment draft or selected lines when navigating search results.

---

## Testing plan

### Unit tests

- Session hit-index builder:
  - line/column mapping
  - additions/deletions side tagging
  - wrap-around next/prev behavior
- `File` controlled search handle:
  - `setQuery`
  - `clear`
  - `reveal` by side/line/column in unified and split diff

### Component / integration tests

- Search across multiple diffs and navigate across collapsed accordion items.
- Global counter updates correctly (`current/total`).
- Split and unified diff styles both navigate correctly.
- Large diff target auto-renders on navigation.
- Existing line comment draft remains intact while searching.

### Manual verification

- `Cmd/Ctrl+F` opens session-level search in the review pane.
- `Cmd/Ctrl+G` / `Shift+Cmd/Ctrl+G` navigate globally.
- Highlighting and scroll behavior stay stable with many open diffs.

---

## Risks and rollback

### Key risks

- Global index and DOM highlights can drift if line/column mapping does not match viewer DOM content exactly.
- Keyboard shortcut conflicts between session-level search and per-viewer search.
- Performance impact when indexing many large diffs in one session.

### Rollback plan

- Gate session-level search behind a `SessionReview` prop/flag during rollout.
- If unstable, disable the session-level path and keep existing per-viewer search unchanged.

---

## Open questions

- Should search match file paths as well as content, or content only?
- In split mode, should the same text on both sides count as two matches?
- Should auto-navigation into gated large diffs silently render them, or show a prompt first?
- Should the session-level search bar reuse `FileSearchBar` directly or split out a shared non-portal variant?

# Markdown And File Preview Research

## Goal

Study why markdown file viewing feels slower than editor baselines, separate source-view costs from preview-view costs, and turn the findings into an implementation plan for markdown, svg, and pdf preview support.

## Research Summary

- The biggest markdown file-view slowdown in the current app is source mode, not preview mode.
- Session file tabs default markdown files to `source` whenever line selection is enabled, and session tabs always enable line selection for comments. See `packages/app/src/pages/session/file-tabs.tsx:399` and `packages/ui/src/components/file.tsx:941`.
- Source mode only virtualizes above `500_000` bytes, so many medium-large markdown files still render the full DOM with selection, comment, hover, and annotation plumbing attached. See `packages/ui/src/components/file.tsx:60` and `packages/ui/src/components/file.tsx:755`.
- Preview mode is expensive for a different reason: full parse goes through markdown normalization, parse, KaTeX work, DOMPurify sanitize, wrapper decoration, and morphdom patching on the main thread. See `packages/ui/src/components/markdown.tsx:487`, `packages/ui/src/components/markdown.tsx:716`, and `packages/ui/src/context/marked.tsx:591`.
- File preview currently supports image, audio, and svg, but not pdf. Svg support is partial and intentionally falls back to source view for the editable/source half. See `packages/ui/src/pierre/media.ts:3`, `packages/ui/src/components/file-media.tsx:225`.
- Desktop still has native markdown parsers in both Tauri and Electron, but the app no longer wires them into `MarkedProvider`, so desktop now always takes the JS parse path. See `packages/app/src/app.tsx:92`, `packages/desktop/src-tauri/src/markdown.rs:40`, and `packages/desktop-electron/src/main/markdown.ts:10`.

## Confirmed Facts

### File Open Architecture

- The shared file viewer entry point is `packages/ui/src/components/file.tsx`.
- Markdown files are detected by extension and routed through `TextViewer` with a preview/source toggle. See `packages/ui/src/components/file.tsx:144` and `packages/ui/src/components/file.tsx:933`.
- In session file tabs, the viewer is always created with `enableLineSelection`, comment annotations, and hover utilities because the session view supports line comments. See `packages/app/src/pages/session/file-tabs.tsx:177` and `packages/app/src/pages/session/file-tabs.tsx:399`.
- Because the initial markdown mode is `source` when `enableLineSelection === true`, markdown files in session tabs do not open on preview first; they open on source first. See `packages/ui/src/components/file.tsx:941`.

### Markdown Source Mode

- Source mode uses the Pierre text viewer path, not the markdown renderer path. See `packages/ui/src/components/file.tsx:739`.
- Virtualization only starts when the file exceeds `500_000` bytes. See `packages/ui/src/components/file.tsx:60` and `packages/ui/src/components/file.tsx:755`.
- Below that threshold, the viewer waits for all `[data-line]` nodes to exist before declaring ready. See `packages/ui/src/components/file.tsx:865`.
- When line selection is enabled, source mode also attaches:
  - mouse selection handlers,
  - selectionchange listeners,
  - commented-line marking,
  - annotation rerendering,
  - hover comment utilities.
- These behaviors live in `useFileViewer`, `useAnnotationRerender`, and `createLineCommentController`. See `packages/ui/src/components/file.tsx:155`, `packages/ui/src/components/file.tsx:481`, and `packages/ui/src/components/line-comment-annotations.tsx:342`.

### Markdown Preview Mode

- Preview mode renders through `packages/ui/src/components/markdown.tsx`.
- Non-streaming preview uses the full parser path immediately. `parseFast` is only used while `streaming` is true. File preview does not pass `streaming`, so file preview always takes the heavy path today. See `packages/ui/src/components/markdown.tsx:511` and `packages/ui/src/components/file.tsx:977`.
- The full path includes:
  - `normalize(markdown)`,
  - parser execution,
  - KaTeX/math rendering,
  - syntax highlighting through `marked-shiki`,
  - `DOMPurify.sanitize`,
  - `wrapCodeBlocks`,
  - `morphdom`,
  - delayed copy-button decoration.
- The hot path is concentrated in `packages/ui/src/components/markdown.tsx:487` and `packages/ui/src/components/markdown.tsx:716`.
- In the JS parser path, syntax highlighting is inside the markdown parse flow via `marked-shiki`, including dynamic language loading. See `packages/ui/src/context/marked.tsx:591`.

### Desktop Parser Status

- `MarkedProvider` still supports a `nativeParser`, but the app does not pass one anymore. See `packages/ui/src/context/marked.tsx:576` and `packages/app/src/app.tsx:92`.
- Tauri still exposes `parse_markdown_command` implemented with `comrak`. See `packages/desktop/src-tauri/src/markdown.rs:40`.
- Electron still exposes a simpler `marked`-based main-process parser. See `packages/desktop-electron/src/main/markdown.ts:10`.
- The current comment in app code says native parsing was removed to fix math rendering issues, so reconnecting native parsing is possible but must preserve the current KaTeX behavior. See `packages/app/src/app.tsx:93`.

### Other Real Preview Consumers

- Message content uses `Markdown` directly, with streaming fast-path support. See `packages/ui/src/components/message-part.tsx:1545` and `packages/ui/src/components/message-part.tsx:1587`.
- System prompt display also uses `Markdown` directly. See `packages/app/src/components/session/session-context-tab.tsx:320`.
- File preview inside the shared file viewer is a separate use case with different constraints and currently no streaming fast-path. See `packages/ui/src/components/file.tsx:977`.

## Main Bottlenecks

### Source Mode Costs

Ranked by likely impact:

1. Full non-virtualized line DOM for markdown files under `500_000` bytes.
2. Session-only comment infrastructure attached by default even when the user only wants to read.
3. Ready gating that waits for full line render in the non-virtualized case.
4. Selected-line and commented-line bookkeeping rerender work layered on top of the base viewer.

Why this matters:

- Editor baselines usually keep markdown source on the same cheap text/editor path they already optimize heavily, with viewport-first rendering.
- OpenCode source mode behaves like a review-capable code viewer even for plain markdown reading.
- The biggest structural mismatch with editor baselines is not markdown parsing here; it is the decision to load the fully interactive reviewable source viewer first.

### Preview Mode Costs

Ranked by likely impact:

1. Shiki highlighting in the full parse path.
2. Full sanitize of the complete HTML string.
3. Full DOM patching through morphdom after parse.
4. Additional decoration passes for code wrappers and copy buttons.
5. KaTeX and math post-processing for markdown containing math.

Why this matters:

- VSCode-style markdown preview typically prioritizes fast first paint and defers or simplifies expensive upgrades.
- OpenCode already has a fast-path design for streaming markdown, but file preview does not use it.
- File preview also keys its cache by `props.file.name`, so same-path updates can still reuse cache only when content hash matches the stored entry. That is correct for reuse, but it does not reduce first-open cost. See `packages/ui/src/components/file.tsx:977` and `packages/ui/src/components/markdown.tsx:495`.

## Hypotheses Re-evaluated

### "Markdown file preview opens on preview mode first"

- False for session file tabs.
- True only for contexts where the shared file viewer is used without line selection.

### "Markdown source comments are the primary slowdown"

- Not fully proven, but they look secondary to the more basic problem that session markdown opens in a fully interactive source viewer first.
- Comment plumbing still adds real overhead and complexity, especially hover and annotation management.
- Removing comments alone would help, but it would not solve the larger cost of non-virtualized full source rendering for medium-large markdown files.

### "Native desktop parsing would help"

- Likely yes for preview mode first paint.
- It would not help source mode.
- It is only worth doing if the math regression that caused removal can be fixed without reintroducing inconsistent output between platforms.

## Recommendation On Markdown Source Comments

- Do not remove markdown source comments outright as the first move.
- First, stop paying their cost by default on the most common read path.
- Recommended product direction:
  - keep markdown source comments,
  - gate them behind explicit source mode or an explicit review interaction,
  - avoid enabling full comment plumbing on initial file open unless the user is clearly in a review flow.

Reasoning:

- Removing comments entirely trades away review capability for a narrower gain than the architecture suggests.
- The larger win is to stop defaulting session markdown open to the most expensive viewer mode.
- After that change, comment removal can be revisited with measurement if source mode is still too slow.

## Preview Capability Matrix

| File type | Current state | Notes | Recommended direction |
| --- | --- | --- | --- |
| Markdown preview | Supported | Heavy full parse path for file viewer | Add fast first paint, then upgrade |
| Markdown source | Supported | Review-capable source viewer; expensive below 500KB | Lower-cost open path and earlier virtualization |
| Images | Supported | Data URL based | Keep |
| Audio | Supported | Data URL based | Keep |
| SVG | Supported partially | Source + image preview combination; falls back to text if svg text exists | Keep dual mode, but make behavior explicit |
| PDF | Not supported in file preview | Currently treated as generic file/binary | Add dedicated pdf preview mode |

## SVG Plan

- Keep svg as a dual-purpose format:
  - source view remains valuable because users often edit svg text,
  - rendered image preview is also valuable for quick inspection.
- The current `FileMedia` behavior is already close to this:
  - if svg text is available, source fallback remains visible,
  - if a data URL is available, an image preview is shown below it.
- Recommended cleanup:
  - make svg an explicit viewer mode rather than a side effect of `FileMedia`,
  - preserve source + preview split,
  - ensure sanitize rules stay strict for markdown, but use image rendering for svg preview instead of inline DOM injection.

## PDF Plan

- Start with a light pdf preview path before introducing `pdf.js`.
- Recommended phase 1:
  - extend `MediaKind` with `pdf`,
  - surface pdf in `mediaKindFromPath`,
  - render via `<iframe>` or `<embed>` for desktop and browser environments that support built-in pdf viewing,
  - keep a fallback state for unsupported environments.
- Recommended phase 2:
  - add `pdf.js` only if built-in preview is inconsistent, too limited, or needed for annotations/search.

Why this order:

- It keeps the first implementation small.
- It avoids shipping a heavy pdf runtime before confirming the product need.
- It matches the current design of `FileMedia`, which is a lightweight preview layer rather than a document editor.

## Phased Optimization Plan

### Phase 1: Fix The Default Open Path

Best cost-to-impact ratio.

- Stop defaulting session markdown files to expensive source mode on open.
- Open markdown in preview by default for plain viewing.
- Only enter source mode automatically when the user explicitly starts a line-selection or comment action.
- If review workflows require source by default in some contexts, gate that to review surfaces instead of all session file opens.

Expected benefit:

- Immediate reduction in perceived open cost for markdown files in sessions.
- Removes the largest architecture mismatch with editor baselines.

Risk:

- Review users may lose one-click line comment behavior on first open unless the transition into source mode is designed carefully.

Code surface:

- `packages/ui/src/components/file.tsx`
- `packages/app/src/pages/session/file-tabs.tsx`

### Phase 2: Make File Preview Use A Fast First Paint

- Reuse the existing `parseFast` idea for file preview, not only streaming message markdown.
- For file preview:
  - first render with fast parse,
  - defer shiki upgrade,
  - skip upgrade for very large files until idle or user interaction.

Expected benefit:

- Faster preview open time without losing final fidelity.

Risk:

- Temporary mismatch between first paint and final highlighted state.

Code surface:

- `packages/ui/src/components/markdown.tsx`
- `packages/ui/src/context/marked.tsx`
- `packages/ui/src/components/file.tsx`

### Phase 3: Lower Source Mode Cost

- Replace byte-only virtualization with a mixed heuristic:
  - byte size,
  - line count,
  - file type.
- Markdown should virtualize earlier than generic code/text because it often contains long wrapped prose lines and large DOM.
- Optionally provide a markdown-specific lightweight source mode without review plumbing until the user requests selection/comments.

Expected benefit:

- Better source open times for medium-large markdown files.

Risk:

- Selection and scroll restoration logic will need careful validation.

Code surface:

- `packages/ui/src/components/file.tsx`
- `packages/app/src/pages/session/file-tabs.tsx`
- `packages/ui/src/components/line-comment-annotations.tsx`

### Phase 4: Re-evaluate Desktop Native Parsing

- Reconnect native desktop parsing only for preview mode first paint.
- Keep current JS/KaTeX behavior as the compatibility reference.
- Validate math output parity before rollout.

Expected benefit:

- Additional desktop preview speedup, especially for large markdown without code blocks.

Risk:

- Cross-platform rendering drift.
- Reintroducing the math bug that caused removal.

Code surface:

- `packages/app/src/app.tsx`
- `packages/ui/src/context/marked.tsx`
- `packages/desktop/src/index.tsx`
- `packages/desktop/src-tauri/src/markdown.rs`
- `packages/desktop-electron/src/main/markdown.ts`

### Phase 5: Expand File Preview Support

- Add pdf preview through `FileMedia`.
- Make svg behavior explicit and polished.
- Consider future video preview only if product demand appears.

Expected benefit:

- Broader file-preview usefulness with modest code surface.

Risk:

- Browser and desktop pdf support differences.

Code surface:

- `packages/ui/src/pierre/media.ts`
- `packages/ui/src/components/file-media.tsx`
- `packages/ui/src/components/file.tsx`

## Recommended First Implementation Slice

Do this first:

1. Change markdown file open behavior in session tabs so plain file open does not force source mode.
2. Add a deliberate transition into source mode when the user starts line selection or comments.
3. Measure perceived open time before and after on representative markdown files.

Why this first:

- It addresses the biggest confirmed architectural mismatch.
- It avoids large parser changes up front.
- It is lower risk than reviving native parsing or rewriting markdown rendering internals.

## Measurement Gaps

- This repo does not contain representative large markdown fixtures outside dependencies, so reliable before/after measurement still needs a small benchmark corpus.
- The next implementation task should add lightweight instrumentation around:
  - time to first visible file paint,
  - time to source ready,
  - time to preview first paint,
  - time to preview highlighted upgrade,
  - line count and byte size of opened markdown files.

## Non-Goals

- Do not redesign the entire file viewer.
- Do not remove markdown source comments before validating the cheaper open-path changes.
- Do not ship `pdf.js` in the first preview-support slice.
- Do not revive native parsing without math parity checks.

## Success Criteria

- Markdown file open feels closer to editor baselines for common session usage.
- Preview-mode costs and source-mode costs are treated as separate problems.
- Markdown comments remain possible without forcing their full cost onto every markdown open.
- Svg preview behavior is explicit and consistent.
- Pdf gets a lightweight preview path with clear fallback behavior.

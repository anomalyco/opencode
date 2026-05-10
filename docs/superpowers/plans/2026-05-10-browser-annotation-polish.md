# Browser Annotation Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish browser annotations so they feel like Codex-style in-page numbered notes, and fix browser tab activation after closing a tab.

**Architecture:** Keep browser annotations in the existing app-side annotation store, render a lightweight overlay layer inside `BrowserPanel`, and preserve the existing prompt capsule count. The annotation editor should be a small theme-token-driven popover with keyboard-first submission. Tab close activation should be deterministic in the renderer store: closing the active tab selects the next tab, then previous fallback.

**Tech Stack:** SolidJS renderer, existing `BrowserPanel`/annotation store, CSS theme tokens, Bun tests, package-level `bun typecheck`.

---

## File Structure

- Modify `packages/app/src/components/browser-panel/BrowserPanel.tsx` — render annotation markers/editor overlay and fix tab close activation.
- Modify `packages/app/src/components/browser-panel/BrowserPanel.css` — theme-aware marker/editor styles.
- Modify `packages/app/src/context/browser-store.tsx` — deterministic active tab selection if needed.
- Modify `packages/app/src/components/browser-panel/BrowserPanel.test.tsx` — tests for tab close activation and annotation UI.
- Modify `packages/app/src/context/annotation-store.tsx` only if the existing store lacks enough data for marker numbering.

---

### Task 1: Fix active tab selection after closing a browser tab

**Files:**
- Modify: `packages/app/src/components/browser-panel/BrowserPanel.tsx`
- Modify: `packages/app/src/context/browser-store.tsx` if needed
- Test: `packages/app/src/components/browser-panel/BrowserPanel.test.tsx`

- [x] Add failing tests for closing the active browser tab when two or more tabs remain. Assert the next visible tab becomes active without requiring a click.
- [x] Add failing test for closing an inactive tab. Assert the active tab does not change.
- [x] Implement deterministic next-id selection: prefer the tab to the right of the closed active tab, then the tab to the left, then `null`.
- [x] Avoid double activation from both native close result and local store mutation.
- [x] Run from `packages/app`: `bun test --preload ./happydom.ts ./src/components/browser-panel/BrowserPanel.test.tsx`.

### Task 2: Render persistent numbered annotation markers on the browser page

**Files:**
- Modify: `packages/app/src/components/browser-panel/BrowserPanel.tsx`
- Modify: `packages/app/src/components/browser-panel/BrowserPanel.css`
- Test: `packages/app/src/components/browser-panel/BrowserPanel.test.tsx`

- [x] Add failing tests that existing browser annotations render as small numbered markers (`1`, `2`, `3`) positioned from their annotation bounding boxes.
- [x] Add failing test that marker numbering follows annotation order and remains visible after the note is submitted.
- [x] Render a non-interfering overlay layer above the browser view using existing annotation store data.
- [x] Keep marker styling calm: compact blue/accent dot, clear number, subtle border, no large floating card or decorative shadow.
- [x] Preserve the existing annotation capsule aggregate count in the prompt.
- [x] Run from `packages/app`: `bun test --preload ./happydom.ts ./src/components/browser-panel/BrowserPanel.test.tsx`.

### Task 3: Replace annotation editor with theme-aware keyboard-first popover

**Files:**
- Modify: `packages/app/src/components/browser-panel/BrowserPanel.tsx`
- Modify: `packages/app/src/components/browser-panel/BrowserPanel.css`
- Test: `packages/app/src/components/browser-panel/BrowserPanel.test.tsx`

- [x] Add failing test that the annotation editor uses theme-aware browser panel styling instead of a white card.
- [x] Add failing tests for keyboard behavior: `Enter` submits, `Shift+Enter` inserts a newline, `Escape` cancels.
- [x] Remove visible Cancel/Save buttons from the annotation editor.
- [x] Focus the input automatically when the editor opens.
- [x] Submit only when the note has non-empty trimmed text.
- [x] Keep copy minimal and use existing app language where possible.
- [x] Run from `packages/app`: `bun test --preload ./happydom.ts ./src/components/browser-panel/BrowserPanel.test.tsx`.

### Task 4: Final verification and installer

**Files:**
- Verify source; rebuild installer after tests pass.

- [x] Run from `packages/app`: `bun test --preload ./happydom.ts ./src/components/browser-panel/BrowserPanel.test.tsx`.
- [x] Run from `packages/app`: `bun typecheck`.
- [x] Run from `packages/desktop`: `$env:OPENCODE_CHANNEL='dev'; bun run build; if ($?) { bun run package:win }`.
- [x] Confirm installer exists at `packages/desktop/dist/opencode-desktop-win-x64.exe`.

---

## Design Notes

- Annotation markers are persistent visual references; the prompt payload remains source-of-truth for sending annotation data to the model.
- The floating editor is an input affordance only. Once submitted, the page keeps the numbered marker; it does not keep a large note card open.
- Enter submits because this is a high-frequency annotation workflow. Escape cancels because it is the standard keyboard escape hatch.
- Tab closing should never leave the user in a visually stale browser state when another browser instance remains.

# Browser Workspace v2 Follow-up — Console + Chat Triggers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-browser console capture/viewing plus explicit `@browser` and `/browser` local chat triggers that expose browser tools to the active agent.

**Architecture:** Electron main owns a bounded console store keyed by `browserId`; preload exposes typed read/clear APIs and canonical tool aliases; the renderer adds a minimal Console section inside `BrowserPanel`. Chat triggers stay local: `@browser` and `/browser` open or provision the panel/browser, while request-part generation injects a synthetic note so the model knows browser tools are available.

**Tech Stack:** Electron `WebContentsView`, IPC/preload bridge, SolidJS renderer, Bun tests, package-level `bun typecheck`.

---

## File Structure

```txt
packages/desktop/src/main/browser/
├── console-store.ts                 # NEW: ring buffer, redaction, bounded query/clear
├── MultiBrowserManager.ts           # MODIFY: attach/detach console listeners per browser
├── types.ts                         # MODIFY: console entry/filter/tool payload types
└── ipc-handlers.ts                  # MODIFY: browser-console-* handlers

packages/desktop/src/preload/
├── browser.ts                       # MODIFY: renderer APIs + tool aliases
└── types.ts                         # MODIFY: console contracts on BrowserAPI

packages/app/src/context/
├── browser-types.ts                 # MODIFY: renderer console types
└── browser-actions.ts               # NEW: open/activate/create/navigate helper

packages/app/src/components/browser-panel/
├── BrowserPanel.tsx                 # MODIFY: Page/Console section and data loading
└── BrowserPanel.css                 # MODIFY: console layout styling

packages/app/src/components/prompt-input/
├── build-request-parts.ts           # MODIFY: synthetic browser-tools note
└── submit.ts                        # MODIFY: local /browser intercept

packages/app/src/
├── components/prompt-input.tsx      # MODIFY: @browser picker + /browser picker special-case
└── pages/session/use-session-commands.tsx # MODIFY: register /browser command
```

---

### Task 1: Add main-process browser console storage

**Files:**
- Create: `packages/desktop/src/main/browser/console-store.ts`
- Modify: `packages/desktop/src/main/browser/types.ts`
- Modify: `packages/desktop/src/main/browser/MultiBrowserManager.ts`
- Test: `packages/desktop/src/main/browser/MultiBrowserManager.test.ts`
- Test: `packages/desktop/src/main/browser/BrowserManager.test.ts`

- [x] Write failing tests for: per-`browserId` storage, 200-entry cap, level filtering, clear behavior, and cleanup when a browser closes.
- [x] Implement `BrowserConsoleEntry`, query types, ring-buffer helpers, and redaction/truncation rules in `console-store.ts`.
- [x] Register `webContents.on("console-message", ...)` in `MultiBrowserManager.createBrowser()` and translate stable load failures into synthetic `error` entries.
- [x] Ensure browser cleanup removes console state when the browser instance is destroyed.
- [x] Run: `bun test src/main/browser/MultiBrowserManager.test.ts src/main/browser/BrowserManager.test.ts`
- [x] Expected: PASS with new console-store coverage.

### Task 2: Expose console reads/clears through IPC and preload

**Files:**
- Modify: `packages/desktop/src/main/browser/ipc-handlers.ts`
- Modify: `packages/desktop/src/preload/types.ts`
- Modify: `packages/desktop/src/preload/browser.ts`
- Test: `packages/desktop/src/main/browser/ipc-handlers.test.ts`
- Test: `packages/desktop/src/preload/browser.test.ts`

- [x] Add failing IPC tests for `browser-console-messages` and `browser-console-clear`, including optional `browserId`, `levels`, and `limit`.
- [x] Add failing preload tests for renderer methods and canonical aliases `toolConsoleMessages()` / `toolConsoleClear()` mapping onto the new IPC channels.
- [x] Implement typed IPC handlers returning bounded results and clear counts, with active-browser fallback when `browserId` is omitted.
- [x] Extend preload `BrowserAPI` to expose both renderer-facing console methods and canonical tool aliases matching `browser.console_messages` / `browser.console_clear`.
- [x] Run: `bun test src/main/browser/ipc-handlers.test.ts src/preload/browser.test.ts`
- [x] Expected: PASS with exact channel assertions.

### Task 3: Add Console UI to BrowserPanel

**Files:**
- Modify: `packages/app/src/context/browser-types.ts`
- Create: `packages/app/src/context/browser-actions.ts`
- Modify: `packages/app/src/components/browser-panel/BrowserPanel.tsx`
- Modify: `packages/app/src/components/browser-panel/BrowserPanel.css`
- Test: `packages/app/src/components/browser-panel/BrowserPanel.test.tsx`

- [x] Add failing renderer tests for a Page/Console switch, empty console state, entry rendering, active-browser-scoped reads, and clear action.
- [x] Implement `browser-actions.ts` to centralize: open panel, ensure an active browser exists, activate it, and optionally navigate when a URL is supplied.
- [x] Update `BrowserPanel.tsx` to use that helper, keep Page as default, and render a simple Console section with monospace rows and a clear button.
- [x] Keep styling minimal in `BrowserPanel.css`; no panel relocation, no heavy theming, no raw Electron objects in state.
- [x] Run: `bun test src/components/browser-panel/BrowserPanel.test.tsx`
- [x] Expected: PASS for panel rendering and browser activation flows.

### Task 4: Add `@browser` mention trigger and synthetic prompt hint

**Files:**
- Modify: `packages/app/src/components/prompt-input.tsx`
- Modify: `packages/app/src/components/prompt-input/build-request-parts.ts`
- Test: `packages/app/src/components/prompt-input/build-request-parts.test.ts`

- [x] Add failing tests proving the `@` picker shows a browser option labeled like `Browser — Control the in-app browser` ahead of file matches.
- [x] Add failing tests proving `@browser` causes a synthetic text part that tells the agent browser tools and console tools are available, without emitting a fake `AgentPart`.
- [x] Implement a third picker option type for browser, open/activate the BrowserPanel through `browser-actions.ts`, create or activate a browser if none exists, and insert literal `@browser` text into the editor.
- [x] Extend `build-request-parts.ts` to detect `@browser` usage and inject one bounded synthetic note before request submission.
- [x] Run: `bun test src/components/prompt-input/build-request-parts.test.ts`
- [x] Expected: PASS with explicit assertion that no backend agent-switch payload is created.

### Task 5: Add local `/browser` command registration and submit intercept

**Files:**
- Modify: `packages/app/src/pages/session/use-session-commands.tsx`
- Modify: `packages/app/src/components/prompt-input.tsx`
- Modify: `packages/app/src/components/prompt-input/submit.ts`
- Test: `packages/app/src/components/prompt-input/submit.test.ts`
- Test: `packages/app/src/components/browser-panel/BrowserPanel.test.tsx`

- [x] Add failing tests for raw `/browser`, raw `/browser https://example.com`, and picker-selected `/browser` behavior.
- [x] Register a new session/view command with `slash: "browser"` and description text matching the Browser panel purpose.
- [x] Special-case `/browser` in `prompt-input.tsx` so slash-picker selection inserts `/browser ` into the editor instead of immediately dispatching like other builtins; this preserves optional URL entry.
- [x] Intercept `/browser` in `submit.ts` before server submission: bare command opens/activates the panel and ensures a browser exists; URL form also navigates; invalid extra arguments fail locally with a toast and do not hit the server.
- [x] Reuse the same synthetic browser-tools note path as `@browser` so the model gets a consistent hint when `/browser` is used in a prompt flow.
- [x] Run: `bun test src/components/prompt-input/submit.test.ts src/components/browser-panel/BrowserPanel.test.tsx`
- [x] Expected: PASS with no server `promptAsync()` call for local-only `/browser` submissions.

### Task 6: Package-level typechecks and focused regression suite

**Files:**
- Verify only; no new source files

- [x] Run from `packages/desktop`: `bun test src/main/browser/MultiBrowserManager.test.ts src/main/browser/BrowserManager.test.ts src/main/browser/ipc-handlers.test.ts src/preload/browser.test.ts`
- [x] Expected: PASS.
- [x] Run from `packages/desktop`: `bun typecheck`
- [x] Expected: PASS.
- [x] Run from `packages/app`: `bun test src/components/browser-panel/BrowserPanel.test.tsx src/components/prompt-input/build-request-parts.test.ts src/components/prompt-input/submit.test.ts src/components/session/session-header.browser-panel.test.ts src/pages/session/session-side-panel.browser-panel.test.ts`
- [x] Expected: PASS.
- [x] Run from `packages/app`: `bun typecheck`
- [x] Expected: PASS.

---

## Final Verification Checklist

- [x] Browser console entries are captured per `browserId` from Electron main, with bounded storage and no raw Electron exposure.
- [x] BrowserPanel shows a simple Console section with read + clear behavior tied to the active browser.
- [x] Agent-facing aliases `browser.console_messages` and `browser.console_clear` are available through preload/IPC.
- [x] `@browser` opens or provisions the BrowserPanel and injects the browser-tools hint without pretending `browser` is a real agent.
- [x] `/browser` is local-only, explicit, does not auto-navigate without a URL, and never falls through to the server when used as a local command.
- [x] All focused tests and both package typechecks pass from package directories only.

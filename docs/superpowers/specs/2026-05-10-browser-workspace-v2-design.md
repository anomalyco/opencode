# Browser Workspace v2 — Icon-First Multi-Browser Panel

## Goal

Redesign the integrated browser so it behaves like a first-class OpenCode panel opened from the top-right panel controls, supports multiple browser instances/tabs, and exposes a complete browser toolset for the agent.

## Problem

The current browser is embedded inside the chat/session column and backed by a singleton `WebContentsView`. This creates two structural problems:

1. **Positioning is fragile** because `WebContentsView` is not part of the renderer DOM. Bounds derived from nested DOM layout can drift from Electron window coordinates.
2. **Only one browser exists** because `BrowserManager` owns a single `browserView` reference.

The browser needs to live in its own panel area, not inside the chat flow.

## UX Design

Add a browser button to the existing top-right panel toolbar. When active, it opens a dedicated Browser panel in the right/central panel area shown by the user.

The Browser panel is **icon-first**. Text is used only for the URL input, tab title, and accessible tooltips.

```txt
┌─────────────────────────────────────────────┐
│ [browser icon]  [tab] [tab] [+]        [x]  │
├─────────────────────────────────────────────┤
│ [←] [→] [↻] [ URL........................ ] │
│ [inspect] [screenshot] [more]               │
├─────────────────────────────────────────────┤
│                                             │
│              WebContentsView                │
│                                             │
└─────────────────────────────────────────────┘
```

Controls should use existing project icons where possible:

- Browser/globe icon for the panel button.
- Back/forward/reload icons.
- Plus icon for new browser tab.
- Close icon for closing a tab/panel.
- Mouse pointer/crosshair icon for annotation mode.
- Camera/image icon for screenshot.
- More/horizontal dots icon for secondary actions.

All icon-only buttons must have `aria-label` and tooltip/title text.

## Browser Model

Replace the singleton browser model with a multi-instance model:

```ts
type BrowserId = string

type BrowserInstance = {
  id: BrowserId
  view: WebContentsView
  title: string
  url: string
  bounds: BrowserBounds
  state: BrowserPanelState
}
```

The main process keeps:

```ts
browsers: Map<BrowserId, BrowserInstance>
activeBrowserId: BrowserId | undefined
```

Rules:

- If a tool call does not pass `browserId`, it targets the active browser.
- Creating a browser makes it active.
- Closing the active browser activates the next available browser.
- If all browsers are closed, the panel may stay open with an empty state and a create button.
- Browser sessions remain persistent and isolated using the existing integrated browser partition strategy.

## Panel Placement

The Browser panel should be rendered in the same panel system used by OpenCode’s existing top-right panel buttons, not inside the session/chat column.

The `WebContentsView` bounds must be calculated from the dedicated browser viewport element in that panel. Because `WebContentsView` is external to the DOM, bounds sync must be explicit and resilient:

- sync on panel open;
- sync on resize;
- sync on active tab change;
- sync on app/window resize;
- hide inactive browser views rather than stacking them visually.

## Toolset

The browser toolset should include or alias the following capabilities:

| Desired tool | Existing equivalent | Action |
|---|---|---|
| `openBrowserPage` | `browser.open` | Keep/add alias if needed |
| `navigatePage` | `browser.navigate` | Keep/add alias if needed |
| `readPage` | `browser.get_snapshot` | Add user-facing/tool alias |
| `screenshotPage` | `browser.screenshot` | Keep/add alias if needed |
| `clickElement` | `browser.click` | Keep/add alias if needed |
| `typeInPage` | `browser.type` | Keep/add alias if needed |
| `hoverElement` | missing | Add |
| `dragElement` | missing | Add |
| `handleDialog` | missing | Add bridge; return explicit unsupported result unless a reliable Electron dialog API is available |
| `runPlaywrightCode` | missing | Add a safe compatibility layer |

For `runPlaywrightCode`, the implementation should not pretend to be full Playwright unless Playwright is actually embedded. The first implementation should be a constrained `runBrowserCode`/`runPlaywrightCode` compatibility API operating on the active browser’s page context with strict result bounds and no Node access.

## Data Flow

Renderer:

- Owns panel UI state, active browser tab, and icon-first toolbar.
- Sends browser commands through `window.api.browser`.
- Receives browser-open requests from agent/tool calls.

Preload:

- Exposes browser APIs under `window.api.browser`.
- Avoids exposing raw Electron or IPC primitives.

Main process:

- Owns browser instances and `WebContentsView` lifecycles.
- Routes commands by `browserId` or active browser.
- Owns screenshot, upload/download, inspect, hover, drag, and code execution mechanics.
- Exposes a dialog bridge, but must return an explicit unsupported result if Electron does not provide a reliable typed accept/dismiss/prompt API.

## Security Requirements

- Keep `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`.
- Keep browser sessions isolated from system Chrome/Edge profiles.
- Keep upload path validation with realpath containment.
- Keep redaction and context-size limits from v1.
- Bound output from `runPlaywrightCode`/`runBrowserCode`.
- Dialog handling must be explicit when supported: accept, dismiss, or prompt text. If unsupported by the Electron API surface, the tool must fail closed with a typed unsupported result instead of pretending control succeeded.
- Inactive browser views must be hidden, not left clickable off-panel.

## Implementation Phases

### Phase 1 — Move browser into a real panel

- Add Browser panel button to the existing top-right panel controls.
- Render Browser panel in the correct right/central panel area.
- Remove browser rendering from the chat/session column.
- Fix bounds sync against the new dedicated viewport.

### Phase 2 — Multi-browser manager

- Replace singleton state with `Map<browserId, BrowserInstance>`.
- Add create/list/activate/close browser APIs.
- Preserve existing single-browser tool calls by defaulting to active browser.

### Phase 3 — Icon-first tab and toolbar UI

- Add tab strip.
- Add `+` new browser control.
- Add icon-only navigation/annotate/screenshot controls with accessible labels.

### Phase 4 — Missing tools

- Add `hoverElement`.
- Add `dragElement`.
- Add `handleDialog` bridge with honest unsupported fallback if no reliable Electron dialog API exists.
- Add bounded `runPlaywrightCode` compatibility API.
- Add aliases for the desired tool names if needed.

### Phase 5 — Verification and packaging

- Typecheck app and desktop.
- Run focused browser/panel tests.
- Package Windows installer after approval.

## Acceptance Criteria

- Browser opens from a top-right panel button.
- Browser is no longer inside the chat/session column.
- Browser panel supports multiple browser tabs/instances.
- Active browser is visibly selected.
- Tools operate on active browser by default and can target a browser by ID.
- The listed toolset is present or intentionally aliased.
- UI controls are icon-first with accessible labels/tooltips.
- App and desktop typecheck pass.
- Focused browser tests pass.

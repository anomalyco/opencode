# Browser Preview Design

## Understanding

- Add an optional right-docked browser preview for web developers using OpenCode Desktop.
- Load arbitrary HTTP and HTTPS pages without weakening the trusted app renderer.
- Preserve browser storage across refreshes, but release all preview resources when the panel is hidden or closed.
- Provide normal navigation, tabs, auto-refresh, DevTools, device emulation, zoom, cache controls, and hard reload.
- Never capture page content, screenshots, DOM, or console output for the model automatically.
- Make inspection actions explicit and keep their results memory-only until the user chooses what to do with them.
- Let the user select a rendered element and add bounded, sanitized context to the captured chat draft.

## Architecture

Electron's main process owns a revisioned `WebContentsView` controller for each `BrowserWindow`. The Solid renderer owns the dock, toolbar, placeholders, and persisted layout state. A typed preload bridge carries validated commands and state events between them.

Each preview window uses a unique in-memory Electron session partition. Tabs share that partition, matching normal browser cookie behavior. The active tab is attached to the window content view; inactive tabs are detached and background-throttled. Five tabs are allowed per window.

Hiding, collapsing, toggling off, or closing the panel destroys every tab and clears the shared preview session. Closing one tab destroys only that tab. Renderer reload and window close perform full teardown. Only panel width, open state, and the last URL are persisted.

## Security Contract

- Preview web contents have no preload, Node integration, permissions, downloads, popups, or application IPC access.
- New IPC accepts only the trusted top-level OpenCode renderer and resolves its owning `BrowserWindow`.
- URLs allow only `http:` and `https:`, are capped at 2 KiB, and reject credentials, missing hosts, and malformed addresses.
- The same URL policy applies to direct loads, redirects, history navigation, and popup conversion.
- Bounds are finite, revisioned, rate-limited, and clamped to the owning window's content area.
- Certificate errors are rejected without an override.
- Inspection data is excluded from persistence, application logs, telemetry, crash reports, and debug exports.
- Element selection runs in an isolated JavaScript world. It removes scripts, styles, form state, URLs, event handlers, and non-allowlisted attributes before data crosses IPC. The selected page URL is included without its query string or fragment so tokens are not attached to chat.
- Selected page text and markup are labeled as untrusted data before being attached to chat.

## Inspection Limits

- One inspection operation may run per tab at a time. Non-interactive inspections have a five-second timeout; element selection remains active until a click, `Esc`, cancellation, or navigation.
- DOM output is capped at 2 MiB.
- Screenshots are capped at 4096 by 4096 pixels and 10 MiB encoded.
- Console capture starts only after an explicit action and retains at most 200 entries, 4 KiB per entry, and 512 KiB total.
- Inspection results are discarded after navigation, reload, tab destruction, renderer reload, crash, or window close.
- Element selectors are capped at 4 KiB, visible text at 16 KiB, and sanitized HTML at 64 KiB.

## UX Contract

- Routine navigation remains in the primary toolbar; destructive and diagnostic actions live in an overflow menu.
- The panel action is labeled `Hide & reset preview` so teardown is not mistaken for a non-destructive hide.
- Auto-refresh has a visible active state and applies only to the current tab.
- Failure states distinguish unreachable servers, blocked URLs, TLS failures, and renderer crashes.
- The first console action is `Start Console Capture`; subsequent actions can retrieve captured logs.
- Opening externally warns that the system browser has a different session.
- Editor mode is a pressed toolbar action. Hover outlines the target; click attaches it to the draft that started selection; pressing `Esc` cancels.

## Decision Log

| Decision                        | Alternatives                          | Rationale                                                                                                                 |
| ------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Main-owned `WebContentsView`    | iframe, webview                       | Preserves browser compatibility without enabling `webviewTag` or weakening the app renderer.                              |
| Arbitrary HTTP/HTTPS navigation | loopback allowlist, embedded iframe   | Matches a normal preview browser while protocol, credentials, permissions, downloads, popups, and app IPC remain blocked. |
| In-memory per-window partition  | default session, persistent partition | Preserves storage across refreshes while making destructive close and idle cleanup reliable.                              |
| Main-authoritative tab state    | renderer-authoritative state          | Prevents stale native views and out-of-order IPC from diverging from the toolbar.                                         |
| Five-tab cap                    | one tab, unbounded tabs               | Satisfies the optional multi-tab goal while bounding Chromium resource use.                                               |
| Explicit-only diagnostics       | automatic capture                     | Protects privacy and preserves the developer-preview-only contract.                                                       |
| Isolated-world element picker   | page preload, renderer DOM access     | Supports Claude-style element attachment without giving arbitrary pages app privileges or exposing the trusted renderer.  |
| Full teardown on panel hide     | detached hidden views                 | Directly satisfies the no-resource-usage requirement.                                                                     |

Structured review disposition: **APPROVED** after navigation confinement, IPC authorization, inspection privacy, geometry validation, and lifecycle rules were made explicit.

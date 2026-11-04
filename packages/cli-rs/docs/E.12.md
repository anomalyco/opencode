# E.12: tabs and panes

Rows W01, W02, W04, W05, W07, W08 and T25. This note fixes the pane layout before the code.

## The layout

TS builds the screen in `app.tsx:1405-1485` and `component/session-frame.tsx:261-399`. The Rust shell follows
the same tree:

```text
shell (column, app.rs)
├── body (row)                              frame::Shell
│   ├── rail          vertical tabs         tabs::rail     when tabs are visible and vertical
│   ├── column (grows)
│   │   ├── strip     horizontal tabs       tabs::strip    when tabs are visible and horizontal
│   │   └── main      the route view        routes::*
│   │       └── session route: frame::SessionFrame
│   │           ├── session pane (grows)    routes::session::Session
│   │           ├── right pane              panel::Host, the sidebar (E.14), the terminal (E.13a)
│   │           └── pane handle             frame::resize, over the boundary
│   └── rail handle   absolute, x = width - 1
└── devtools bar (E.18a); toasts and dialogs are overlays
```

- Tabs are visible when `tabs.enabled`, at least one tab is open, the route is not a plugin route, and no
  panel is full screen (`app.tsx:614-622`).
- The vertical layout needs `sessionTabsFitVertically(width, railWidth)`, that is
  `width >= railWidth + 64`. Otherwise the strip is horizontal.
- The rail width is `layout.verticalTabsWidth` (default 42), clamped to `[5, min(72, width - 44)]`. Below 12
  columns the rail is compact (`SESSION_TABS_COMPACT_BREAKPOINT`).
- The panel width (`panels.width`) is the terminal width minus the rail, when the rail would show.

## The session frame

`frame::SessionFrame` wraps the session route. Its right pane is the first of:

1. a panel of this session (`panel::Panels::current`), split or full screen;
2. the sidebar when the user opened it (E.14 owns its content);
3. the selected terminal (E.13a owns it);
4. the sidebar on a wide terminal (more than 120 columns besides the rail) unless `session.sidebar` is `hide`.

A split panel or terminal is `layout.paneWidth` wide (fallback `layout.terminalWidth`, default half the panel
width), clamped by `clampSessionPaneWidth`. Full screen hides the session pane and the tabs. The handle sits at
`available - width - 1` and is 2 cells wide, highlighted on its right cell.

`pane.focus.left` and `pane.focus.right` live in a global layer that is enabled while the right pane is a
terminal or a panel and no dialog is open. The active pane is `session` or `right`; focusing the right pane
focuses the panel's root, or asks the terminal (E.13a) through a hook.

The session route loses T.1's header, its top padding, and the gap under the header. TS has no session header:
the title shows in the tab strip. This removes part 1 of `V01-plain-transcript`.

## The panel host (W07)

`panel::Panels` is `context/panel.tsx`: `current`, `requested`, `width`, `can_split` (`width >= 108`), the
derived `presentation`, `open`, `close`, `release`, and `toggle_fullscreen`. `panel::Host` is the raised
container a plugin fills through a callback registered for the panel name. P.1 connects the
`session.panel` slot to it; E.15a's diff viewer is the first user. Leaving the panel's session closes it
(`app.tsx:626-630`).

## Tabs state (W01, W02)

`tabs::Tabs` is `context/session-tabs.tsx`. It keeps:

- the persisted `tabs` storage key, `{ global: {tabs, unread}, cwd: {[cwd]: {tabs, unread}} }`, with
  `unread` kept empty as TS does. Updates go through `Storage::update` (lock, load, change, atomic write) on a
  blocking thread, and the in-memory copy changes first, so the UI never waits on the file;
- the in-memory history (100 entries), the recently closed stack (25), the cancelled set, and the prompt pulse
  counters;
- per-tab open groups and scroll anchors, for E.8 (an API only; E.8 calls it).

The pure parts (`openSessionTab`, `closeSessionTab`, `reopenSessionTab`, `moveSessionTab`, `cycleSessionTab`,
the history, `adaptiveSessionTabLayout`) are a straight port in `tabs/model.rs` with the TS tests' cases.

Route changes call `tabs::route_changed`: a session route admits its root session as a tab (title "New
session" when it came from the new-session slot) and records history. `session.deleted` removes the tab and,
when it was the open one, selects the history's previous tab or the closed tab's neighbour, else goes home
without the toast (the E.1 decision).

Commands, in a global layer enabled while tabs are on: `session.tab.next`, `.previous`, `.next_unread`,
`.previous_unread`, `.close`, `.reopen`, and `.select.1` to `.10`. `session.tab.history.back` and `.forward`
are declared keybinds with no command in TS (a grep of `packages/tui/src` finds no handler), so Rust registers
none.

`session.view` acknowledgement runs with tabs on or off: when the terminal has focus and the open root session
is unread, post `session.view {idle}` once per idle watermark, with retries backing off from 250 ms to 5 s.

## Strip, rail, and pulse (W01, W04, W08)

The strip and the rail are each one `Custom` widget that paints its cells, so the cells follow the TS formulas
directly: `adaptiveSessionTabLayout` for widths, the tint chains for colors, the fade over the last four title
cells, the overflow markers `‹n` and ` n›`, the `+` slot, and the indicator (`!`, `?`, a spinner, the unread
dot, or the number). Mouse: a left press and release selects, middle closes, the close mark closes, the `+`
opens a new session, a drag reorders. The context menu, the hover marquee, the compact rail's tooltip, and the
close hold are left for a follow-up.

`tabs::pulse` ports `PulseState`: the static glow holds without animations, as TS does. With animations on,
the sweep, the edge flash, and the completion pulse run on a 20 fps timer while live.

## Pane resize (W04, W05)

`frame::resize::PaneResize` is `ui/pane-resize.ts`: a press on the handle starts a resize, drags set the
preferred size through `clamp(fromMouse(event))`, and the release commits it to `layout` storage
(`verticalTabsWidth` or `paneWidth`). A second press within 300 ms of a click without a move resets to the
default. The handle is a 2-cell `Custom` that captures the drag.

## `/clear` (T25)

`features/clear.rs` registers `session.clear` ("Clear session", group Session, `/clear`): remember the agent and
model, close the current tab, go home in the new-session location, restore the agent and model, and clear the
dialogs.

## Proof

- Unit tests for `tabs/model.rs` (the TS test cases of `session-tabs-model.test.ts`), the pane clamps, and the
  pulse glow.
- P-APP `E.12/tab-strip`: open a session, select a second one, close a tab, reopen it, and go home to the
  new-session tab, against TS.
- P-APP `E.12/rail-resize`: the vertical rail at 120x30, then a drag of its handle, against TS. H.2 gets a
  `drag` step for this (minimal edits in `parity/lib/app.ts`, the TS runner, `crates/parity/src/app.rs`, and
  `tests/app.rs`).
- P-FILE: `parity/oracle/E.12-tabs.ts` reads what Rust wrote to `tabs.json` and `layout.json` in a temporary
  state directory with the TS storage and model, writes back, and Rust reads it.

# Full-screen widgets

Rune desktop, iOS, Android (and the web host) let a widget go full screen, like a video player. The TUI doesn't.
This is purely client-side: the server stores and validates nothing for it.

## When the button shows

The root node of the current view may carry `fullscreen?: boolean` (e.g. `ui.column({ fullscreen: true }, [...])`;
unknown props are ignored by the server and the TUI):

- `true`: offer full screen.
- `false`: never.
- absent: offer it for live widgets and whenever the current view contains a `canvas` or `shader` node.

The button is a small expand icon in the widget's top-right corner: shown on hover and keyboard focus on desktop,
always visible on touch devices. It is not offered for submitted or dismissed widgets.

## Full screen

- **Mobile:** a full-screen cover above the session (status bar hidden, safe areas respected), rotation allowed
  while it's open (landscape for games). Exit with the close button, swipe down, or the system back gesture.
- **Desktop:** the widget fills the whole window and the window enters the OS full-screen mode (macOS native full
  screen; F11-style elsewhere). Exit with Esc, the close button, or leaving OS full screen.
- **Web host:** the Fullscreen API on the widget's container; Esc exits.
- It is the same widget instance: state, the live program and its timers carry on; nothing restarts. The inline
  copy shows a placeholder ("Open in full screen") until it closes. Only one widget is full screen at a time.

## Layout

The root node fills the screen. `canvas` and `shader` nodes gain an optional `fill?: boolean`: with `fill: true`
they grow to take the remaining height in full screen (their `height` is the minimum); without it they keep their
`height`. Width is the available width as usual. Content taller than the screen scrolls.

## Telling the program

- Clients send `{ id: "", type: "fullscreen", value: true | false }` when the widget enters or leaves full screen.
  Step mode: the template's `onFullscreen(state, on)` hook gets it, so it can switch layouts (e.g. hide the
  explanation text, make the canvas `fill`). Live mode: `widget.on("fullscreen", fn)`. Without a hook it changes
  nothing.
- `Frame` (canvas `draw` and live `widget.frame()`) gains `fullscreen: boolean`; `width`/`height` change with it.
- The view is re-rendered on enter and exit, and on window/screen resize (`width`/`height` change in the next frame).

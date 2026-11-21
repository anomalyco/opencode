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
  while it's open (landscape for games). Exit with the floating close button, swipe down, or the system back gesture.
- **Desktop:** the widget fills the whole window and the window enters the OS full-screen mode (macOS native full
  screen; F11-style elsewhere). Exit with Esc, the close button, or leaving OS full screen.
- **Web host:** the Fullscreen API on the widget's container; Esc exits.
- It is the same widget instance: state, the live program and its timers carry on; nothing restarts. The inline
  copy shows a placeholder ("Open in full screen") until it closes. Only one widget is full screen at a time.

**Back always closes full screen.** Navigating back closes it in every client, whatever has focus and even while the
widget holds keyboard focus or pointer capture (closing releases both). A widget can't intercept or delay it.

- **Android:** the system back (button or gesture, including predictive back).
- **iOS:** the back/dismiss gestures: edge swipe back and swipe down on the full-screen view.
- **Rune:** the app's back navigation (⌘[ / Alt+←, the mouse back button) and Esc.
- **Web host:** the browser's back: entering pushes a history entry and `popstate` closes full screen; also Esc.

## Layout

The root node fills the screen. In full screen every `canvas` and `shader` grows by default to share the remaining
height equally (its `height` is the minimum); `fill: false` keeps it at its `height`. Width is the available width as
usual. Content taller than the screen scrolls. Inline (not full screen), sizes are unchanged.

## Chrome

Full screen has no title bar: only the floating close button, always visible, over the widget's top-right corner. The
widget keeps the whole screen; the button floats above its content, and the client tells the widget where it is
(below) so the widget template can keep content out of that area. The widget's own view supplies any title.

The close button's **area** is its hit area, measured from the root node's top-right corner (the root fills the
safe area):

| Client | Area | Visible button |
| --- | --- | --- |
| iOS | 44 × 44 pt, 8 pt from the top and the trailing edge | a 32 pt circle centered in it |
| Android | 44 × 44 dp, 8 dp from the top and the end edge | a 32 dp circle centered in it |
| Rune desktop | 32 × 32 px (logical), 8 px from the top and the right edge | the whole area |
| Web host | 32 × 32 CSS px, 8 px from the top and the right edge | the whole area |

So on iOS a root `width` wide has the area `{ x: width - 52, y: 8, width: 44, height: 44 }`. The TUI has no full
screen.

## Telling the program

- Clients send `{ id: "", type: "fullscreen", value: true | false, close: Rect | null }` when the widget enters or
  leaves full screen, and again with the new `close` when the root's size changes. `Rect` is `{ x, y, width, height }`
  in logical pixels; `close` is the close button's area in the root node's coordinates, `null` when leaving. Step
  mode: the widget template's `onFullscreen(state, on, close)` hook gets it, so it can switch layouts (e.g. keep a
  header's right end free, make the canvas `fill`). Live mode: `widget.on("fullscreen", (on, close) => ...)`. Without
  a hook it changes nothing.
- `Frame` (canvas `draw` and live `widget.frame()`) gains `fullscreen: boolean` and `close: Rect | null`: the close
  button's area in that canvas's coordinates when it overlaps the canvas, otherwise (or not in full screen) `null`.
  An absolute `pointer` event value from that canvas or a `shader` carries the same `close` (absent when `null`), so
  hit tests can use the layout the drawing used. `width`/`height` change with full screen.
- The view is re-rendered on enter and exit, and on window/screen resize (`width`/`height` change in the next frame).

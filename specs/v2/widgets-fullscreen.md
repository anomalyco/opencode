# Full-screen widgets

Rune desktop, iOS, Android (and the web host) let a widget go full screen, like a video player. The TUI doesn't.
This is purely client-side: the server stores and validates nothing for it.

## When the button shows

The root node of the current view may carry `fullscreen?: boolean` (e.g. `ui.column({ fullscreen: true }, [...])`;
unknown props are ignored by the server and the TUI):

- `true`: offer full screen.
- `false`: never.
- absent: offer it for live widgets and whenever the current view contains a `canvas` node (a stack's included).

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

The root node fills the safe area minus the full-screen **padding**, the same on every side: 12 pt on iOS, 12 dp on
Android, 16 logical px on Rune desktop and 16 CSS px on the web host. Nothing is full-bleed: canvases sit inside the
padding too, and the padding shows the widget's background. In full screen every `canvas` grows by default to share the remaining
height equally (its `height` is the minimum); `fill: false` keeps it at its `height`. Width is the available width as
usual. Content taller than the screen scrolls. Inline (not full screen), sizes are unchanged.

## Chrome

Full screen has no title bar: only the floating close button, always visible. The button is placed relative to the
screen or window, not the root: its hit area (the **area**) is 8 from the top and the trailing edge of the safe area,
so it overlaps the padded root's top-right corner. The button floats above the widget's content, and the client tells
the widget where it is (below) so the widget template can keep content out of that area. The widget's own view
supplies any title.

| Client | Padding | Area, from the safe area's top-right corner | Visible button | `close`, for a root `W` wide |
| --- | --- | --- | --- | --- |
| iOS | 12 pt | 44 × 44 pt, 8 pt from the top and the trailing edge | a 32 pt circle centered in it | `{ x: W - 40, y: -4, width: 44, height: 44 }` |
| Android | 12 dp | 44 × 44 dp, 8 dp from the top and the end edge | a 32 dp circle centered in it | `{ x: W - 40, y: -4, width: 44, height: 44 }` |
| Rune desktop | 16 px | 32 × 32 px (logical), 8 px from the top and the right edge | the whole area | `{ x: W - 24, y: -8, width: 32, height: 32 }` |
| Web host | 16 CSS px | 32 × 32 CSS px, 8 px from the top and the right edge | the whole area | `{ x: W - 24, y: -8, width: 32, height: 32 }` |

`close` is in the root's coordinates (origin at the root's top-left, inside the padding), computed from the button's
real position: with padding `P` and area size `S`, `x = W + P - 8 - S` and `y = 8 - P`, so the area reaches past the
root's top and right edges. A canvas gets the same area in its own coordinates. In a right-to-left layout the button
sits at the trailing (left) edge and `x = 8 - P`. The TUI has no full screen.

## Telling the program

- Clients send `{ id: "", type: "fullscreen", value: true | false, close: Rect | null }` when the widget enters or
  leaves full screen, and again with the new `close` when the root's size changes. `Rect` is `{ x, y, width, height }`
  in logical pixels; `close` is the close button's area in the root node's coordinates, `null` when leaving. Step
  mode: the widget template's `onFullscreen(state, on, close)` hook gets it, so it can switch layouts (e.g. keep a
  header's right end free, make the canvas `fill`). Live mode: `widget.on("fullscreen", (on, close) => ...)`. Without
  a hook it changes nothing.
- `Frame` (canvas `draw` and live `widget.frame()`) gains `fullscreen: boolean` and `close: Rect | null`: the close
  button's area in that canvas's coordinates when it overlaps the canvas, otherwise (or not in full screen) `null`.
  An absolute `pointer` event value from that canvas carries the same `close` (absent when `null`), so
  hit tests can use the layout the drawing used. `width`/`height` change with full screen.
- The view is re-rendered on enter and exit, and on window/screen resize (`width`/`height` change in the next frame).

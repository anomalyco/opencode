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

## Layout

The client splits the screen, inside the platform's safe area, into two parts, top to bottom:

1. **The close strip**: a full-width strip of fixed height that holds only the close button (see Chrome). It shows the
   widget's background color and nothing of the widget's view.
2. **The content area**: everything below the strip, down to the bottom safe-area inset. The root node is laid out in
   this area and nowhere else.

| Client | Close strip height | Close button |
| --- | --- | --- |
| iOS | 44 pt, starting at the top safe-area inset | 44 × 44 pt hit area (32 pt visible circle), at the strip's trailing end, 8 pt from the trailing safe-area inset |
| Android | 44 dp, starting at the top system-bar inset | 44 × 44 dp hit area (32 dp visible circle), at the strip's end, 8 dp from the end inset |
| Rune desktop | 40 px (logical), from the top of the full-screen window | 40 × 40 px hit area (28 px visible), at the right end, 8 px from the edge |
| Web host | 40 CSS px, from the top of the full-screen container | 40 × 40 CSS px hit area (28 px visible), at the right end, 8 px from the edge |

The TUI has no full screen. No widget content is ever drawn under the close button or the strip: not the root node, not
a `canvas` or `shader`, not content scrolled upward (scrolling happens inside the content area, which starts below the
strip). The widget can't draw into the strip or move the button.

In the content area, every `canvas` and `shader` grows by default to share the height left after the other nodes
equally (its `height` is the minimum); `fill: false` keeps it at its `height`. Width is the content area's width.
Content taller than the content area scrolls within it. A canvas's `Frame` (in `draw` and live `widget.frame()`)
reports the size it gets there: `height` is its share of the content area, never including the strip or the safe
areas. Inline (not full screen), sizes are unchanged.

## Chrome

Full screen has no title bar: only the close button, alone in the close strip (see Layout). The widget's own view
supplies any title, inside the content area.

## Telling the program

- Clients send `{ id: "", type: "fullscreen", value: true | false }` when the widget enters or leaves full screen.
  Step mode: the widget template's `onFullscreen(state, on)` hook gets it, so it can switch layouts (e.g. hide the
  explanation text, make the canvas `fill`). Live mode: `widget.on("fullscreen", fn)`. Without a hook it changes
  nothing.
- `Frame` (canvas `draw` and live `widget.frame()`) gains `fullscreen: boolean`; `width`/`height` change with it and
  measure only the node's part of the content area (Layout).
- The view is re-rendered on enter and exit, and on window/screen resize (`width`/`height` change in the next frame).

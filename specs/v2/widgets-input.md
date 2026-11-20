# Widget keyboard and pointer capture

Desktop (Rune) and the web host let a widget take the keyboard and, on request, the mouse, so games and editors can be
controlled directly. Mobile delivers keys only from a hardware keyboard and never locks the pointer. The TUI ignores
this. Clients only; the server knows nothing about it.

## Keyboard focus

- Clicking or tapping inside an open widget (or tabbing to it) gives it **keyboard focus**; the client shows a focus
  ring and a small "Esc to release" hint. Clicking outside it, or Esc, takes focus away.
- While focused, key presses go to the widget instead of the app, except app/OS chords that use the platform's command
  modifier (Cmd on macOS, Ctrl elsewhere), which still reach the app. Text input nodes keep working as before.
- The program receives `{ id: "", type: "key", value: { kind: "down" | "up", key, code, repeat, shift, alt, ctrl, meta } }`
  (`key`/`code` as in DOM `KeyboardEvent`): the template's `onKey(state, key)` hook in step mode,
  `widget.on("key", fn)` (and `widget.keys`) in live mode; a template without one never sees keys. Key events never
  reach node handlers, even when they carry a node's id. Focus changes arrive as `{ id: "", type: "focus", value: true | false }` (`onFocus` / `widget.on("focus")`); on blur the client sends `up`
  for keys still held.

## Pointer capture

- A widget asks for the mouse with `widget.capturePointer()` (live) or by setting `capture: "pointer"` on the view's root
  node (step and live). The client grants it on the next click inside the widget (a user gesture): the cursor is hidden
  and locked, and pointer events carry relative movement: `{ id, type: "pointer", value: { kind: "move", dx, dy } }`
  plus `down`/`up` with `button`. `widget.releasePointer()` (or dropping the root prop) gives it back. When capture is
  granted the program gets `{ id: "", type: "capture", value: true }`; when it ends for any reason,
  `{ id: "", type: "capture", value: false }`.
- Without capture, pointer events are as before (absolute `x`, `y` on canvas/shader nodes with an `id`). Both kinds go
  to the node's `onPointer`; capture changes go to `onCapture` / `widget.on("capture")`.

## Esc always releases

Esc is never delivered to a widget. It always releases pointer capture and keyboard focus at once (one press releases
both), and a widget can't prevent it. Leaving full screen, switching sessions or the window losing focus also release
both. The program gets `{ type: "focus", value: false }` and, if it had the pointer, `{ id: "", type: "capture",
value: false }`.

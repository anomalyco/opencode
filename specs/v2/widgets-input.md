# Widget keyboard and pointer capture

Desktop (Rune) and the web host let a widget take the keyboard and, on request, the mouse, so games and editors can be
controlled directly. Mobile delivers keys only from a hardware keyboard and never locks the pointer. The TUI ignores
this. Clients only; the server knows nothing about it.

## Keyboard focus

- Clicking or tapping inside an open widget (or tabbing to it) gives it **keyboard focus**; the client shows a focus
  ring and a tiny hint: a keyboard icon plus "Esc" (a cursor icon plus "Esc" while the pointer is captured). Touch
  devices show no hint unless a hardware keyboard is attached (then the keyboard icon only). Clicking outside it, or Esc, takes focus away.
- While focused, key presses go to the widget instead of the app, except app/OS chords that use the platform's command
  modifier (Cmd on macOS, Ctrl elsewhere), which still reach the app. Text input nodes keep working as before.
- The program receives `{ id: "", type: "key", value: { kind: "down" | "up", key, code, repeat, shift, alt, ctrl, meta } }`
  (`key`/`code` as in DOM `KeyboardEvent`): the widget template's `onKey(state, key)` hook in step mode,
  `widget.on("key", fn)` (and `widget.keys`) in live mode; a widget template without one never sees keys. Key events never
  reach node handlers, even when they carry a node's id. Focus changes arrive as `{ id: "", type: "focus", value: true | false }` (`onFocus` / `widget.on("focus")`); on blur the client sends `up`
  for keys still held.

## Pointer capture

- A widget asks for the mouse with `widget.capturePointer()` (live) or by setting `capture: "pointer"` on the view's root
  node (step and live). The client grants it on the next click inside the widget (a user gesture): the cursor is hidden
  and locked, and pointer events carry relative movement: `{ id, type: "pointer", value: { kind: "move", dx, dy } }`
  plus `down`/`up` with `button`. `widget.releasePointer()` (or dropping the root prop) gives it back. When capture is
  granted the program gets `{ id: "", type: "capture", value: true }`; when it ends for any reason,
  `{ id: "", type: "capture", value: false }`.
- Without capture, pointer events are as before (absolute `x`, `y` on canvas nodes with an `onPointer`
  handler). On desktop and web they also include **hover moves**: `{ kind: "move", x, y, down: false, width, height }`
  while the pointer is over the node with no button held, at most once per frame. Touch devices have no hover. Both
  kinds go to the node's `onPointer`; capture changes go to `onCapture` / `widget.on("capture")`.
- On touch, capture is never granted: touch hosts ignore the request (no `capture` event), and touches stay absolute
  `down`/`move`/`up` events (drags), so a widget template that looks around under capture needs drag steering too.

## Wheel

- Only while the widget holds pointer capture do the mouse wheel and trackpad scrolling reach the program, where
  captured moves go: `{ id, type: "pointer", value: { kind: "wheel", dx, dy } }` in logical pixels, with DOM
  `WheelEvent`'s signs as the platform reports them (positive `dy` scrolls down, positive `dx` right). Hosts normalise
  lines and pages to pixels: a line is 40, a page the canvas's logical height (its width for `dx`).
- Wheel events that arrive in one frame are summed into one event before delivery, so a trackpad can't flood the
  program. Without capture the wheel is never delivered: it scrolls the page or the transcript as it does everywhere
  else. Touch hosts, which never grant capture, never send it.
- In live mode `widget.pointer` doesn't change on a wheel: it keeps the last `down`, `move` or `up`.

## Esc always releases

Esc is never delivered to a widget. It always releases pointer capture and keyboard focus at once (one press releases
both), and a widget can't prevent it. Leaving full screen, switching sessions or the window losing focus also release
both. The program gets `{ type: "focus", value: false }` and, if it had the pointer, `{ id: "", type: "capture",
value: false }`.

# Live widgets

A template can opt into **live mode**: instead of short `init`/`update`/`view`/`draw` steps, the client starts one
long-running PsychoScript program per open widget. It keeps its state in the VM, waits on events, timers and display
frames, and renders whenever it wants. This is what minigames, timers, simulations, step-by-step animations and other
free-running widgets use. Step mode stays the default; everything in `widgets.md` still applies unless said here.

## Opting in

A template declares `mode: "live"` (default `"step"`): a field on the template (saved through `widget_template` with
`mode`, returned in template summaries and programs). A live template defines

```js
async function main(data) {
  // runs until it returns, calls widget.submit/dismiss, or the client stops it
}
```

and may omit `init`, `view`, `update` and `draw`.

## Host functions

Hosts provide exactly four functions under the global `__host` (nothing else beyond the step ABI's `__input`):

| Function | Kind | Meaning |
| --- | --- | --- |
| `__host.post(message)` | sync | send a JSON message to the client |
| `await __host.receive()` | async, idempotent | next JSON message from the client (queued in order) |
| `await __host.sleep(ms)` | async, idempotent | resolve after `ms` milliseconds (clamped to >= 0) |
| `__host.now()` | sync | monotonic milliseconds since the program started |

Everything widget-specific is built on these in the prelude, so hosts stay generic. Mobile hosts get all four from
`psychoscript-mobile`; Rune implements them in `opencode-widget`; the TUI doesn't run live widgets yet (it shows
`alt` / "Open this widget on desktop or mobile").

## Prelude API (`widget`)

The prelude exposes a `widget` object inside `main` (implemented with `__host`):

| Call | Effect |
| --- | --- |
| `widget.render(node)` | replace the widget's view tree (same nodes as step mode, `canvas` and `shader` included) |
| `widget.draw(canvasID, commands)` | replace one canvas's command list (same commands as step mode; a builder: `ui.draw()`) |
| `await widget.event()` | next user event (`press`, `change`, `pointer`; same shapes as step mode) |
| `await widget.frame()` | next display frame `{ t, dt, width, height, scale, pointer, dark }` for the widget (requests exactly one) |
| `await widget.sleep(ms)` | timer |
| `widget.now()` | monotonic ms |
| `await widget.next({ frame?, timeout? })` | whichever comes first: `{ type: "event", event }`, `{ type: "frame", frame }` or `{ type: "timeout" }` |
| `widget.submit(value)` / `widget.dismiss()` | final answer; the client stops the program |
| `widget.send(value, { wake })` | non-final message to the agent (as in step mode) |

`Math.random()` is allowed in live mode.

## Client ↔ program messages

Program → client (`post`): `{ type: "render", node }`, `{ type: "draw", id, commands }`, `{ type: "frame" }` (one
frame wanted), `{ type: "submit", value }`, `{ type: "dismiss" }`, `{ type: "send", value, wake }`.

Client → program (`receive`): `{ type: "event", event }`, `{ type: "frame", frame }` (only after a frame request, at
the next vsync while the widget is visible), `{ type: "visibility", visible }`.

## Lifecycle and budgets

- The client starts `<program>\nreturn await __widget_live(__input())` (input `{ data }`) when an open live widget
  first becomes visible, on its own thread or task, never the UI thread. Render the last `render` node; before the
  first one, show a loading frame.
- Frames are delivered only while the widget is visible and the app is foreground. Timers keep running while hidden
  but the client may pause the program when the app goes to the background: suspend it to a snapshot (PsychoScript
  `suspend`, `toBytes`) and resume it on return; if suspending fails, stop it and restart from `main` later.
- Budgets: a program that runs more than 50 ms without awaiting is stopped with an error; at most 2,000 draw commands
  per `draw`; posts beyond 240 per second are dropped with a warning; heap per program capped by the host (default 32
  MB). One error shows inline with "Restart".
- A submitted/dismissed widget (from any client) stops its program; its last rendered view stays, read-only.
- Answers and sends go to the server exactly as in step mode.

## Server

The `widget` tool validates `data` and compiles the program (syntax only) for live templates; it does not run `main`.
`widget_template` `save` takes `mode`; the mode is part of a template's version (see `widgets.md`, Template). The skill teaches when to use live mode (games, timers, animations,
simulations) and shows a small game.

## Built-in example

`minigame` (live): "tap the dots". `data: { title, seconds?: number (default 20) }`. A canvas with dots spawning on a
timer and shrinking; tap to score; shows score and time left; at the end shows the result with "Submit score" /
"Play again"; submits `{ score, seconds }`.

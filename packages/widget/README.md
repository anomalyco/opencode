# @opencode/widget

The shared widget runtime: the canonical prelude, the view node set, the step ABI and the built-in templates
(`suggestions`, `form`, `confirm`, `chart`, `backdrop`, and 17 diagrams listed in
`docs/diagrams.md`). The contracts are `specs/v2/widgets.md`
and `specs/v2/widgets-live.md`; this README is the short version for client authors in other languages (Rune desktop,
Rust). The TypeScript runtime targets Bun.

A template's `version` is the first 16 hex chars of `sha256(program + "\n" + JSON.stringify(dataSchema))`, where
`program = prelude + "\n" + source`, so a prelude change yields new versions. A live template appends `"\nlive"`, then
`"\n" + JSON.stringify(capabilities)` when it declares any: `version(source, data, mode, capabilities)`.
`compile(source, mode)` checks a template's syntax without running it and reports lines in the template source. `entry(mode)` is the line a client appends to the program to run it.

## TypeScript

```ts
import { WidgetSession, program, validateData, builtins } from "@opencode/widget"

const session = await WidgetSession.start(program(template.source), data) // or the server's `program` field
render(session.view)
const output = await session.dispatch({ id: button.id, type: "press" }) // ids come from the view
if ("submit" in output) respond({ value: output.submit })
if (output.dismiss) respond({ dismiss: true })
if (output.send) message(output.send.value, { wake: output.send.wake }) // the widget stays open

// A canvas: draw when it appears, on state changes, and per frame while it animates. Never changes the state.
const { commands } = await session.draw({ id: canvas.id, t, dt, width, height, scale, pointer, dark })
```

`step(program, input)` runs one step and `draw(program, { data, state, frame })` one draw without a session. Failures reject with `StepError` (`kind`: `error`, `timeout`
or `invalid`); keep the previous state and view and show the message inline.

## Live mode

A template with `mode: "live"` defines `async function main(data)` and runs as one long program per open widget:
`<program>\nreturn await __widget_live(__input())` with `__input()` = `{ data }` and the host functions `__host.post`,
`__host.receive`, `__host.sleep`, `__host.now` and `__host.fetch` (see `specs/v2/widgets-live.md` for the messages,
pausing and budgets). The prelude builds the program-facing `widget` object on them; model guidance with examples is
in `docs/live-guidance.md`.

`LiveWidget` is the reference host on the TypeScript interpreter, used by the tests (the TUI doesn't run live widgets):

```ts
import { LiveWidget, ManualClock, program } from "@opencode/widget"

const clock = new ManualClock() // or the default real clock
const widget = LiveWidget.start(program(template.source), data, {
  clock,
  capabilities: template.capabilities, // fetch checks https, hosts, private addresses, size, time and rate
  transport, // performs allowed requests one hop at a time; the platform fetch by default
  onMessage: (message) => console.log(message), // render, draw, frame, submit, dismiss, send
})
await widget.when((current) => current.frameRequested)
widget.frame({ t, dt, width, height, scale, pointer, dark })
widget.event({ id: canvas.id, type: "pointer", value: { kind: "down", x, y, width, height } })
widget.pause() // nothing is delivered and timers freeze until resume(), which first sends { type: "resumed", pausedMs }
widget.resume()
await clock.advance(1000) // fires due timers, letting the program react to each
const end = await widget.done // submit, dismiss, return, stop or error (a StepError)
```

It stops a program that runs 50 ms without any host call in flight (a lower bound of the spec's "without awaiting",
which it can't observe exactly: while a view has handlers the prelude keeps a `receive` in flight, so a busy loop then
goes unnoticed), rejects invalid `render`/`draw` posts and draws over 2,000 commands with an error,
and drops `render`/`draw`/`frame` posts beyond 240 a second with a warning.

## ABI for other clients

1. Fetch `GET /api/experimental/widget/template/{name}/{version}` (body wrapped in `{ data }`) once and cache it forever by `name@version`. Its `program` field is
   the full program (prelude + template); you never need a prelude of your own.
2. Compile, once per program, this PsychoScript source:

   ```js
   <program>
   return __widget_step(__input())
   ```

   with exactly one global, a synchronous host function `__input()` that returns the step input. No other globals.
   Use a timeout of at most 250 ms per step.

3. Run it for each step with a different input:

   ```ts
   type StepInput =
     | { phase: "init"; data: unknown }
     | {
         phase: "event"
         data: unknown
         state: unknown
         event: { id: string; type: "press" | "change" | "pointer" | "key" | "focus" | "fullscreen" | "capture"; value?: unknown }
       }
     | { phase: "draw"; data: unknown; state: unknown; frame: Frame }
   ```

   An `init` or `event` run returns `{ state, view, submit?, dismiss?, send? }`. Keep `state` and pass it back with
   the next event; render `view`. `submit` present (it may be `null`): send `{ value: submit }` to
   `POST /api/experimental/session/{sessionID}/widget/{messageID}/respond`. `dismiss: true`: send `{ dismiss: true }`.
   `send: { value, wake }`: deliver `value` to the agent as a message and keep the widget open (see the spec).
   A `draw` run returns `{ commands }` for a `canvas` node (see the spec's Canvas section); it never changes state.

4. Validate `view` against the node set in the spec. Drop nodes of unknown `type` from `children` (render nothing, log
   a warning) and ignore unknown props. A failed step (throw, timeout, invalid view) keeps the previous state and view
   and shows the error inline; a failed `init` shows an error card.

Event `id`s come from the nodes, where the prelude put them (templates attach handlers and never see ids): `button`
and `card` (with `id`) send `press`; `checkbox` (`boolean`), `slider` (`number`, on release), `select` (`string`, or
`string[]` when `multiple`), `input` (`string`, on commit or after 300 ms) and `carousel` (with `id`, new page index)
send `change`. `canvas` and `shader` (with `id`) send `pointer` with `{ kind: "down" | "move" | "up", x, y, width,
height }`. Keyboard, focus, full-screen and capture events (`specs/v2/widgets-input.md`) carry `id: ""`. The prelude
routes each event to the right handler or hook and drops the rest, so a client may send any event without harm.

`canvas` and `shader` nodes need a GPU-backed renderer; where you can't draw (a terminal), show `alt` (and a
`shader`'s `poster`). A `canvas` with `duration` animates until it has drawn a frame with `t >= duration`.

The `backdrop` shaders are checked with naga (`naga backdrop.wgsl out.metal`, and
`naga --shader-stage frag --entry-point widget_main --profile es300 backdrop.wgsl out.frag`) after wrapping them in
the spec's header and entry point.

## Development

The `.js` files in `src/` (`prelude.js`, `templates/*.js`) are canonical. After editing them run `bun run generate`,
which embeds them in `src/source.ts`; a test fails when the two differ.

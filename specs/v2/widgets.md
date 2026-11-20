# Widgets

Agents show interactive widgets in a session: suggestion cards with image carousels, forms with sliders, checkboxes and
selects, confirmations. A widget is a PsychoScript program from a named template plus JSON data. The server stores
templates; the agent calls the `widget` tool, and that tool call in the session history is the widget; every client
(TUI, Rune desktop, iOS, Android) downloads the template program, runs it in its own PsychoScript interpreter, and
renders the JSON view tree it returns with native components. A submission goes back to the agent, as the next prompt or
as the tool's result.

This document is the contract between the server, the shared TypeScript runtime and every client. Change it here first.

## Pieces

| Piece | Where | Owner |
| --- | --- | --- |
| Widget runtime (prelude, node schema, `WidgetSession`, built-in templates) | `packages/widget` (`@opencode/widget`) | runtime |
| RPC contract (`Widget.Definition`, `opencode.widget`) | `packages/schema/src/widget.ts` | core |
| Server plugin: `widget` and `widget_template` tools, `widgets` skill, template store, widget states, RPC handlers | `packages/plugin-widgets` (`@opencode/plugin-widgets`), registered by `packages/core/src/plugin/internal.ts` | core |
| TUI renderer | `packages/tui` | tui |
| Rune desktop renderer (Rust PsychoScript) | `anomalyco/rune-desktop` (`crates/opencode-widget` runner, `crates/opencode-widget-view` renderer) | rune |
| Mobile runner bindings (UniFFI: step, draw, WGSL translation via naga) | `anomalyco/rune-desktop` `crates/opencode-widget-ffi` | ffi |
| iOS renderer (SwiftUI, Metal for `shader`) | `anomalyco/opencode-ios` | ios |
| Android renderer (Jetpack Compose, GLES 3 for `shader`) | `anomalyco/opencode-android` | android |

Clients in scope: TUI, Rune desktop, native iOS and Android. Web/Electron is out. Mobile apps run no JavaScript: they
run programs with the Rust PsychoScript through `opencode-widget-ffi` and render natively.

PsychoScript itself (`anomalyco/psychoscript`) does not change: its repo holds only the language. The widget
"extension" is the prelude and the step ABI below, layered on the stock interpreter, with no host functions besides
`__input`.

## Template

```ts
type Template = {
  name: string          // /^[a-z][a-z0-9-]{0,47}$/, unique per server
  version: string       // first 16 hex chars of sha256(program + "\n" + JSON.stringify(data)), where
                        // program = prelude + "\n" + source; a content address that covers the prelude, since
                        // clients cache the served program by name@version forever (`version(source, data)` in
                        // @opencode/widget, synchronous)
  description: string   // one line, shown to the model when listing templates
  data: JSONSchema      // JSON Schema (draft 2020-12 subset) for the data the template takes
  source: string        // the template's PsychoScript source (see "Template source")
  mode: "step" | "live" // how clients run it; "live" templates are in widgets-live.md (stored versions without a
                        // mode are "step"). A live version hashes program + "\n" + JSON(data) + "\nlive", so the
                        // mode is part of the content address
  builtin: boolean
}
```

A template version is immutable. Saving a template with an existing name creates a new version and makes it the
latest; old versions stay retrievable forever so old widgets keep rendering.

Built-in templates ship in `@opencode/widget` and are always present: `suggestions`, `form`, `confirm`, `chart`,
`backdrop`.

## Template source

PsychoScript (confined JavaScript). It defines top-level functions:

```js
function init(data) { return { picked: null } }            // optional; default returns {}
function view(state, data) { return ui.column({}, [...]) } // required; returns a Node
function update(state, event, data) {                       // optional; default returns state
  if (event.id === "choose") return submit({ picked: state.picked }, state)
  return { ...state, picked: event.value }
}
```

`update` returns either a new state, or a step result built with the prelude helpers `submit(value, state?)` /
`dismiss(state?)` (final: the widget closes) or `send(value, state?, { wake? })` (a message to the agent; the widget
stays open). State and data are plain JSON. Programs must be deterministic and must not rely on time or
randomness.

## Prelude and step ABI

The prelude is canonical JavaScript in `packages/widget/src/prelude.js`. It defines:

- `ui`: pure node builders, one per node type. Required fields are positional, optional ones go in `props`:
  `column|row|carousel|card(props, children)` (or `(children)`), `text(text, props?)`, `markdown(text)`,
  `image(src, props?)`, `button(id, label, props?)`, `checkbox(id, label, checked, props?)`, `slider(id, props)`
  (`props` holds `value`, `min`, `max`), `select(id, options, props?)`, `input(id, value, props?)`, `divider()`.
  `children` may nest arrays and contain `null`/`undefined`/`false`, which are dropped (`cond && ui.text(...)`).
  Also `canvas(props)`, `shader(wgsl, props)` and `draw()`, the draw command builder (see Canvas).
- `submit(value, state)` and `dismiss(state)`. An omitted `state` keeps the previous state; `submit(undefined)`
  submits `null`. Both are final: the widget closes.
- `send(value, state, { wake = true })`: a non-final message to the agent; the widget stays open and can send again,
  submit or dismiss later. State handling is like `submit`, and `send(undefined)` sends `null`. `wake: false` delivers
  it without waking the agent: it sees the message on its next turn (use it for background updates).
- `__widget_step(input)`: runs one step. `init` returning `undefined` gives `{}`; `update` returning `undefined` keeps
  the state.

The server serves the full **program** = `prelude + "\n" + source`. Clients never need their own prelude copy.

To run a step, a client compiles once per template version:

```js
<program>
return __widget_step(__input())
```

with one global sync host function `__input` returning the step input, and reruns it per step. No other globals.
Limits: 250 ms timeout per step; a client may use smaller limits. (The TypeScript `psychoscript` 0.2.1 has no
separate compile step, so `@opencode/widget` parses the program on each step; a step of a built-in takes a few ms.)

Step input:

```ts
type StepInput =
  | { phase: "init"; data: unknown }
  | { phase: "event"; data: unknown; state: unknown; event: WidgetEvent }
```

Step output (the program's return value):

```ts
type StepOutput = {
  state: unknown
  view: Node
  submit?: unknown   // present: the user submitted this value
  dismiss?: true     // present: the user dismissed the widget
  send?: { value: unknown; wake: boolean }   // present: a message to the agent; the widget stays open
}
```

A step that fails (throws, times out, returns an invalid view) leaves the previous state and view in place and shows the
error inline. The first `init` step failing shows an error card with the message.

## Events

```ts
type WidgetEvent = { id: string; type: "press" | "change" | "pointer"; value?: unknown }
```

| Node | Event |
| --- | --- |
| `button`, `card` with `id` | `press` |
| `checkbox` | `change`, `value: boolean` |
| `slider` | `change`, `value: number` (send on release, not on every drag tick) |
| `select` | `change`, `value: string` or `string[]` when `multiple` |
| `input` | `change`, `value: string` (on commit / blur / debounce >= 300 ms) |
| `carousel` with `id` | `change`, `value: number` (new page index) |
| `canvas` with `id` | `pointer`, `value: { kind, x, y, width, height }` (see Canvas) |

## Nodes

Every node is `{ type, ...props }`. Unknown props are ignored; unknown node types render as nothing plus a dev warning
(the TypeScript runtime drops them from `children` before validating and reports them in `StepOutput.warnings`; an
unknown root node is an invalid view).
Keep the set small; add types here before using them.

```ts
type Tone = "default" | "muted" | "accent" | "success" | "warning" | "error"
type Node =
  | { type: "column"; children: Node[]; gap?: 0 | 1 | 2 | 3; align?: "start" | "center" | "end" | "stretch" }
  | { type: "row"; children: Node[]; gap?: 0 | 1 | 2 | 3; align?: "start" | "center" | "end"; wrap?: boolean }
  | { type: "text"; text: string; style?: "title" | "body" | "caption" | "code"; tone?: Tone }
  | { type: "markdown"; text: string }
  | { type: "image"; src: string; alt?: string; aspect?: number }   // aspect = width / height
  | { type: "carousel"; id?: string; index?: number; children: Node[] }
  | { type: "card"; id?: string; selected?: boolean; children: Node[] }
  | { type: "button"; id: string; label: string; variant?: "primary" | "secondary" | "danger"; disabled?: boolean }
  | { type: "checkbox"; id: string; label: string; checked: boolean; disabled?: boolean }
  | { type: "slider"; id: string; label?: string; value: number; min: number; max: number; step?: number }
  | { type: "select"; id: string; label?: string; options: { value: string; label: string; description?: string }[];
      value?: string | string[]; multiple?: boolean }
  | { type: "input"; id: string; label?: string; value: string; placeholder?: string; multiline?: boolean }
  | { type: "divider" }
  | { type: "canvas"; id?: string; height: number; width?: number; fps?: number; duration?: number; alt?: string }
  | { type: "shader"; id?: string; height: number; width?: number; wgsl: string; values?: number[]; fps?: number;
      alt?: string; poster?: string }
```

`canvas` and `shader` take the full available width unless `width` is set; sizes are logical pixels.

Gap units are client-relative (TUI: rows/cols; GUI: 4/8/12 px).

Image `src`: an `https:`/`http:` URL, a `data:` URI, or a path relative to the session's directory. Clients resolve
relative paths through the server's existing file content endpoint for the session's location. TUI shows `alt` (or the
file name) plus the source instead of pixels where it cannot draw images.

Carousel: one child visible at a time with paging (swipe on touch, arrows on desktop, left/right keys in the TUI) and a
page indicator. A carousel without `id` pages locally; with `id` it also emits `change`.

## Canvas

A `canvas` node is drawn by the template's optional `draw(state, data, frame)` function, which returns draw commands.
`draw` is pure: it can't change state. Animate with `frame.t`; keep anything that must persist in state via events.

Draw step input / output (same `__widget_step` entry point):

```ts
type StepInput = ... | { phase: "draw"; data: unknown; state: unknown; frame: Frame }
type Frame = {
  id: string | null   // the canvas node's id (templates with several canvases switch on it)
  t: number           // seconds since the canvas appeared
  dt: number          // seconds since the previous frame
  width: number; height: number; scale: number   // logical size and device pixel ratio
  pointer: { x: number; y: number; down: boolean } | null
  dark: boolean
}
type DrawOutput = { commands: Command[] }
```

Clients call it once when the canvas appears or state changes, then every frame while `fps > 0` (default 0, max 60;
clients may lower it, e.g. off screen, in low-power mode, or in the TUI). With `duration` (seconds), a canvas animates
only until it has drawn a frame with `t >= duration` and then draws again only on state changes (for intro
animations: `{ fps: 60, duration: 0.6 }`); `t` keeps counting from when the canvas appeared, across view updates. Budget: 8 ms per draw step and 2,000 commands
per frame; a canvas that exceeds it three frames in a row stops animating and keeps its last frame.

Commands are compact arrays, built with the prelude's `ui.draw()` builder (`const g = ui.draw(); g.rect(...);
return g.commands`). Coordinates are logical pixels, origin top-left. A `text` command's `y` is the alphabetic
baseline; `size` defaults to 13 and `color` to `"text"`.

```ts
type Command =
  | ["save"] | ["restore"] | ["translate", x, y] | ["rotate", radians] | ["scale", sx, sy] | ["alpha", a]
  | ["rect", x, y, w, h, Paint] | ["rrect", x, y, w, h, r, Paint] | ["circle", cx, cy, r, Paint]
  | ["line", x1, y1, x2, y2, Paint]
  | ["path", Segment[], Paint]   // Segment: ["M", x, y] | ["L", x, y] | ["Q", cx, cy, x, y] | ["C", c1x, c1y, c2x, c2y, x, y] | ["Z"]
  | ["text", x, y, string, { size?: number; weight?: 400 | 500 | 600 | 700; align?: "left" | "center" | "right"; color?: Color; mono?: boolean }]
  | ["image", src, x, y, w, h]
type Paint = { fill?: Color | Gradient; stroke?: Color; width?: number; cap?: "butt" | "round" }
type Color = string   // "#rgb" | "#rrggbb" | "#rrggbbaa" | a theme token: "text" | "muted" | "accent" | "bg" | "surface" | "border" | "success" | "warning" | "error"
type Gradient = { linear: [x1, y1, x2, y2]; stops: [offset: number, color: Color][] }
              | { radial: [cx, cy, r]; stops: [offset: number, color: Color][] }
```

Pointer input on a canvas with an `id` goes to `update`:
`{ id, type: "pointer", value: { kind: "down" | "move" | "up", x, y, width, height } }`, with `move` only while down
and at most once per frame. `width`/`height` are the canvas's logical size, so `update` can hit-test a layout that
follows the available width.

The builder methods push one command each and return the builder (`g.save().alpha(0.5)`): `save() restore()
translate(x, y) rotate(r) scale(sx, sy = sx) alpha(a) rect(x, y, w, h, paint) rrect(x, y, w, h, r, paint)
circle(cx, cy, r, paint) line(x1, y1, x2, y2, paint) path(segments, paint) text(x, y, string, style = {})
image(src, x, y, w, h)`, and `g.commands` is the list. A `paint` may be a `Color` string, short for `{ fill: color }`
(`{ stroke: color }` for `line`); an omitted paint is the `"text"` color. `draw` may return the builder itself. The
TypeScript runtime rejects a draw output that breaks these shapes or exceeds 2,000 commands.

## Shader

A `shader` node runs a WGSL fragment shader on the GPU, free-running at `fps` (default 60). The node's `wgsl` must define

```wgsl
fn shade(frag: vec2f) -> vec4f   // frag: pixel position, origin top-left; returns premultiplied RGBA
```

Clients prepend this header and append the entry point (and provide a full-screen-triangle vertex stage):

```wgsl
struct Widget { resolution: vec2f, time: f32, scale: f32, pointer: vec4f, values: array<vec4f, 4> }
@group(0) @binding(0) var<uniform> widget: Widget;
// ... template wgsl ...
@fragment fn widget_main(@builtin(position) p: vec4f) -> @location(0) vec4f { return shade(p.xy); }
```

`frag`, `widget.resolution` and `widget.pointer` are in physical pixels (logical × `widget.scale`), `widget.time` in
seconds since the shader appeared. Colors are sRGB-encoded: clients write them to the surface without a linear-to-sRGB
conversion. With `fps: 0` the shader renders once, and again when its `values` change.
`widget.pointer` is `(x, y, down, 0)`; `widget.values` carries the node's `values` (up to 16 floats, row-major, zero
padded), which the template sets from state in `view`. Rune passes WGSL to wgpu as is; iOS gets MSL and Android GLSL
ES 3.00 translated with naga (`opencode-widget-ffi`). Source is capped at 16 KB. A shader that fails to compile shows
`poster` (an image src) or `alt` with the error inline; one that takes over 50 ms per frame three frames in a row stops
and shows its last frame. The TUI shows `poster`/`alt` for `shader` and `alt` for `canvas`.

## Server plugin

Widgets are an internal server plugin, `@opencode/plugin-widgets`, built only on the public plugin API
(`@opencode/plugin/effect`): tools, a skill, plugin storage, an RPC registration and Session calls. Core registers it
only while the `widgets` flag is on. The flag is opt-in only: off in every build, including local and dev; enable it
with `OPENCODE_FLAGS=widgets` or `experimental.widgets: true`. Nothing in Core, Protocol, Server or the session history
schema knows about widgets.

### The widget in history

A widget is the `widget` tool call: an assistant tool part with `name: "widget"` and input
`{ template: string; data: object; title?: string; wait?: boolean }`. It is identified by the assistant message ID
plus the call ID (`messageID`, `callID`; a call ID is unique only within its message). Clients find widgets by walking
tool parts named `widget` and look up their state by `(messageID, callID)`. The completed tool part's `metadata` is
`{ template: { name, version } }`; while the call runs (or when it failed after posting) the version comes from the
state.

### State

The plugin keeps one state record per widget in its storage and is the only writer:

```ts
type State = {
  sessionID: string
  messageID: string                     // assistant message holding the widget tool call
  callID: string
  template: { name: string; version: string }
  title?: string
  status: "open" | "submitted" | "dismissed"
  response?: unknown                    // the submitted value
  wait: boolean                         // the tool call waits for the answer (see Tools)
  time: { created: number; responded?: number }   // epoch ms
}
```

A widget goes `open → submitted` or `open → dismissed`, once. States of a deleted Session are removed.

### RPC: `opencode.widget`

`Widget.Definition` in `@opencode/schema/widget`. Clients call `POST /api/rpc/opencode.widget/<method>` (through
`client.rpc(Widget.Definition)`), passing the Session's Location, and follow the event like the goal plugin's.

| Method | Input | Output | Errors |
| --- | --- | --- | --- |
| `templates` | `{}` | `Summary[]`: latest version of every template, sorted by name, without source | |
| `program` | `{ name, version? }` | `Program`: that immutable version, or the latest when `version` is omitted | `not_found` |
| `states` | `{ sessionID }` | `State[]` of the Session, oldest first | |
| `respond` | `{ sessionID, messageID, callID, response: { value } \| { dismiss: true } }` | the new `State` | `not_found`, `closed` (`data: { status }`) |
| `send` | `{ sessionID, messageID, callID, value, wake? }` | the `State` (unchanged) | `not_found`, `closed`, `rate_limited` |

```ts
type Summary = { name: string; version: string; description: string; data: JSONSchema; mode: "step" | "live"; builtin: boolean }
type Program = Summary & { source: string; program: string }   // program = prelude + "\n" + source
```

Event `changed`, `{ sessionID, state: State }`, published (as `rpc.opencode.widget.changed`) in the Session's Location
whenever a widget is posted or answered. A client fetches `states` when it opens a Session or reconnects, since changes
published meanwhile were missed, and applies `changed` after that.

`program` responses never change for a given `name@version`; clients cache them forever. Every version a widget refers
to stays retrievable, including built-in versions from older releases (the plugin stores a built-in's version when a
widget uses it). `send` allows 10 messages per widget per second (process-local); past that it fails with
`rate_limited` and clients should drop or coalesce.

### Delivery to the model

Answers and sends reach the model as synthetic messages admitted with `ctx.session.synthetic`, which steer like a
prompt: an idle Session starts a turn, a busy one takes them at its next step.

| | `text` | `description` | `metadata.widget.kind` | wakes |
| --- | --- | --- | --- | --- |
| submitted | `User responded to widget "<label>": <JSON value>` | `Responded to "<label>"` | `response` | yes |
| dismissed | `User dismissed widget "<label>"` | `Dismissed "<label>"` | `response` | yes |
| send | `Widget "<label>" sent: <JSON value>` | `<label>: <value>` (strings raw, else JSON, cut at 80) | `message` | `wake` (default true) |

`metadata` is `{ widget: { messageID, callID, kind } }`; clients detect these by `metadata.widget`, never by text, and
show them as one quiet line (`◈ <description>` in the TUI). `<label>` is the title, or the template name. A send with
`wake: false` is admitted without waking (`resume: false`): it stays pending and the model sees it with the next turn.

Waiting tool calls and the lock that serializes respond and send live in the server process, shared by every Location
and plugin reload in it; this assumes one server process per database, like the goal plugin.

Respond writes the state first and then admits the message. These are two writes without a transaction: if the server
dies between them, the widget shows as answered but the model never hears of it (the user can say so in the prompt).
Respond and send for one process are serialized, so a widget is answered once.

## Tools

`widget` — show a widget.

```ts
input: { template: string; data: object; title?: string; wait?: boolean }
```

The plugin resolves the latest version, validates `data` against the template's JSON Schema, and runs the `init` step
with `@opencode/widget` once to fail fast on broken programs (errors go back to the model as the tool error). It then
stores the widget's state and publishes `changed`.

- `wait` omitted or `false`: returns at once with `Widget "<title>" is shown to the user. Their response arrives as the
  next message; end your turn now unless there is unrelated work to do.` The answer arrives as a synthetic message.
- `wait: true`: blocks until the final answer from any client, like the `question` tool. A submission returns
  `User responded to widget "<label>": <JSON value>` as the tool result (metadata adds `response`); a dismissal returns a
  tool error `User dismissed widget "<label>"`, which the model sees and continues with; no synthetic message is
  admitted for an answer the tool returned. Waiters live in the server process: when the user stops the call
  (interrupt), or the server restarts, the call ends, the widget stays open, and a later answer is delivered as a
  synthetic message with a wake. A send while the tool waits is still a synthetic message.

`widget_template` — manage templates. The input is one flat object (union inputs are poorly supported by some
providers); fields an action needs are checked at run time.

```ts
input: {
  action: "list" | "get" | "save"  // list: names, descriptions, data schemas; get: the latest version with source
  name?: string                    // get, save
  description?: string             // save
  data?: JSONSchema                // save; top-level `type` must be "object"
  source?: string                  // save
  mode?: "step" | "live"           // save; default "step"
  example?: object                 // save
}
```

`save` validates the name, checks `example` against the schema, and runs `init` (which renders the first `view`) with
`example` before storing; a live template is only compiled. The `widget` tool likewise validates data and only
compiles a live template's program, never running `main`. Built-in names cannot be overwritten. Saving content that already exists (same version) makes
that version the latest again and updates its description.

Permission actions are `widget` (resource: the template name) and `widget_template` (resource: the template name, or
`*` for list). The plugin's agent transform allows both for the Build agent, `widget` for Plan, and denies `widget` for
the `general` subagent; configured rules still win.

The `widgets` skill (shipped by the plugin) covers when to show a widget, when to `wait`, how to fill each built-in,
and the template language. Tool descriptions teach the node set and the ABI briefly and point at it.

## Built-in templates

`suggestions` — 2 or 3 options to pick from, each with an image carousel (the Mother bot "Suggestions" card).

```ts
data: {
  title: string
  options: { label: string; note?: string; images: string[]; recommended?: boolean }[]  // 2..3 options, 1..3 images
  allowNote?: boolean   // default true: a free-text note sent with the pick
}
submit: { choice: string /* label */; index: number; note?: string }
```

`form` — fields with a submit button.

```ts
data: {
  title: string
  description?: string
  submitLabel?: string
  fields: (
    | { key: string; type: "text"; label: string; placeholder?: string; multiline?: boolean; default?: string }
    | { key: string; type: "number"; label: string; min: number; max: number; step?: number; default?: number }  // slider
    | { key: string; type: "boolean"; label: string; default?: boolean }                                      // checkbox
    | { key: string; type: "select"; label: string; options: { value: string; label: string }[]; multiple?: boolean; default?: string | string[] }
  )[]
}
submit: Record<string, string | number | boolean | string[]>
```

`confirm` — `data: { title: string; message: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean }`,
`submit: { confirmed: boolean }`.

`chart` — a `canvas` demo: an animated bar or line chart.

```ts
data: {
  title: string
  kind: "bar" | "line"
  series: { label: string; values: number[]; color?: string /* #rgb | #rrggbb */ }[]  // 1..6 series, 1..60 values
  labels?: string[]   // x axis labels per value index
  unit?: string       // "%" and other one-character units attach ("12%"), longer ones are spaced ("12 ms")
  choose?: boolean    // default false
}
submit: { series: string /* label */; index: number; value: number }   // only with choose, on a tap
```

It animates in over 0.65 s (`fps: 60, duration: 0.65`), then draws only on state changes, except while the pointer is
down. Pressing or dragging shows the value under the pointer (a tooltip and a caption under the chart); the selection
stays after release, and a tap outside the plot clears it.

`backdrop` — a `shader` demo: `data: { title: string; preset: "plasma" | "aurora" | "waves"; text?: string /* markdown */;
accent?: string /* #rgb | #rrggbb */ }`, submits nothing. The banner is followed by the title, the text and a speed
slider (0–2, 0 pauses with `fps: 0`); `values` is `[speed, accent r, g, b]`.

## Client behaviour

- Render each `widget` tool call inline in the timeline at its position, from its tool input plus its state.
- `open`: interactive. `submitted` / `dismissed`: render the final view read-only with a status line ("Submitted",
  "Dismissed"); for a submitted widget, rerun `init` and show the response summary (clients do not persist the local
  state).
- Local state lives only on the client that the user is interacting with; other clients see the result when the
  state turns `submitted`.
- Post a step's `send` output with `send`; keep the widget interactive.
- Fetch templates by `name@version` and cache them; show a loading placeholder while fetching.
- Run steps off the render path where the platform allows; steps are small, so synchronous is acceptable in v1.

# Widgets

Agents show interactive widgets in a session: suggestion cards with image carousels, forms with sliders, checkboxes and
selects, confirmations. A widget is a PsychoScript program from a named template plus JSON data. The server stores
templates; the agent posts a widget message into the session history; every client (TUI, Rune desktop) downloads the template program, runs it in its own PsychoScript interpreter, and renders the JSON view tree it
returns with native components. A submission goes back to the agent as the next prompt.

This document is the contract between the server, the shared TypeScript runtime and every client. Change it here first.

## Pieces

| Piece | Where | Owner |
| --- | --- | --- |
| Widget runtime (prelude, node schema, `WidgetSession`, built-in templates) | `packages/widget` (`@opencode/widget`) | runtime |
| Widget message, events, template store, `widget` and `widget_template` tools, HTTP API | `packages/schema`, `packages/core`, `packages/protocol`, `packages/server`, `packages/client` | core |
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
  builtin: boolean
}
```

A template version is immutable. Saving a template with an existing name creates a new version and makes it the
latest; old versions stay retrievable forever so old widget messages keep rendering.

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

## Widget message

A new session message type in `Session.Message.Info` (`packages/schema/src/session-message.ts`):

```ts
type Widget = {
  id: MessageID
  type: "widget"
  time: { created: DateTime; responded?: DateTime }
  metadata?: Record<string, unknown>
  title?: string
  template: { name: string; version: string }
  data: unknown
  tool?: { messageID: MessageID; callID: string }  // the assistant tool call that posted it
  status: "open" | "submitted" | "dismissed"
  response?: unknown                                // the submitted value
}
```

`status` is `"open"` until the one response; `response` is set only for `"submitted"` (it may be `null`). On the wire
`time.*` are epoch milliseconds, like every other message.

Events (durable, event-sourced like other messages, in the `/api/event` stream and the session log):

```ts
type WidgetPosted = {
  type: "session.widget.posted"
  data: {
    sessionID: SessionID
    messageID: MessageID                             // the widget message's ID
    title?: string
    template: { name: string; version: string }
    data: unknown
    tool?: { messageID: MessageID; callID: string }
  }
}
type WidgetResponded = {
  type: "session.widget.responded"
  data: { sessionID: SessionID; messageID: MessageID; status: "submitted" | "dismissed"; response?: unknown }
}
```

The posted event projects a widget message with `status: "open"` and `time.created` = the event's `created`; the
responded event sets `status`, `response` and `time.responded` (= the event's `created`) on an open widget and is
ignored for one that is not open. A widget can be responded to once; later responses fail with a conflict.

Model-facing: the widget message itself is not sent to the model. The `widget` tool result tells the model the widget is
shown and to end its turn. A response appends a synthetic prompt to the session (steered, waking the session like a user
prompt; `metadata: { widget: { messageID } }`, `description` `Responded to "<label>"` / `Dismissed "<label>"`), with
text `User responded to widget "<label>": <JSON value>` or `User dismissed widget "<label>"`, where `<label>` is the
title, or the template name when there is no title.

## HTTP API

The routes are experimental (repo rule for new endpoints), so they live under `/api/experimental` and in the generated
client under `client.experimental`. Like every other route, JSON success bodies are wrapped in `{ data }`; the generated
TypeScript client unwraps it. Template routes are global (no location query).

| Route | Response | SDK |
| --- | --- | --- |
| `GET /api/experimental/widget/template` | `{ data: Summary[] }`: latest version of every template, without `source`, sorted by name | `experimental.widget.template.list()` |
| `GET /api/experimental/widget/template/{name}` | `{ data: Program }`: the latest version | `experimental.widget.template.latest({ name })` |
| `GET /api/experimental/widget/template/{name}/{version}` | `{ data: Program }` with `Cache-Control: public, max-age=31536000, immutable` | `experimental.widget.template.get({ name, version })` |
| `POST /api/experimental/session/{sessionID}/widget/{messageID}/respond` | 204; body `{ value: unknown }` or `{ dismiss: true }` | `experimental.session.widget.respond({ sessionID, messageID, payload })` |

```ts
type Summary = { name: string; version: string; description: string; data: JSONSchema; builtin: boolean }
type Program = Summary & { source: string; program: string }   // program = prelude + "\n" + source
```

Errors (JSON bodies with a `_tag`):

- template routes: 404 `{ _tag: "WidgetTemplateNotFoundError", template, version?, message }`.
- respond: 404 `SessionNotFoundError` (unknown session), 404 `MessageNotFoundError` (no widget message with that ID in
  the session), 409 `{ _tag: "WidgetAlreadyRespondedError", sessionID, messageID, status: "submitted" | "dismissed",
  message }`, 400 for a body that is neither shape.

Every template version a widget message refers to stays retrievable by `name@version`, including built-in versions
from older releases (the server stores a built-in's version when a widget using it is posted).

Clients get widget messages through the normal session message list (`type=widget` filters them) and event stream,
like every other message.

## Tools

`widget` — show a widget.

```ts
input: { template: string; data: unknown; title?: string }
```

The server resolves the latest version, validates `data` against the template's JSON Schema, and runs the `init` step
with `@opencode/widget` once to fail fast on broken programs (errors go back to the model as the tool error). On success
it posts the widget message and returns `Widget "<title>" is shown to the user. Their response arrives as the next
message; end your turn now unless there is unrelated work to do.`

`widget_template` — manage templates. The input is one flat object (union inputs are poorly supported by some
providers); fields an action needs are checked at run time.

```ts
input: {
  action: "list" | "get" | "save"  // list: names, descriptions, data schemas; get: the latest version with source
  name?: string                    // get, save
  description?: string             // save
  data?: JSONSchema                // save; top-level `type` must be "object"
  source?: string                  // save
  example?: unknown                // save
}
```

`save` validates the name, checks `example` against the schema, and runs `init` (which renders the first `view`) with
`example` before storing. Built-in names cannot be overwritten. Saving content that already exists (same version) makes
that version the latest again and updates its description.

Both tools are registered behind the `widgets` flag (on in local and dev builds, off in releases until shipped). Their
permission actions are `widget` (resource: the template name) and `widget_template` (resource: the template name, or
`*` for list); the Build agent allows both, Plan allows `widget`, and the `general` subagent denies `widget`.

Tool descriptions should teach the model the node set and the ABI briefly and point at `suggestions` and `form` as
examples to copy.

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

- Render the widget message inline in the timeline at its position.
- `open`: interactive. `submitted` / `dismissed`: render the final view read-only with a status line ("Submitted",
  "Dismissed"); for a submitted widget, rerun `init` and show the response summary (clients do not persist the local
  state).
- Local state lives only on the client that the user is interacting with; other clients see the result when the
  message turns `submitted`.
- Fetch templates by `name@version` and cache them; show a loading placeholder while fetching.
- Run steps off the render path where the platform allows; steps are small, so synchronous is acceptable in v1.

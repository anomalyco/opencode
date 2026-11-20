<!--
  Built-in skill, registered with the widget tools in
  packages/core/src/tool/plugin/widget.ts when the `widgets` flag is on.
  The body below becomes the skill's content.
-->

# Widgets

The `widget` tool shows an interactive card inline in the conversation. It renders natively in every client, and the
user's answer comes back as your next message.

## When to show a widget

Show one when the user should pick, tune or confirm something, and clicking beats typing:

- **Pick between 2–3 things they should see**: designs, photos, places, products, layouts → `suggestions`.
- **Several structured inputs at once**: settings, parameters, a booking, a release config → `form`. Use sliders for
  numbers with a range, checkboxes for on/off, selects for fixed choices.
- **Approve something consequential**: deploy, delete, send, spend → `confirm` (set `danger: true` when it can't be
  undone).
- **Numbers that read better as a picture**: a trend, a comparison, a breakdown → `chart` (add `choose: true` when the
  user should pick one of the bars or points).
- **A celebratory or atmospheric banner** with a short message → `backdrop`.
- **Anything else that is a small interactive surface** and fits no built-in → write a template (below).

Don't show one for a single free-text question, a plain yes/no in passing, or when the user asked for an explanation.
Use the `question` tool for text-only choices.

## How to show one well

- Show it early. Gather only what the widget needs; don't research for many steps before the user has seen anything.
  If they want more detail, they'll say so in their answer.
- `data` is a JSON object, never a string. It must match the template's schema; errors come back as the tool error,
  so fix the data and call again rather than giving up.
- Images: real `https:` URLs you know resolve, `data:` URIs, or paths relative to the session directory (for example
  files you just generated). Never invent image URLs.
- Give it a short `title`; the transcript uses it.
- After the widget is shown, end your turn. Don't repeat the options in text.
- The answer arrives as `User responded to widget "<title>": <JSON>` or `User dismissed widget "<title>"`. Act on it.
- Messages a widget sends while it stays open arrive as `Widget "<title>" sent: <JSON>`.

## Waiting for the answer

`wait: true` makes the `widget` call block until the user answers and return the answer as its result, like the
`question` tool; a dismissal comes back as a tool error saying so. You keep working in the same turn.

- Wait when you need the answer to continue right now: a short decision, a confirmation before a step, a small form
  whose values feed the next tool call.
- Don't wait for widgets the user may leave open for a while, live widgets that `send` updates (games, dashboards,
  step-by-step controls), or when the user may want to think or reply in text. Show those without `wait` and end your
  turn; the answer and any messages arrive as your next input.
- If the user stops the call while you wait, the widget stays open and its answer arrives later as a message.

## Built-in templates

`suggestions` — submits `{ choice, index, note? }`:

```json
{
  "title": "Which landing page?",
  "options": [
    {
      "label": "Bold",
      "note": "Big type, one CTA",
      "images": ["shots/bold-desktop.png", "shots/bold-mobile.png"],
      "recommended": true
    },
    { "label": "Calm", "images": ["shots/calm.png"] }
  ],
  "allowNote": true
}
```

2–3 options, 1–3 images each (several images become a swipeable carousel).

`form` — submits `{ [key]: value }`:

```json
{
  "title": "Configure the release",
  "submitLabel": "Start release",
  "fields": [
    { "key": "name", "type": "text", "label": "Release name", "default": "Spring" },
    { "key": "rollout", "type": "number", "label": "Rollout %", "min": 0, "max": 100, "step": 5, "default": 25 },
    { "key": "notify", "type": "boolean", "label": "Notify subscribers", "default": true },
    {
      "key": "channel",
      "type": "select",
      "label": "Channel",
      "options": [
        { "value": "stable", "label": "Stable" },
        { "value": "beta", "label": "Beta" }
      ]
    }
  ]
}
```

`confirm` — submits `{ confirmed }`: `{ "title": "Deploy main?", "message": "Ships **3 commits** to production.", "confirmLabel": "Deploy", "danger": false }`.

`chart` — submits nothing, or `{ series, index, value }` when `choose` is true and the user taps a bar or point:

```json
{
  "title": "Weekly signups",
  "kind": "bar",
  "unit": "k",
  "labels": ["W1", "W2", "W3", "W4"],
  "series": [
    { "label": "Organic", "values": [4.2, 5.1, 4.8, 6.3] },
    { "label": "Paid", "values": [2.0, 2.4, 3.1, 2.9], "color": "#f59e0b" }
  ]
}
```

`kind` is `bar` (grouped per label) or `line`; up to 6 series of up to 60 values. Pressing shows a value.

`backdrop` — submits nothing: `{ "title": "v2 is live", "preset": "aurora", "text": "Thanks **everyone**.", "accent": "#2dd4bf" }`
(`preset`: `plasma`, `aurora` or `waves`).

## Writing a template

Use `widget_template` with `action: "get"` on `suggestions` or `form` first and copy their patterns, then
`action: "save"` with `name`, `description`, `data` (a JSON Schema with top-level `type: "object"`), `source` and an
`example` that matches the schema. Saving renders the example once; fix the errors it returns. Saved templates are
reusable in later sessions, so make them general and put the specifics in `data`.

The source is confined JavaScript (no imports, timers, randomness or I/O) with top-level functions:

```js
function init(data) { return { picked: null } }            // optional, the initial state
function view(state, data) { return ui.column({}, [...]) } // required, returns the view tree
function update(state, event, data) {                       // optional, returns the next state
  if (event.id === "choose") return submit({ picked: state.picked }, state)
  return { ...state, picked: event.value }
}
```

State and data are plain JSON. `update` may return `submit(value, state)` to send `value` to you, or `dismiss(state)`;
both close the widget. `send(value, state, { wake })` sends `value` to you and keeps the widget open: use it for live
events or messages to the agent (a move in a game, "run this step now"), and `{ wake: false }` for background updates
you should only see on your next turn (a running tally, the latest slider position). Omitted `state` keeps the current
state. Events are `{ id, type: "press" | "change" | "pointer", value? }`.

Node builders (props are optional objects; tone is default|muted|accent|success|warning|error; gap is 0..3):

```
ui.column(props, children)   { gap, align: start|center|end|stretch }
ui.row(props, children)      { gap, align: start|center|end, wrap }
ui.text(text, props)         { style: title|body|caption|code, tone }
ui.markdown(text)
ui.image(src, props)         { alt, aspect }            aspect = width / height
ui.carousel(props, children) { id, index }              one child at a time; with id it sends change with the page
ui.card(props, children)     { id, selected }           with id it sends press
ui.button(id, label, props)  { variant: primary|secondary|danger, disabled }    sends press
ui.checkbox(id, label, checked, props)                  sends change with a boolean
ui.slider(id, { label, value, min, max, step })         sends change with a number
ui.select(id, [{ value, label, description }], { label, value, multiple })      sends change, string or string[]
ui.input(id, value, { label, placeholder, multiline })  sends change with a string
ui.divider()
ui.canvas({ id, height, width, fps, duration, alt })    drawn by draw(); with id it sends pointer
ui.shader(wgsl, { id, height, width, values, fps, alt, poster })   a WGSL fragment shader
```

Children may contain `null` or `false` (for `cond && node`) and nested arrays.

## Canvas and shader

Use a **canvas** for custom 2D graphics driven by data and state: charts, diagrams, gauges, small games, anything that
needs exact shapes, text placement or pointer input. Use a **shader** for full-surface GPU effects that are a function
of the pixel position and time: animated backgrounds, gradients, noise, generative art. A shader can't draw text or
read data beyond 16 numbers, so put text in normal nodes next to it. Always set `alt` (terminals show it instead), and
keep both sparse: they cost battery on phones.

**Canvas.** Define `draw(state, data, frame)` and return draw commands; it is pure (no state changes) and runs when the
canvas appears, when state changes, and every frame while `fps > 0` (default 0, max 60). `frame` is
`{ id, t, dt, width, height, scale, pointer: { x, y, down } | null, dark }`, `t` in seconds since it appeared. For an
intro animation, set `{ fps: 60, duration: 0.6 }`: it animates until a frame with `t >= duration` is drawn. With an
`id`, pointer input arrives in `update` as `{ id, type: "pointer", value: { kind: "down" | "move" | "up", x, y, width,
height } }` (`move` only while down). Coordinates are logical pixels from the top left; the canvas fills the width
unless `width` is set, so lay out from `frame.width` (or the event's `width` in `update`). At most 2,000 commands.

```
const g = ui.draw()               every method returns g; return g.commands (or g)
g.save()  g.restore()  g.translate(x, y)  g.rotate(radians)  g.scale(sx, sy)  g.alpha(0..1)
g.rect(x, y, w, h, paint)  g.rrect(x, y, w, h, radius, paint)  g.circle(cx, cy, r, paint)
g.line(x1, y1, x2, y2, paint)
g.path([["M", x, y], ["L", x, y], ["Q", cx, cy, x, y], ["C", c1x, c1y, c2x, c2y, x, y], ["Z"]], paint)
g.text(x, y, string, { size, weight: 400|500|600|700, align: left|center|right, color, mono })   y is the baseline
g.image(src, x, y, w, h)
paint: { fill: color | gradient, stroke: color, width, cap: butt|round }, or a color string (fill; stroke for line)
color: "#rgb" | "#rrggbb" | "#rrggbbaa" | text|muted|accent|bg|surface|border|success|warning|error (theme colors)
gradient: { linear: [x1, y1, x2, y2], stops: [[0, color], [1, color]] } or { radial: [cx, cy, r], stops }
```

```js
function view(state, data) {
  return ui.column({ gap: 1 }, [
    ui.text(data.title, { style: "title" }),
    ui.canvas({ id: "gauge", height: 120, fps: 60, duration: 0.8, alt: data.title + ": " + data.value + "%" }),
  ])
}
function draw(state, data, frame) {
  const g = ui.draw()
  const p = (Math.min(1, frame.t / 0.8) * data.value) / 100
  g.rrect(0, 40, frame.width, 16, 8, "surface")
  g.rrect(0, 40, frame.width * p, 16, 8, "accent")
  g.text(frame.width / 2, 90, Math.round(p * 100) + "%", { size: 20, weight: 600, align: "center" })
  return g.commands
}
```

**Shader.** `wgsl` defines `fn shade(frag: vec2f) -> vec4f`, returning premultiplied sRGB RGBA for the pixel at `frag`
(physical pixels, origin top left). The client provides this uniform; don't redeclare it:

```wgsl
struct Widget { resolution: vec2f, time: f32, scale: f32, pointer: vec4f, values: array<vec4f, 4> }
@group(0) @binding(0) var<uniform> widget: Widget;
```

`resolution` is the size in physical pixels, `scale` the pixel ratio, `pointer` is `(x, y, down, 0)` and `values` holds
the node's `values` (up to 16 numbers, zero padded: `values[0].x` is the first). Drive `values` from state in `view`;
`fps` defaults to 60 (use 0 when nothing moves). Keep it under 16 KB and cheap: no loops over many iterations.

```js
const WGSL = `
fn shade(frag: vec2f) -> vec4f {
  let uv = frag / widget.resolution;
  let t = widget.time * widget.values[0].x;
  let c = 0.5 + 0.5 * cos(t + uv.xyx * 3.0 + vec3f(0.0, 2.0, 4.0));
  return vec4f(c, 1.0);
}`
function init() {
  return { speed: 1 }
}
function view(state) {
  return ui.column({ gap: 1 }, [
    ui.shader(WGSL, { height: 160, values: [state.speed], alt: "Shifting colors" }),
    ui.slider("speed", { label: "Speed", value: state.speed, min: 0, max: 3, step: 0.1 }),
  ])
}
function update(state, event) {
  return { speed: event.value }
}
```

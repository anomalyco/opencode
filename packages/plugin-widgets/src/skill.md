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

## Diagrams

Built-in canvas templates for showing data. Each takes `title`; `choose: true` adds a Choose button that submits the
selected element (for `pie`, `{ label, index, value, share }`). Without `choose` they submit nothing: the user explores
and you keep talking, so end your turn only if you asked something. Get exact schemas with `widget_template` `list`.

| Template | Data (caps) | Use it for |
| --- | --- | --- |
| `pie` | `slices: { label, value }[]` (≤ 12), `donut?`, `unit?` | Parts of one whole; over 6 slices use `chart` bars |
| `scatter` | `series: { label, points: { x, y, size?, label? }[] }[]`, `xLabel?`, `yLabel?`, `trend?` | How two measures relate; `size` for bubbles |
| `histogram` | `values: number[]` (raw, ≤ 2,000), `bins?`, `unit?` | The distribution of one measure |
| `area` | `series: { label, values }[]`, `labels?`, `mode?: stacked \| percent \| stream` | Totals and composition over time |
| `heatmap` | `layout: "matrix"` (`rows`, `columns`, `values[row][col]`) or `"calendar"` (`days: { date, value }[]`) | Intensity across two categories, or daily activity |
| `treemap` | `items: { label, value?, children? }[]` (≤ 4 levels) | What takes the space in a hierarchy |
| `sankey` | `nodes: { id, label? }[]`, `links: { source, target, value }[]` | Flows that split and merge |
| `graph` | `nodes: { id, label?, group? }[]` (≤ 40), `edges: { source, target, label? }[]`, `directed?` | Networks without a hierarchy |
| `tree` | `root: { label, note?, children? }` (≤ 6 levels), `orientation?: right \| down` | Hierarchies: org charts, file trees |
| `timeline` | `tasks: { label, start, end?, group?, progress? }[]`, `today?` | Schedules (Gantt); no `end` is a milestone |
| `funnel` | `stages: { label, value }[]` (2–10) | Step-by-step drop-off with conversion rates |
| `radar` | `axes: string[]` (3–12), `series: { label, values }[]`, `max?` | A few items scored on several dimensions |
| `gauge` | `gauges: { label, value, min?, max, unit?, target?, bands? }[]` (1–4) | Headline KPIs against thresholds |
| `boxplot` | `groups: { label, values? \| stats? }[]` (≤ 12) | Comparing distributions across groups |
| `flowchart` | `nodes: { id, label?, shape? }[]`, `edges: { from, to, label? }[]` | Processes and decision logic |
| `sequence` | `participants: string[]`, `messages: { from, to, label, kind? }[]` | Interactions over time between systems |
| `table` | `columns: { label, unit?, digits? }[]`, `rows: { cells, trend? }[]` (≤ 50) | Exact values to scan and sort |

For one or two plain series over categories or time, use `chart`.

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

## Live templates

A **live** template runs one program for as long as the widget is open: it keeps state in variables, waits for taps,
timers and display frames, and renders whenever it wants. Use it when something happens **without the user acting**:
games, timers and countdowns, step-by-step animations and simulations, dashboards that refresh themselves. Stay with
step mode for pickers, forms, confirmations and charts: it's cheaper, works in the terminal (which can't run live
widgets), and the server can run it to check it; a live widget's `main` only runs on the user's device,
so the server only checks that it compiles. The built-in `minigame` (`{ "title": "Tap the dots", "seconds": 20 }`,
submits `{ score, seconds }`) is one.

Save it with `mode: "live"` and define `async function main(data)` instead of `init`/`view`/`update`/`draw`. It runs
until it returns, calls `widget.submit(...)` / `widget.dismiss()`, or the widget closes:

```
widget.render(node)                      replace the view (any ui.* node)
widget.draw(canvasID, g)                 replace a canvas's drawing (g = ui.draw())
await widget.event()                     next user event { id, type, value }
await widget.frame()                     next display frame { t, dt, width, height, scale, pointer, dark }
await widget.next({ frame, timeout })    first of { type: "event", event } | { type: "frame", frame }
                                           | { type: "timeout" } | { type: "resumed", pausedMs }
await widget.sleep(ms) / widget.now()    timers; now() is ms running, not counting pauses
await widget.fetch(url, { method, headers, body })   HTTPS → { ok, status, headers, text(), json() }
widget.submit(value) / widget.dismiss()  final answer; the program stops
widget.send(value, { wake })             a message to you while the widget stays open
```

- Ask for a frame (`widget.next({ frame: true })`) only while something moves, handle events between frames and draw
  on the frame. Call `widget.render` only when layout or text changes; put per-frame changes in a canvas.
- Never run 50 ms without an `await`; keep each `draw` under 2,000 commands.
- The program pauses when the widget is out of view; `widget.next` then gives `{ type: "resumed", pausedMs }` first.
- `Math.random()` is fine. Always set the canvas `alt`.

```js
// Catch the ball: it bounces around; tap it to score. Submits { score }.
async function main(data) {
  widget.render(
    ui.column({ gap: 1 }, [
      ui.text(data.title, { style: "title" }),
      ui.canvas({ id: "court", height: 240, alt: "Catch the ball game" }),
    ]),
  )
  const ball = { x: 60, y: 60, vx: 180, vy: 140, r: 22 }
  const end = widget.now() + (data.seconds ?? 15) * 1000
  let score = 0
  while (widget.now() < end) {
    const next = await widget.next({ frame: true, timeout: end - widget.now() })
    if (next.type === "event" && next.event.type === "pointer" && next.event.value.kind === "down") {
      if (Math.hypot(next.event.value.x - ball.x, next.event.value.y - ball.y) <= ball.r + 8) {
        score++
        ball.vx *= 1.1
      }
    }
    if (next.type !== "frame") continue
    const f = next.frame
    ball.x += ball.vx * f.dt
    ball.y += ball.vy * f.dt
    if (ball.x < ball.r || ball.x > f.width - ball.r) ball.vx = -ball.vx
    if (ball.y < ball.r || ball.y > f.height - ball.r) ball.vy = -ball.vy
    ball.x = Math.max(ball.r, Math.min(f.width - ball.r, ball.x))
    ball.y = Math.max(ball.r, Math.min(f.height - ball.r, ball.y))
    const g = ui.draw()
    g.text(12, 24, "Score " + score, { size: 16, weight: 600 })
    g.text(f.width - 12, 24, Math.ceil((end - widget.now()) / 1000) + "s", { align: "right", color: "muted" })
    g.circle(ball.x, ball.y, ball.r, "accent")
    widget.draw("court", g)
  }
  widget.render(
    ui.column({ gap: 1 }, [
      ui.text("You caught it " + score + " times", { style: "title" }),
      ui.button("done", "Submit", { variant: "primary" }),
    ]),
  )
  while ((await widget.event()).id !== "done") {}
  widget.submit({ score })
}
```

### Capabilities

A live template that calls `widget.fetch` declares the hosts it needs in `capabilities`, as few as it can:
`{ "https": { "hosts": ["api.github.com"] } }` (exact hosts, `*.example.com`, or `["*"]` only if it truly needs any
host). Clients show the hosts on the widget. Requests are HTTPS only, at most 4 in flight and 10 a second, 15 s and
2 MB each; failures reject with `{ kind, message }`. Step templates can't declare capabilities. Fetch from the widget
only for live dashboards that must refresh while open; otherwise fetch the data yourself and pass it in `data`.

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

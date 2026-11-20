<!-- Keep it general: contracts and decisions. Full tested examples: packages/widget/docs/, plugin-widgets/test/fixtures/. -->

# Widgets

The `widget` tool shows an interactive surface inline in the conversation, rendered natively by every client.

## What a widget can be

- **Choices, forms, confirmations**: cards with images, text inputs, sliders, checkboxes, selects, buttons.
- **Data pictures**: charts and 17 diagram types (built in), or your own **canvas** drawing (2D commands).
- **GPU shaders**: a WGSL fragment shader for animated, generative or 3D (raymarched) visuals.
- **Live programs**: an `async main` running while the widget is open, with timers, frames, pointer input and HTTPS
  fetch: games, timers, simulations, animations, self-refreshing dashboards.
- **Full screen**: `fullscreen: true` on the root node lets clients offer a full-screen button (games, big visuals);
  `fill: true` on a canvas or shader grows it to the screen's height.

Decide in this order:

1. A **built-in** fits (table below)? Use it with data; nothing to write.
2. It changes only when the user acts? Write a **step** template (cheaper, works everywhere, the terminal included).
3. Something happens on its own (time, frames, polling)? Write a **live** template (`mode: "live"`).
4. Inside either: plain nodes for UI and text, `canvas` for exact 2D shapes and pointer input, `shader` for
   full-surface GPU effects (it can't draw text; put text in nodes beside it).

Not for one free-text question, a passing yes/no or an explanation (use `question` for text-only choices).

## Showing one

- `data` is a JSON object matching the template's schema; fix errors from the tool and call again. Give a short `title`.
- Images: real `https:` URLs, `data:` URIs, or paths relative to the session directory. Never invent URLs.
- Without `wait`: end your turn; don't repeat the options in text. The answer arrives as
  `User responded to widget "<title>": <JSON>` / `User dismissed widget "<title>"`; open widgets may also send
  `Widget "<title>" sent: <JSON>`.
- `wait: true`: the call blocks and returns the answer (a dismissal is a tool error), like `question`: for short
  decisions you need this turn, never for live or long-open widgets.

## Built-ins

All take `title`. Exact schemas: `widget_template` `list`; real sources to copy: `widget_template` `get <name>`.
Diagrams submit nothing unless `choose: true` adds a Choose button that submits the selected element.

| Template | Data | Submits |
| --- | --- | --- |
| `suggestions` | `options: { label, note?, images[1-3], recommended? }[2-3]`, `allowNote?` | `{ choice, index, note? }` |
| `form` | `fields[]` of `text`, `number` (slider: min, max, step), `boolean`, `select` (options, multiple) | `{ [key]: value }` |
| `confirm` | `message` (markdown), `confirmLabel?`, `danger?` | `{ confirmed }` |
| `chart` | `kind: bar \| line`, `labels`, `series: { label, values }[≤6]`, `unit?`, `choose?` | nothing, or the tapped point |
| `backdrop` | `preset: plasma \| aurora \| waves`, `text?`, `accent?` (an animated shader banner) | nothing |
| `minigame` | `seconds?` (live: tap the dots) | `{ score, seconds }` |

**Diagrams** (field names in `list`): `pie` slices ≤ 12 (parts of a whole) · `scatter` x/y points, `size`, `trend` ·
`histogram` raw values ≤ 2,000 · `area` series over time, stacked/percent/stream · `heatmap` matrix or calendar ·
`treemap` nested items ≤ 4 levels · `sankey` nodes and weighted links (flows) · `graph` ≤ 40 nodes and edges ·
`tree` a hierarchy ≤ 6 levels · `timeline` tasks with start/end (Gantt) · `funnel` 2–10 stages · `radar` 3–12 axes ·
`gauge` 1–4 KPIs with targets · `boxplot` groups ≤ 12 · `flowchart` nodes and edges · `sequence` participants and
messages · `table` ≤ 50 sortable rows with sparklines. For one or two plain series, use `chart`.

## Writing a template

`widget_template` `save`: `name`, `description`, `data` (JSON Schema, `type: "object"`), `source`, an `example`
matching the schema, `mode: "live"` for live ones. Saving again makes a new version; templates persist, so keep them
general and put specifics in `data`.

The server never runs template code. It parses and lints the source: required entry functions, only function and
`const` declarations at the top level (nothing runs at load), no prelude names (`ui`, `widget`, `submit`, `dismiss`,
`send`, ...) redeclared, at most 128 KB. Runtime errors come back from the clients that show the widget, as
`Widget "<title>" failed on <client>: <phase>: <message> (line N, col M)` (or as the tool error with `wait: true`):
fix the source, save it again and show the widget again.

**Step ABI.** Confined JavaScript, plain JSON state:
`init(data)` → state (optional) · `view(state, data)` → node (required) · `update(state, event, data)` → next state, or
`submit(value, state)` / `dismiss(state)` (final) / `send(value, state, { wake })` (a message to you; widget stays open;
`wake: false` = you see it next turn) · `draw(state, data, frame)` → canvas commands (pure). Events are
`{ id, type: "press" | "change" | "pointer", value? }`. No timers, randomness or I/O.

```js
function init(data) { return { pick: null } }
function view(state, data) { return ui.column({ gap: 1 }, [ui.text(data.title, { style: "title" }), ...data.items.map((item) => ui.button(item, item))]) }
function update(state, event) { return submit({ pick: event.id }, state) }
```

**Live API** (`mode: "live"`, define `async function main(data)`; `Math.random()` allowed):
`widget.render(node)` · `widget.draw(canvasID, g)` · `await widget.event()` · `await widget.frame()` →
`{ t, dt, width, height, scale, pointer, dark }` · `await widget.next({ frame, timeout })` → event | frame | timeout |
`{ type: "resumed", pausedMs }` · `await widget.sleep(ms)` · `widget.now()` (pauses don't count) ·
`await widget.fetch(url, init)` · `widget.submit(v)` / `widget.dismiss()` / `widget.send(v, { wake })`. Ask for a frame
only while something moves, and call `render` only when the view changes (or a shader's `values` do).

```js
async function main(data) {
  let left = data.seconds
  while (left > 0) { widget.render(ui.text(left + " s", { style: "title" })); await widget.sleep(1000); left-- }
  widget.submit({ done: true })
}
```

**Nodes** (`ui.*`; props optional; children may hold `null`/`false` and nested arrays):
`column(props, children)` / `row(props, children)` gap 0-3, align · `text(text, { style, tone })` · `markdown(text)` ·
`image(src, { alt, aspect })` · `carousel({ id, index }, children)` change → page · `card({ id, selected }, children)`
press · `button(id, label, { variant, disabled })` press · `checkbox(id, label, checked)` change → boolean ·
`slider(id, { label, value, min, max, step })` change → number · `select(id, options, { value, multiple })` change ·
`input(id, value, { placeholder, multiline })` change → string · `divider()` ·
`canvas({ id, height, width?, fps, duration, alt, fill })` pointer · `shader(wgsl, { id, height, values, fps, alt, poster, fill })` pointer.

**Draw** (`const g = ui.draw()`, chainable): `save restore translate rotate scale alpha rect rrect circle line path
text(x, y, s, { size, weight, align, color, mono }) image`; paint is a color, a theme name (`text muted accent bg
surface border success warning error`) or `{ fill | stroke, width, gradient }`. Lay out from `frame.width`; ≤ 2,000
commands per draw.

**Shader.** `wgsl` defines `fn shade(frag: vec2f) -> vec4f` (physical pixels, origin top left; premultiplied sRGB).
The client provides `widget: { resolution, time, scale, pointer: (x, y, down, 0), values: array<vec4f, 4> }` (don't
redeclare it). Pass state as `values` (≤ 16 numbers, `values[0].x` first); a new view that changes only `values` just
updates the uniforms, so a live program can re-render every frame (3D games: physics in `main`, a raymarched scene in
WGSL, ≤ 64 march steps). With an `id` it sends `pointer` events like a canvas. ≤ 16 KB; keep it cheap.

**Capabilities and fetch** (live only): declare hosts as narrowly as possible, e.g.
`capabilities: { https: { hosts: ["api.github.com", "*.example.com"] } }` (`["*"]` only if truly any host). HTTPS
only; the local network is blocked; ≤ 4 requests in flight and 10 a second; 15 s timeout; 2 MB responses. Fetch from
the widget only for dashboards that must refresh while open; otherwise fetch the data yourself and pass it in `data`.

**Keys and capture**: a focused widget gets `key` (`{ kind, key, code, shift, alt, ctrl, meta }`) and `focus` events;
`widget.capturePointer()` / `releasePointer()` (or root `capture: "pointer"`) gives relative `pointer` moves `{ dx, dy }`.
Esc is reserved (it releases both); mobile has hardware keys only and no capture.

**Limits.** A step must finish in 250 ms; a live program must `await` at least every 50 ms; ≤ 240 posts a second;
pausing (out of view, background) freezes timers and frames. Always set `alt` on canvas and shader nodes: the terminal
shows it, and it can't run live widgets.

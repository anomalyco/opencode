<!-- Keep it general: contracts and decisions. Full tested examples: packages/widget/docs/, plugin-widgets/test/fixtures/. -->

# Widgets

The `widget` tool shows an interactive surface inline in the conversation, rendered natively by every client.

## What a widget can be

- **Choices, forms, confirmations**: cards with images, text inputs, sliders, checkboxes, selects, buttons.
- **Data pictures**: charts and 17 diagram types (built in), or your own **canvas** drawing (2D commands).
- **GPU canvases**: a canvas drawn by a WGSL fragment shader for animated, generative or 3D (raymarched) visuals.
- **Live programs**: an `async main` running while the widget is open, with timers, frames, pointer input and HTTPS
  fetch: games, timers, simulations, animations, self-refreshing dashboards.
- **Full screen**: `fullscreen: true` on the root node lets clients offer a full-screen button (games, big visuals);
  `fill: true` on a canvas grows it to the screen's height. The close button then covers the top-right
  corner: keep content out of the area in `close` (`onFullscreen`'s third argument; `frame.close` on a canvas).

Decide in this order:

1. A **built-in** fits (table below)? Use it with data; nothing to write.
2. It changes only when the user acts? Write a **step** widget template (cheaper, works everywhere, the terminal included).
3. Something happens on its own (time, frames, polling)? Write a **live** widget template (`mode: "live"`).
4. Inside either: plain nodes for UI and text, a `canvas` for exact 2D shapes and pointer input, or a `canvas` with
   `wgsl` for full-surface GPU effects (it can't draw text; put text in nodes beside it).

Not for one free-text question, a passing yes/no or an explanation (use `question` for text-only choices).

## Showing one

- `data` is a JSON object matching the widget template's schema; fix errors from the tool and call again. Give a short `title`.
- Images: real `https:` URLs, `data:` URIs, or paths relative to the session directory. Never invent URLs.
- Without `wait`: end your turn; don't repeat the options in text. The answer arrives as
  `User responded to widget "<title>": <JSON>` / `User dismissed widget "<title>"`; open widgets may also send
  `Widget "<title>" sent: <JSON>`.
- Iterating on a widget you showed (a fix, new data, the next step)? Post the new one with `replaces: "<call ID>"`
  from the old result; the old one closes as superseded.
- `wait: true`: the call blocks and returns the answer (a dismissal is a tool error), like `question`: for short
  decisions you need this turn, never for live or long-open widgets.

## Built-ins

All take `title`. Exact schemas: `widget_template` `list`; real sources to copy: `widget_template` `get <name>`.
Diagrams submit nothing unless `choose: true` adds a Choose button that submits the selected element.

| Widget template | Data                                                                                             | Submits                      |
| --------------- | ------------------------------------------------------------------------------------------------ | ---------------------------- |
| `suggestions`   | `options: { label, note?, images[1-3], recommended? }[2-3]`, `allowNote?`                        | `{ choice, index, note? }`   |
| `form`          | `fields[]` of `text`, `number` (slider: min, max, step), `boolean`, `select` (options, multiple) | `{ [key]: value }`           |
| `confirm`       | `message` (markdown), `confirmLabel?`, `danger?`                                                 | `{ confirmed }`              |
| `chart`         | `kind: bar \| line`, `labels`, `series: { label, values }[≤6]`, `unit?`, `choose?`               | nothing, or the tapped point |
| `backdrop`      | `preset: plasma \| aurora \| waves`, `text?`, `accent?` (an animated shader banner)              | nothing                      |

**Diagrams** (field names in `list`): `pie` slices ≤ 12 (parts of a whole) · `scatter` x/y points, `size`, `trend` ·
`histogram` raw values ≤ 2,000 · `area` series over time, stacked/percent/stream · `heatmap` matrix or calendar ·
`treemap` nested items ≤ 4 levels · `sankey` nodes and weighted links (flows) · `graph` ≤ 40 nodes and edges ·
`tree` a hierarchy ≤ 6 levels · `timeline` tasks with start/end (Gantt) · `funnel` 2–10 stages · `radar` 3–12 axes ·
`gauge` 1–4 KPIs with targets · `boxplot` groups ≤ 12 · `flowchart` nodes and edges · `sequence` participants and
messages · `table` ≤ 50 sortable rows with sparklines. For one or two plain series, use `chart`.

## Writing a widget template

`widget_template` `save`: `name`, `description`, `data` (JSON Schema, `type: "object"`), `source`, an `example`
matching the schema, `mode: "live"` for live ones. Saving again makes a new version; widget templates persist, so keep them
general and put specifics in `data`. To change a widget template, prefer `edit` (`edits: [{ oldText, newText }]`, each
matching once) over resending the source; a widget template you didn't create in this session, change only when the user
asks, otherwise copy it with `from` under a new name. The server only parses and lints the source (entry functions,
only function and `const` declarations at the top level, no prelude names redeclared, ≤ 128 KB). A program error
comes back as `Widget "<title>" failed on <client>: <phase>: <message> (line N, col M)` (the tool error with
`wait: true`), on its own for widget templates saved in this session, otherwise when the user asks you to fix it: fix the
source, save it and show the widget again.

**Handlers.** Attach handlers to nodes (`onPress`, `onChange`, `onPointer`); the prelude gives nodes ids and routes
each event to its node only. Set `key` on list items that come and go (`ui.row({ key: item.id }, ...)`) so they keep
their identity. Keys, focus, full screen and pointer capture only reach hooks you define.

**Step ABI.** Confined JavaScript, JSON state, no timers, randomness or I/O. `init(data)` → state (optional) ·
`view(state, data)` → node · `draw(state, data, frame)` → canvas commands (pure; `frame.key` is the canvas's `key`).
Handlers get `(state, value)` and return the next state, `submit(value)` / `dismiss()` (final) or
`send(value, { wake, state })` (a message to you; stays open; `wake: false` = next turn). Hooks: `onKey(state, key)`,
`onFocus(state, focused)`, `onFullscreen(state, on, close)`, `onCapture(state, on)`.

```js
function view(state, data) {
  return ui.column(
    { gap: 1 },
    data.items.map((item) => ui.button(item, { onPress: () => submit({ pick: item }) })),
  )
}
```

**Live API** (`async function main(data)`; `Math.random()` allowed; handlers get only the value and run between your
awaits): `widget.render(node)` · `widget.draw(key, g)` · `await widget.frame()` → `{ t, dt, width, height, scale,
pointer, dark }` · `await widget.sleep(ms)` · `widget.now()` (pauses don't count) · `widget.on("key" | "focus" |
"fullscreen" | "capture" | "resumed" | "storage", fn)` → unsubscribe · `widget.keys` (held codes) · `widget.pointer` ·
`await widget.fetch(url, init)` · `widget.submit(v)` / `dismiss()` / `send(v, { wake })` ·
`widget.capturePointer()` / `releasePointer()`. After `main` returns, the view's handlers keep running. Ask for frames
only while something moves; render only when the view (or a canvas's `values`) changes.

```js
async function main(data) {
  let left = data.seconds
  widget.render(ui.button("Stop", { onPress: () => widget.submit({ left }) }))
  while (left > 0) {
    await widget.sleep(1000)
    left--
  }
  widget.submit({ left })
}
```

**Nodes** (`ui.*`; props optional; children may hold `null`/`false` and nested arrays): `column(props, children)` /
`row(props, children)` gap 0-3, align · `text(text, { style, tone })` · `markdown(text)` · `image(src, { alt, aspect })`
· `carousel({ index, onChange }, children)` · `card({ selected, onPress }, children)` · `button(label, { variant,
disabled, onPress })` · `checkbox(label, checked, { onChange })` · `slider({ label, value, min, max, step, onChange })`
· `select(options, { value, multiple, onChange })` · `input(value, { placeholder, multiline, onChange })` · `divider()`
· `table(columns, rows, { sort, selected, onPress, onSort })`: data as a real table, drawn like the client's markdown
tables; columns are labels or `{ label, align: "end" }` (numbers), rows arrays of strings and numbers (≤ 16 columns,
≤ 500 rows). `onPress(state, row)` on a row; `onSort(state, column)` on a header, and `sort: { column, descending }`
shows the indicator: sort `rows` yourself
· `stack(props, children)`: layers children, the last on top, each placed by its `place` (`top-left` … `bottom-right`,
`center`, `fill`) and `inset`; taps pass through text and images to what's below (a HUD over a canvas)
· `canvas({ height, width, fps, duration, alt, poster, fill, key, onPointer, wgsl, values })`: drawn by `draw` with 2D
commands, or with `wgsl` by that shader (never both). Pointers are `{ kind: down|move|up, x, y, width, height }`,
or `{ kind, dx, dy, button }` under capture (`widget.capturePointer()` or root `capture: "pointer"`; Esc always
releases it; not on mobile).

**Draw** (`const g = ui.draw()`, chainable): `save restore translate rotate scale alpha rect rrect circle line path
text(x, y, s, { size, weight, align, color, mono }) image`; paint is a color, a theme name (`text muted accent bg
surface border success warning error`) or `{ fill | stroke, width, gradient }`. Lay out from `frame.width`; ≤ 2,000
commands per draw.

**GPU canvas.** `wgsl` defines `fn shade(frag: vec2f) -> vec4f` (physical pixels, origin top left; premultiplied sRGB).
The client provides `widget: { resolution, time, scale, pointer: (x, y, down, 0), values: array<vec4f, 4> }` (don't
redeclare it). Pass state as `values` (≤ 16 numbers); a view that changes only `values` just updates the uniforms, so a
live program can re-render every frame (3D games: physics in `main`, a raymarched scene, ≤ 64 march steps). ≤ 16 KB.

**Fetch** (live only): declare hosts narrowly, e.g. `capabilities: { https: { hosts: ["api.github.com"] } }`. HTTPS
only; the local network is blocked; ≤ 4 in flight and 10 a second; 15 s; 2 MB. Only for widgets that must refresh
while open; otherwise fetch the data yourself and pass it in `data`.

**Storage** (live only): `capabilities: { storage: {} }` gives the widget data kept on this server and synced to the
user's other devices, shared by every widget of the same template name (every version and session). `widget.storage.get(key)`
and `widget.storage.keys(prefix?)` read the local copy at once; `await widget.storage.set(key, value)` (JSON) and `await
widget.storage.delete(key)` write; `widget.on("storage", ({ key, value }) => …)` hears changes from elsewhere (`value`
`null` when deleted): re-render then. Use one key per record (`entry:<time>:<random>`), so writes from two devices never
overwrite each other. Keys ≤ 256 characters, values ≤ 64 KiB of JSON, ≤ 1,000 keys and 1 MiB per template. Clients
without spaces sync (iOS for now, the web host) throw `Unsupported` on first use.

**Limits.** A step must finish in 250 ms; a live program must `await` at least every 50 ms; ≤ 240 posts a second;
pausing (out of view) freezes timers and frames. Always set `alt` on canvases: the terminal shows it.

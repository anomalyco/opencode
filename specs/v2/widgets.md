# Widgets

Agents show interactive widgets in a session: suggestion cards with image carousels, forms with sliders, checkboxes and
selects, confirmations. A widget is a PsychoScript program from a named template plus JSON data. The server stores
templates; the agent posts a widget message into the session history; every client (TUI, app/desktop, mobile, Rune
desktop) downloads the template program, runs it in its own PsychoScript interpreter, and renders the JSON view tree it
returns with native components. A submission goes back to the agent as the next prompt.

This document is the contract between the server, the shared TypeScript runtime and every client. Change it here first.

## Pieces

| Piece | Where | Owner |
| --- | --- | --- |
| Widget runtime (prelude, node schema, `WidgetSession`, built-in templates) | `packages/widget` (`@opencode/widget`) | runtime |
| Widget message, events, template store, `widget` and `widget_template` tools, HTTP API | `packages/schema`, `packages/core`, `packages/protocol`, `packages/server`, `packages/client` | core |
| TUI renderer | `packages/tui` | tui |
| App / desktop (Electron) renderer | `packages/app`, `packages/session-ui` | app |
| Mobile renderer | `anomalyco/mobilecode` | mobile |
| Rune desktop renderer (Rust PsychoScript) | `anomalyco/rune-desktop` | rune |

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

Built-in templates ship in `@opencode/widget` and are always present: `suggestions`, `form`, `confirm`.

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
`dismiss(state?)`. State and data are plain JSON. Programs must be deterministic and must not rely on time or
randomness.

## Prelude and step ABI

The prelude is canonical JavaScript in `packages/widget/src/prelude.js`. It defines:

- `ui`: pure node builders, one per node type. Required fields are positional, optional ones go in `props`:
  `column|row|carousel|card(props, children)` (or `(children)`), `text(text, props?)`, `markdown(text)`,
  `image(src, props?)`, `button(id, label, props?)`, `checkbox(id, label, checked, props?)`, `slider(id, props)`
  (`props` holds `value`, `min`, `max`), `select(id, options, props?)`, `input(id, value, props?)`, `divider()`.
  `children` may nest arrays and contain `null`/`undefined`/`false`, which are dropped (`cond && ui.text(...)`).
- `submit(value, state)` and `dismiss(state)`. An omitted `state` keeps the previous state; `submit(undefined)`
  submits `null`.
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
}
```

A step that fails (throws, times out, returns an invalid view) leaves the previous state and view in place and shows the
error inline. The first `init` step failing shows an error card with the message.

## Events

```ts
type WidgetEvent = { id: string; type: "press" | "change"; value?: unknown }
```

| Node | Event |
| --- | --- |
| `button`, `card` with `id` | `press` |
| `checkbox` | `change`, `value: boolean` |
| `slider` | `change`, `value: number` (send on release, not on every drag tick) |
| `select` | `change`, `value: string` or `string[]` when `multiple` |
| `input` | `change`, `value: string` (on commit / blur / debounce >= 300 ms) |
| `carousel` with `id` | `change`, `value: number` (new page index) |

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
```

Gap units are client-relative (TUI: rows/cols; GUI: 4/8/12 px).

Image `src`: an `https:`/`http:` URL, a `data:` URI, or a path relative to the session's directory. Clients resolve
relative paths through the server's existing file content endpoint for the session's location. TUI shows `alt` (or the
file name) plus the source instead of pixels where it cannot draw images.

Carousel: one child visible at a time with paging (swipe on touch, arrows on desktop, left/right keys in the TUI) and a
page indicator. A carousel without `id` pages locally; with `id` it also emits `change`.

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

Events (event-sourced like other messages): `session.widget.posted` and `session.widget.responded`. A widget can be
responded to once; later responses fail with a conflict.

Model-facing: the `widget` tool result tells the model the widget is shown and to end its turn. A response appends a
prompt to the session (as a synthetic user-visible message) and starts a turn:
`User responded to widget "<title or template>": <JSON value>` or `User dismissed widget "<title>"`.

## HTTP API

Follow the existing v2 HttpApi groups in `packages/protocol/src/groups`; regenerate `packages/client`.

- `GET  /widget/template` → `Template[]` (latest version of every template, without `source`)
- `GET  /widget/template/{name}` → latest `Template & { program: string }`
- `GET  /widget/template/{name}/{version}` → `Template & { program: string }`, immutable: `Cache-Control: public,
  max-age=31536000, immutable`. Clients cache by `name@version` forever.
- `POST /session/{sessionID}/widget/{messageID}/respond` body `{ value: unknown } | { dismiss: true }` → 204.
  409 when already responded, 404 when unknown.

Clients get widget messages through the normal session message list and event stream, like every other message.

## Tools

`widget` — show a widget.

```ts
input: { template: string; data: unknown; title?: string }
```

The server resolves the latest version, validates `data` against the template's JSON Schema, and runs the `init` step
with `@opencode/widget` once to fail fast on broken programs (errors go back to the model as the tool error). On success
it posts the widget message and returns `Widget "<title>" is shown to the user. Their response arrives as the next
message; end your turn now unless there is unrelated work to do.`

`widget_template` — manage templates.

```ts
input:
  | { action: "list" }                                  // names, descriptions, data schemas
  | { action: "get"; name: string }                     // includes source
  | { action: "save"; name: string; description: string; data: JSONSchema; source: string; example: unknown }
```

`save` validates the schema, checks `example` against it, and runs `init` plus one `view` with `example` before storing.
Built-in names cannot be overwritten.

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

## Client behaviour

- Render the widget message inline in the timeline at its position.
- `open`: interactive. `submitted` / `dismissed`: render the final view read-only with a status line ("Submitted",
  "Dismissed"); for a submitted widget, rerun `init` and show the response summary (clients do not persist the local
  state).
- Local state lives only on the client that the user is interacting with; other clients see the result when the
  message turns `submitted`.
- Fetch templates by `name@version` and cache them; show a loading placeholder while fetching.
- Run steps off the render path where the platform allows; steps are small, so synchronous is acceptable in v1.

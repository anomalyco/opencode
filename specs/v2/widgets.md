# Widgets

Agents show interactive widgets in a session: suggestion cards with image carousels, forms with sliders, checkboxes and
selects, confirmations. A widget is a PsychoScript program from a named widget template plus JSON data. The server stores
widget templates; the agent calls the `widget` tool, and that tool call in the session history is the widget; every client
(TUI, Rune desktop, iOS, Android) downloads the widget template program, runs it in its own PsychoScript interpreter, and
renders the JSON view tree it returns with native components. A submission goes back to the agent, as the next prompt or
as the tool's result.

This document is the contract between the server, the shared TypeScript runtime and every client. Change it here first.
The app-store rules widgets must meet, and what's still to do for them, are in `widgets-store-policy.md`.

## Pieces

| Piece | Where | Owner |
| --- | --- | --- |
| Widget runtime (prelude, node schema, `WidgetSession`, built-in widget templates) | `packages/widget` (`@opencode/widget`) | runtime |
| RPC contract (`Widget.Definition`, `opencode.widget`) | `packages/schema/src/widget.ts` | core |
| Server plugin: `widget` and `widget_template` tools, `widgets` skill, widget template store, widget states, RPC handlers | `packages/plugin-widgets` (`@opencode/plugin-widgets`), registered by `packages/core/src/plugin/internal.ts` | core |
| TUI renderer | `packages/tui` | tui |
| Rune desktop renderer (Rust PsychoScript) | `anomalyco/rune-desktop` (`crates/opencode-widget` runner, `crates/opencode-widget-view` renderer) | rune |
| Mobile runner (`psychoscript-mobile`: UniFFI wrapper of the Rust PsychoScript with live runs, generic host functions, WGSL translation via naga) | `anomalyco/psychoscript`, `mobile` branch | psychoscript |
| Web host (the Rust PsychoScript compiled to wasm, and a TypeScript DOM renderer), embedded by Console artifacts (branch `widget-artifacts`) | `anomalyco/psychoscript`, `web` branch | psychoscript |
| iOS widget glue and renderer (SwiftUI, Metal for GPU canvases) | `anomalyco/opencode-ios` | ios |
| Android widget glue and renderer (Jetpack Compose, GLES 3 for GPU canvases) | `anomalyco/opencode-android` | android |

Clients in scope: TUI, Rune desktop, native iOS and Android, and the web host. Mobile apps run no JavaScript: they run
programs with the Rust PsychoScript through `psychoscript-mobile` and render natively; the widget glue (the step and
live calls, rendering, the RPC) lives in each app.

The widget "extension" is the prelude and the step ABI below, layered on the stock interpreter: a step uses no host
functions besides `__input`, and live mode adds the generic `__host` functions (`widgets-live.md`). Nothing
widget-specific goes into PsychoScript (`anomalyco/psychoscript`) or `psychoscript-mobile`.

## Widget template

```ts
type WidgetTemplate = {
  name: string          // /^[a-z][a-z0-9-]{0,47}$/, unique per server
  version: string       // first 16 hex chars of sha256(program + "\n" + JSON.stringify(data)), where
                        // program as served (below); a content address that covers the preludes, since
                        // clients cache the served program by name@version forever (`version(source, data)` in
                        // @opencode/widget, synchronous)
  description: string   // one line, shown to the model when listing widget templates
  data: JSONSchema      // JSON Schema (draft 2020-12 subset) for the data the widget template takes
  source: string        // the widget template's PsychoScript source (see "Widget template source")
  mode: "step" | "live" // how clients run it; "live" widget templates are in widgets-live.md (stored versions without a
                        // mode are "step"). A live version hashes program + "\n" + JSON(data) + "\nlive", so the
                        // mode is part of the content address; declared capabilities follow as
                        // "\n" + JSON(capabilities)
  capabilities?: { https?: { hosts: string[] }; storage?: {} }  // live widget templates only (widgets-live.md, Capabilities)
  builtin: boolean
}
```

A widget template version is immutable. Saving a widget template with an existing name creates a new version and makes it the
latest; old versions stay retrievable forever so old widgets keep rendering.

Built-in widget templates ship in `@opencode/widget` and are always present: `suggestions`, `form`, `confirm`, `chart`,
`backdrop`, and the diagrams `pie`, `scatter`, `histogram`, `area`, `heatmap`, `treemap`, `sankey`,
`graph`, `tree`, `timeline`, `funnel`, `radar`, `gauge`, `boxplot`, `flowchart`, `sequence`, `table`
(`packages/widget/docs/diagrams.md`).

## Widget template source

PsychoScript (confined JavaScript). It defines top-level functions; input arrives through **handlers on nodes**:

```js
function init(data) { return { picked: null } }            // optional; default returns {}
function view(state, data) {                                // required; returns a Node
  return ui.column({}, [
    data.items.map((item, index) =>
      ui.card({ key: item, selected: state.picked === index, onPress: (state) => ({ ...state, picked: index }) }, [
        ui.text(item),
      ]),
    ),
    ui.button("Choose", { onPress: (state) => submit({ picked: state.picked }) }),
  ])
}
```

A handler gets the current state (and the event's value, see Events) and returns the next state, or a step result
built with the prelude helpers `submit(value)` / `dismiss()` (final: the widget closes) or
`send(value, { wake?, state? })` (a message to the agent; the widget stays open). Returning `undefined` keeps the
state. Optional top-level **hooks** take the events that belong to no node: `onKey(state, key)`,
`onFocus(state, focused)`, `onFullscreen(state, on, close)` and `onCapture(state, captured)` (`widgets-input.md`,
`widgets-fullscreen.md`); a widget template without a hook never sees that event. State and data are plain JSON. Programs
must be deterministic and must not rely on time or randomness. There is no `update` function: the lint rejects one.

## Prelude and step ABI

The prelude is canonical JavaScript in `packages/widget/src/prelude.js`, and the **live prelude**, what only live
programs use (`widget`, with `widget.gpu`, and `__widget_live`; `widgets-live.md`, `widgets-gpu.md`), in
`packages/widget/src/prelude-live.js`. The prelude defines:

- `ui`: pure node builders, one per node type. Required fields are positional, optional ones and handlers go in
  `props`: `column|row|carousel|card(props, children)` (or `(children)`), `text(text, props?)`, `markdown(text)`,
  `image(src, props?)`, `button(label, props?)`, `checkbox(label, checked, props?)`, `slider(props)` (`props` holds
  `value`, `min`, `max`), `select(options, props?)` (options may be strings), `input(value, props?)`, `divider()`,
  `table(columns, rows, props?)` (columns may be strings).
  `children` may nest arrays and contain `null`/`undefined`/`false`, which are dropped (`cond && ui.text(...)`).
  Also `canvas(props)` (with `wgsl` in `props` for a GPU canvas) and `draw()`, the draw command builder (see Canvas). Authors never set
  `id`; a node's `key` (a string, a number or a boolean) names it among its siblings (Keys and depth).
- `submit(value)` and `dismiss()`: final, the widget closes; the state stays. `submit(undefined)` submits `null`.
- `send(value, { wake = true, state })`: a non-final message to the agent; the widget stays open and can send again,
  submit or dismiss later. `state`, when given, becomes the next state. `send(undefined)` sends `null`. `wake: false`
  delivers it without waking the agent: it sees the message on its next turn (use it for background updates).
- `__widget_protocol`, on the prelude's first line: the version of the prelude↔host contract (Protocol).
- `__widget_native_step(input)`: runs one step (below; Native hosts).

**Ids.** Before a view reaches the client, the host (Native hosts) turns the tree widget templates build into the tree clients get: it
flattens `children`, removes handler functions and `key`s, and gives each interactive node an `id` derived from its
path: the root is `0` (or `:key`), a child appends `/` and its index among its parent's children (`2`, or `2.1` for
the second item of a nested array at index 2; a `null`/`false` hole keeps its index) or `:key` when it has a `key`
(URI-encoded; a repeated key gets `~2`, `~3`, ...). So `0/:alice/1` is the second child of the sibling keyed `alice`.
`button`, `checkbox`, `slider`, `select` and `input` always get an id; `card` and `carousel` get one with a handler;
`canvas` with `onPointer` or a `key`. The same node keeps its id from one view to the next as long as its
path does, which keys make true for lists that change shape. The prelude finds an id's handler by following the id's
path through the view.

**Keys and depth.** Two rules for every view, checked when the host turns it into the tree clients get (lint can't
check them, so they are runtime rules):

- A node's `key` is a string, a number (finite or not) or a boolean; `undefined` and `null` mean no key. Any other key
  (an object, an array, a function) fails the view with `A node's key must be a string, a number or a boolean`.
- A view nests at most 100 levels: the root is level 1, the items of a node's `children` are one level below the
  node, and the items of an array inside `children` one level below that array. A node or an array below level 100
  fails the view with `The view nests more than 100 levels`.

Either failure is a program error in phase `view` (Failures), with exactly that message and no line or column; in
a step, the state and view stay as they were.

**Steps.** `init` runs `init(data)` (`undefined` gives `{}`) and `view`. `event` routes `input.event`:

- `key`, `focus`, `fullscreen`, `capture`: to the matching hook with the decoded value, never to a node.
- `press`, `change`, `pointer`: the prelude runs `view(state, data)` to rebuild the table, then calls the handler of the
  node with `event.id`, only if the node takes that event type (Events), with the value decoded and checked against
  the node. Anything else (an unknown id, a node without a handler, the wrong type, a value that doesn't fit) changes
  nothing.

Then it runs `view` on the next state. `draw` calls `draw(state, data, frame)` with `frame.key` (the canvas's `key`, or
`null`) instead of `frame.id`.

The server serves the full **program**: `prelude + "\n" + source` for a step widget template, `prelude + "\n" +
livePrelude + "\n" + source` for a live one. Clients never need their own copy of either. Each version keeps the
program it was saved with. The source starts on the program's line `program lines − source lines + 1`, which is how
clients make positions source-relative (Failures).

To run a step, a client compiles once per widget template version:

```js
<program>
return __widget_native_step(__input())
```

with two global sync host functions, `__input` returning the step input and `__widget_emit` taking the view (Native
hosts), and reruns it per step. No other globals.

**Typed arrays.** Every widget run (steps, draws and live runs) has PsychoScript's typed arrays, which hosts turn on
(`Runtime.make({ typedArrays: true })`; Rust `Runtime::typed_arrays(true)`): the globals `ArrayBuffer`, `Uint8Array`,
`Uint16Array`, `Uint32Array`, `Int32Array`, `Float32Array` and `Float64Array`. They are for building data in a program
and for `widget.gpu`'s writes (`widgets-gpu.md`); the run's result can't hold one, so a step whose `state`, `submit` or
`send` holds one fails, as before.
Limits: 250 ms timeout per step; a client may use smaller limits. (`@opencode/widget` compiles each program text once,
with `Runtime.compile`, and keeps the 32 last used.)

**Budgets count CPU time.** The program budgets (the 250 ms step timeout, the live 50 ms slice without awaiting, the 8
ms draw budget) count the CPU time of the thread running the program while it runs the program; host work (host
functions, encoding a view, the host's own work on that thread) isn't counted. A run whose thread wasn't scheduled, on a
loaded machine, isn't over budget: a lagging thread isn't the program's fault. A wall-clock backstop of 10 times the
budget (2.5 s, 500 ms, 80 ms) remains, only for a program stuck in a synchronous host call, where its thread uses no
CPU. Hosts that can't measure it use wall clock for the budgets and say so: the web host's worker (browsers have no
thread CPU clock) and the TypeScript host (Bun and Node: the TUI, and `@opencode/widget`'s tests and tools). Bun and
Node have a thread CPU clock (`process.threadCpuUsage()`), but the TypeScript interpreter runs in slices on the event
loop it shares with everything else on that thread, and PsychoScript's `timeoutMs` counts wall clock, so the thread's
CPU time would count the host's work too. The server never runs a program.

### Protocol

The prelude↔host contract has a version, `__widget_protocol`, raised whenever that contract changes (the entries,
the host globals, what crosses between them). History: protocol 1 was the prelude building the tree itself, with
`return __widget_step(__input())` and no declaration; protocol 2 is native hosts (below), the only one the prelude
implements now. The prelude's first line declares it, so a program's first line is exactly

```js
const __widget_protocol = 2
```

A host reads it from the program text before it runs the program (after fetching it, when it compiles it): the
first line matching `^const __widget_protocol = (\d+)$` gives the version; a program whose first line doesn't match
is protocol 1. A host runs only the protocols it implements (the hosts in this document: 2) and refuses the others
without running anything:

- **An older protocol**: a program error (Failures) with the message `This widget was built with an older widget
  runtime; ask the agent to post it again`, in the phase of the step or run refused (`init`, `event`, `draw`; `main`
  for a live run), reported once like any program error, so the agent can post the widget again.
- **A newer protocol**: a client error (the app is older than the widget): show `This widget needs a newer version of
  this app`, log it in dev builds, and don't report it.

Either way the client shows the message without a Try again or Restart action: no retry can succeed. An embedder
without an agent session (Console artifacts) may replace the older-protocol wording with its own, such as `This
artifact was shared with an older widget runtime; share it again from its widget template.`

Before release, decide whether the server serves stored widget templates (programs saved under older preludes) with
the current prelude, which would make the older-protocol case one of cached programs only.

**Heap cap.** Every run of a program, a step (`init`, `event`, `draw`) or a live run, has a heap cap set by the host,
32 MB by default. A run that exceeds it stops with a program error (see Failures) with the message
`It used more than 32 MB of memory` (the host's cap in place of 32), no `line` or `column`, and `phase` the step's
phase (`init`, `event`, `draw`) or `main` for a live run.

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
error inline. The first `init` step failing shows an error card with the message. Either way it is a program error
(see Failures), which the client sends with the `report` RPC, since the server never runs widget template code.

### Native hosts

Building the tree clients get costs a JavaScript pass over every node of every view, which is slow on the Rust
interpreter. Every host is a **native host**: it does it natively, while it converts or encodes the output (Rust hosts:
the widget encoder of `widget-mobile`, Rune's reader, the web host) and the TypeScript runtime (`@opencode/widget`'s
`step`, `WidgetSession` and `LiveWidget`).

- **Entries.** Steps (`init`, `event`, `draw`): `return __widget_native_step(__input())`. Live:
  `return await __widget_live(__input(), true)`.
- **Runtime options.** PsychoScript's `translate: { functions: "mark" }`, so a program function in a host call's
  argument or in the run's result crosses as the function marker, and the boundary value depth (default 32) at
  **202**: the deepest value of a view of 100 levels (Keys and depth). A level takes at most two value levels (a node
  and its `children` array, or an array in `children`), the deepest prop of a valid node three below it (`options` →
  an option → its `label`), and the widest wrapper one (a live `{ type: "render", node }`; an
  emitted view has none): 1 + 2 × 99 + 3 = 202. Values deeper than that (in a prop the node types don't define) fail where
  they cross, with the interpreter's own error. (PsychoScript: `limits: { maxValueDepth: 202 }`.)
- **A step's output, split.** `__widget_native_step` calls `__widget_emit(view)` once per `init` or `event` step with
  the view as built, then returns `{ state, submit?, dismiss?, send? }` as the run's result. The result keeps the
  run's JSON rules (`toJSON`, an `Error`'s fields, numbers, a typed array failing the step): the host only drops its
  markers, as JSON drops functions (left out of an object, `null` in an array). A `draw` step calls
  `__widget_emit(commands)` once with the draw's commands (`[]` when `draw` returns nothing), and the run has no result
  (`undefined`). The host reads the commands as JSON would: it drops markers (left out of an object, `null` in an
  array) and `undefined` props, and makes `undefined` items and non-finite numbers `null`; then it checks them as a
  draw output (`{ commands }`, Canvas), with the same failures. (No `toJSON` runs: a valid command holds only numbers,
  strings, arrays and plain paint objects.) `__widget_emit` returns nothing.
- **What it gets.** The emitted view, and a live `render`'s `node`, are the view as built: handler props are markers,
  `key`s are there, `children` are as written (nested arrays, holes, `null`, `undefined`, `false`), and values are as
  a host call's argument carries them (as live renders always were).
- **What it makes.** The tree clients get (what protocol 1's prelude made itself):
  1. The root's path is `:` + enc(root `key`) when the root is an object (not an array) with a key (Keys and depth);
     otherwise `0`.
  2. A value that isn't an object, or is an array, goes out as in 5. An object (a node) goes out with its props in their
     order, leaving out `key`, `id`, `pointer`, `selectable`, `sortable`, `onPress`, `onChange`, `onPointer`, `onSort`
     and `children`. If its `type` is in the Events table, its handler props are that type's (`onPress`, `onChange` or
     `onPointer`; a `table`'s `onPress` and `onSort`); when one is a marker, or the type is `button`, `checkbox`,
     `slider`, `select` or `input`, or it is a `canvas` with a key, the node gets `id` (its path) after its props. A
     `canvas` with a handler then gets `pointer: true`; a `table` gets `selectable: true` with an `onPress` and
     `sortable: true` with an `onSort`, in that order. If `children`
     isn't `undefined`, the node gets `children` last: the items below.
  3. A `children` value that isn't an array is a list of one. Its items in order, at index `i`: a falsy item (a hole,
     `undefined`, `null`, `false`, `0`, `NaN`, `""`) is skipped and keeps its index; an array's items come in its place
     with `i.` before their indices (`2.1`, `2.1.0`); a non-object (a string, a number, `true`) goes out as in 5; an
     object goes out as in 2, with path parent path + `/` + its segment. The segment is `:` + enc(`key`) when it has a
     key, with `~n` appended for the n-th child (n ≥ 2) of the same parent with that segment, counted in order across
     nested arrays; otherwise its index (`3`, `2.1`). Levels count as in Keys and depth.
  4. enc(key) is JavaScript's `encodeURIComponent(String(key))`: a number is written as `String(number)` does (`1.5`,
     `1e+21`, `0.30000000000000004`, `0` for `-0`, `NaN`, `Infinity`, `-Infinity`), a boolean as `true` or `false`. A
     key it can't encode (a lone surrogate) is a program error, as in the prelude. A key of another type fails the view
     (Keys and depth); the host checks an item's level, then a node's key, before the node's other props.
  5. Every value goes out as JSON holds it: an `undefined` prop is left out and an `undefined` item is `null`, a
     non-finite number is `null`.
- **Functions where none may go.** A marker in a host call's argument anywhere but the value of a node's `onPress`,
  `onChange`, `onPointer` or `onSort` (a node: the view's root, or an object among `children` or an array in them) fails the
  call as a function did without `"mark"`: the host throws, from that call, its runtime's `TypeError` `Argument <n> to
  <name> contains a function, which cannot be passed to the host.`, with `<n>` the argument's position from 1 and
  `<name>` the function as the program called it (`__widget_emit`, `__host.post`, `__host.fetch`, ...). So a function
  in another prop of a node (`id`, `pointer` and unknown props too), as a child, inside a prop's value, in a live
  `send` or `submit` value, in a live `draw` post's commands or in a `fetch` request fails, and uncaught it fails the step or run with
  that message and the call's line and column. A marker as a `key` is a key of another type (Keys and depth). (A
  step's `state`, `submit` and `send` are the run's result, not an argument: their functions are left out, as JSON
  does; so are the functions in a draw step's emitted commands, as above.)
- **Failures of the view.** A key of another type or a view deeper than 100 levels found in the walk: the host takes
  the view as failed and fails the step (after the run) or the live run (at once) as a program error in phase `view`,
  with the message of Keys and depth; `__widget_emit` and `post` don't throw for it. A view too deep to cross the
  boundary at all never reaches the walk: the prelude catches the call's error and, when the view has a node or an
  array below level 100, passes `__widget_emit(null, message)` instead (live: `__host.post({ type: "render", node:
  null, failure: message })`); a host given a string `message` there fails the same way with that message. Any other
  error from the call stays the program's.
- **Handlers.** An id has a handler when its node's handler prop is a marker. The host keeps, for the last view, the
  canvas ids by key (`String(key)`, the first such canvas) and whether any id has a handler. The prelude finds an
  event's handler by following the id's path through the view as built (the rebuilt view in a step, the last rendered
  node in live mode): where siblings share a segment (a key written like a repeat, `k~2`), the last one whose subtree
  has the id takes it.
- **Live posts.** `__host.post({ type: "render", node })` returns `true` when the view has a handler, else `false`;
  the prelude keeps the run going on that (`widgets-live.md`). The host walks every render posted to it,
  one that waits for the post rate too (`widgets-live.md`, Post rate). `widget.draw(key, commands)` posts `{ type: "draw", key, commands }` (`key` a
  string; a draw post without a string `key` is an invalid post, `widgets-live.md`); the host maps the key to the canvas's id from the last render and gives its client
  `{ type: "draw", id, commands }`. For an unknown key it throws from `post` an `Error`
  `No canvas with key "<key>" in the rendered view`, for a GPU canvas `Canvas "<key>" is drawn by its wgsl; it takes no
  draw commands`; the program can catch either.
- **Draw steps**: the host passes the canvas's id in `frame.id`.
- **Conformance.** `packages/widget/test/fixtures/wire/*.json` hold, for every built-in and the edge cases, the
  widget template `source` and the step `input`, and what the host must make of them: `built`, the view as emitted
  (each function as the string `"$function"`, `NaN` and `±Infinity` as `"$NaN"`, `"$Infinity"`, `"$-Infinity"`, holes
  and `undefined` items as `null`), and either the `view` clients get (as JSON), the `handlers` (id → event), the
  `canvases` (key → id) and the run's `result` (as JSON), or the `error`: `{ view: true, message }` for a program error
  in phase `view` with exactly that message, `{ view: false, message }` for the step failing with exactly that message.
  They come from the last prelude that built the tree itself (protocol 1, kept for this in
  `packages/widget/test/fixtures/scripted-prelude.js`) where it agrees (all but a function it left out), and from the
  TypeScript host for failures. A native host runs the step program of `source` on `input` and must give the
  same; `built` tests its walk alone. `packages/widget/src/tree.ts` is the walk in TypeScript.

## Events

```ts
type WidgetEvent = {
  id: string   // a prelude-assigned node id, or "" for events that belong to no node
  type: "press" | "change" | "pointer" | "key" | "focus" | "fullscreen" | "capture"
  value?: unknown
}
```

Clients send `{ id, type, value }` for the ids the prelude put on the nodes and never interpret ids; widget templates attach
handlers and never see them. The value a client sends, and what the handler gets:

| Node | Event | Handler |
| --- | --- | --- |
| `button`, `card` | `press` | `onPress(state)` |
| `checkbox` | `change`, `value: boolean` | `onChange(state, checked)` |
| `slider` | `change`, `value: number` (send on release, not on every drag tick) | `onChange(state, value)`, clamped to `min`..`max` |
| `select` | `change`, `value: string` or `string[]` when `multiple` | `onChange(state, value)`, only known option values |
| `input` | `change`, `value: string` (on commit / blur / debounce >= 300 ms) | `onChange(state, text)` |
| `carousel` | `change`, `value: number` (new page index) | `onChange(state, index)` |
| `table` | `press`, `value: number` (the row pressed, an index into `rows`) | `onPress(state, row)` |
| `table` | `change`, `value: number` (the column whose header was pressed) | `onSort(state, column)` |
| `canvas` | `pointer`, `value: { kind, x, y, width, height }` in the node's logical pixels; `move` only while down, at most once per frame (see Canvas) | `onPointer(state, p)`; under pointer capture `p` is `{ kind, dx, dy, button }`, or a wheel's `{ kind, dx, dy }` (`widgets-input.md`, Wheel) |
| none (`id: ""`) | `key`, `focus`, `fullscreen`, `capture` | the hooks (Widget template source) |

In live mode the same props take closures that get only the value (`onPress()`, `onChange(value)`,
`onPointer(p)`); see `widgets-live.md`.

## Nodes

Every node is `{ type, ...props }`. Unknown props are ignored; unknown node types render as nothing plus a dev warning
(the TypeScript runtime drops them from `children` before validating and reports them in `StepOutput.warnings`; an
unknown root node is an invalid view).
Keep the set small; add types here before using them.

```ts
type Tone = "default" | "muted" | "accent" | "success" | "warning" | "error"
type Node = (
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
  | { type: "table"; id?: string; columns: { label: string; align?: "start" | "end" }[]; rows: (string | number)[][];
      sort?: { column: number; descending?: boolean }; selected?: number
      selectable?: true  // set by the prelude when it has onPress: only then do its rows take presses
      sortable?: true }  // set by the prelude when it has onSort: only then do its headers take presses
  | { type: "canvas"; id?: string; height: number; width?: number; fps?: number; duration?: number; alt?: string;
      poster?: string; wgsl?: string; values?: number[]      // values only with wgsl
      pointer?: true     // set by the prelude when it has onPointer: only then does it take input
      gpu?: true }       // drawn by a live program's widget.gpu (widgets-gpu.md); not with wgsl
  | { type: "stack"; children: Node[] }
) & {
  // Any node, as a child of a stack (see Stack); ignored elsewhere.
  place?: "top-left" | "top" | "top-right" | "left" | "center" | "right" | "bottom-left" | "bottom" | "bottom-right"
    | "fill"                                                    // default "top-left"
  inset?: number | { top?: number; right?: number; bottom?: number; left?: number }   // logical px, default 0
}
```

A `canvas` takes the full available width unless `width` is set; sizes are logical pixels.

Gap units are client-relative (TUI: rows/cols; GUI: 4/8/12 px).

Image `src`: an `https:`/`http:` URL, a `data:` URI, or a path relative to the session's directory. Clients resolve
relative paths through the server's existing file content endpoint for the session's location. TUI shows `alt` (or the
file name) plus the source instead of pixels where it cannot draw images.

Table: a grid of text with a header row, for data (a history, a comparison, a list of records). `columns` holds 1 to
16 columns, each with a `label` and an `align` (`start`, the default, or `end`: use `end` for numbers); `rows` at most
500 rows of at most that many cells, each a string or a number, which shows as JavaScript's `String(number)` (a row
with fewer cells leaves the rest empty). `sort` marks the header of column `sort.column` with an ascending (or, with
`descending`, a descending) indicator; the program sorts `rows` itself. `selected` highlights that row. A table with
more columns or cells, a `sort.column` or `selected` outside them, or a cell that is neither a string nor a number is
an invalid view. With `onPress`, pressing a row sends `press` with its index; with `onSort`, pressing a header sends
`change` with the column's index. Clients draw it like the tables in their markdown (the same fonts, borders, header,
colors and spacing), scroll it sideways when it is wider than the widget, and give it no height limit of its own; the
TUI writes it as aligned text, a line per row.

Carousel: one child visible at a time with paging (swipe on touch, arrows on desktop, left/right keys in the TUI) and a
page indicator. A carousel without `id` pages locally; with one (it has an `onChange`) it also emits `change`.

## Stack

A `stack` layers its children, like a CSS grid with every child in the same cell: the first child at the bottom, the
last on top. The builder is `ui.stack(props, children)` (or `ui.stack(children)`). Use it for a HUD (text, buttons)
over a canvas.

- **Width:** the available width, like a column.
- **Child area:** the stack's box shrunk by the child's `inset` (a number for every side, or per side; default 0).
- **Placement:** with `place: "fill"` the child takes its whole area (a canvas is drawn at the area's width and height).
  Any other `place` gives the child its natural size (as it would have in a column of the area's width; a canvas: its
  `width` or the area's width, by its `height`), at most the area, at that position in the area: `top-left` (the
  default), `top`, `top-right`, `left`, `center`, `right`, `bottom-left`, `bottom`, `bottom-right`.
- **Height:** the largest of its children's natural heights plus their top and bottom insets (a `fill` child counts
  with its natural height too). In full screen a stack that has a canvas child grows like a canvas (Layout in
  `widgets-fullscreen.md`), unless all its canvas children have `fill: false`, and its `fill` children take its full
  size.
- **Pointer input:** the topmost child at the point that takes pointer input gets it: an interactive node (`button`,
  `checkbox`, `slider`, `select`, `input`, a `card` or `carousel` with an `id`, a `canvas` with `pointer: true`), or a container
  through one of its interactive descendants. Everything else lets it through to the layer below: `text`, `markdown`,
  `image`, `divider`, a canvas without `pointer: true`, and the empty parts of containers (they have no background). Pointer
  capture and `close` work as anywhere else; a canvas's coordinates are its own box.
- **Order:** keyboard focus and screen readers follow the children's order.
- **Directions are physical:** `left`/`right` in `place` and the `left`/`right` sides of `inset` don't flip in a
  right-to-left layout.
- **Clients that can't layer** (the TUI) show the children top to bottom in order, like a column, ignoring `place` and
  `inset`.

## Canvas

A `canvas` node is a drawing surface, like an HTML canvas with either a 2D or a GPU context. It is drawn one of two
ways, never both:

- **2D** (no `wgsl`): by the widget template's optional `draw(state, data, frame)` function, which returns draw
  commands (below).
- **GPU** (`wgsl` set): by that WGSL fragment shader, fed the canvas's `values` (see GPU canvases). `draw` is never
  called for it, and live `widget.draw` refuses it. A live program can instead drive a canvas with `gpu: true` through a
  WebGPU subset (`widgets-gpu.md`), of which `wgsl` is the shorthand.

Everything else is the same for both: size and `width`, `fps` and `duration`, `alt` and `poster` (an image src shown
where the canvas can't be drawn: the TUI, a shader that fails to compile), `fill` and full screen, `onPointer` and
pointer capture, `close`, and ids and keys. `fps` defaults to 0 for a 2D canvas and 60 for a GPU one.

A canvas takes input only with `pointer: true`, which the prelude sets when it has an `onPointer` handler. Without it (no
handler; a canvas with only a `key` has an `id` for live `widget.draw`, but no `pointer`) it sends no `pointer` events,
and in a stack taps pass through it to the layer below. It still gets `frame.pointer` in `draw` (hover and press visuals
of its own).

`draw` is pure: it can't change state. Animate with `frame.t`; keep anything that must persist in state via handlers.

Clients never call `draw`, or render a GPU canvas, while the canvas has a zero width or height (during layout, or
when entering or leaving full screen); they wait until both are positive. `frame.width` and `frame.height` are always
greater than 0.

Draw step input / output (same `__widget_native_step` entry point):

```ts
type StepInput = ... | { phase: "draw"; data: unknown; state: unknown; frame: Frame }
type Frame = {
  id: string | null   // the canvas node's id; the prelude gives `draw` `key` (the canvas's `key`, or null) instead,
                      // so widget templates with several canvases switch on `frame.key`
  t: number           // seconds since the canvas appeared
  dt: number          // seconds since the previous frame
  width: number; height: number; scale: number   // logical size and device pixel ratio
  pointer: { x: number; y: number; down: boolean } | null
  dark: boolean
  close?: { x: number; y: number; width: number; height: number } | null   // full screen: the close button's area
                      // over this canvas, in its coordinates, or null (widgets-fullscreen.md)
}
type DrawOutput = { commands: Command[] }   // the run emits `commands` (Native hosts)
```

Clients call it once when the canvas appears or state changes, then every frame while `fps > 0` (max 60;
clients may lower it, e.g. off screen, in low-power mode, or in the TUI). With `duration` (seconds), a canvas animates
only until it has drawn a frame with `t >= duration` and then draws again only on state changes (for intro
animations: `{ fps: 60, duration: 0.6 }`); `t` keeps counting from when the canvas appeared, across view updates. Budget: 8 ms per draw step and 2,000 commands
per frame; a canvas that exceeds it three frames in a row stops animating and keeps its last frame.

**Dev fps readout.** In dev mode only (`widgets-live.md`, Capabilities), every animating canvas, 2D or GPU, shows a
small badge in a corner with the frames per second actually presented to the screen, updated once a second. It is
measured by counting presents and nothing else, and with dev mode off it costs nothing. It isn't part of the widget: it
never reaches the program and never changes layout.

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

Pointer input on a canvas with `pointer: true` goes to its `onPointer` handler: clients send
`{ id, type: "pointer", value: { kind: "down" | "move" | "up", x, y, width, height } }`, with `move` only while down
and at most once per frame. `width`/`height` are the canvas's logical size, so the handler can hit-test a layout that
follows the available width.

The builder methods push one command each and return the builder (`g.save().alpha(0.5)`): `save() restore()
translate(x, y) rotate(r) scale(sx, sy = sx) alpha(a) rect(x, y, w, h, paint) rrect(x, y, w, h, r, paint)
circle(cx, cy, r, paint) line(x1, y1, x2, y2, paint) path(segments, paint) text(x, y, string, style = {})
image(src, x, y, w, h)`, and `g.commands` is the list. A `paint` may be a `Color` string, short for `{ fill: color }`
(`{ stroke: color }` for `line`); an omitted paint is the `"text"` color. `draw` may return the builder itself.

State works as in the Canvas 2D API: `alpha` sets the opacity (clamped to 0–1) for the commands after it, replacing
the current value rather than multiplying it, and `save`/`restore` save and restore the transform and opacity.

### Draw command checks

Every host checks a draw's commands (a draw step's, or a live `draw` post's) with exactly these rules, on the values
as they crossed (Native hosts), and gives the client the **normalised** commands, or fails with exactly the message
below: a program error (Failures) in phase `draw`, which for a live `draw` post ends the run as an invalid post does.
The TypeScript host fails with `StepError` `kind: "invalid"` and that message. Shared cases:
`packages/widget/test/fixtures/draw.json`.

- **The list.** The commands are a list (else `draw commands must be a list`) of at most 2,000 (else `<n> draw commands
  is over the budget of 2000 per frame`). Then each command, in order; the first that fails fails the draw with
  `draw command <i>: <reason>` (`<i>` from 0) and one of the reasons below.
- **A command,** checked in this order:
  1. an array (`a command is an array`) whose first item is a string (`a command starts with its name`), one of the
     names in the `Command` type (`unknown draw command "<name>"`);
  2. its length: at most the type's number of arguments (`"<name>" has more than <k> arguments`), and at least that
     many, but for `text`, whose style may be left off (`"<name>" is missing argument <i>`, for the first missing one);
  3. its arguments, first to last. A number must be a finite number (`"<name>" argument <i> must be a finite number`;
     `null`, `undefined`, a string or a non-finite number fail). `alpha` is clamped to 0..1. `path`'s argument 1 is a
     list (`"path" takes a list of segments`). `text`'s argument 3 is a string (`"text" argument 3 must be a string`).
     `image`'s argument 1 is a string (`"image" takes a src`). Any other number, negative ones included, is kept.
- **A path segment:** an array (`a path segment is an array`) whose first item is `M`, `L`, `Q`, `C` or `Z` (`unknown
  path segment`), with exactly 2, 2, 4, 6 or 0 coordinates (`a "<verb>" path segment takes <k> coordinates`), each a
  finite number (`a path coordinate must be a finite number`).
- **A paint:** an object, not an array or `null` (`a paint is an object`). Its fields, checked in this order:
  - `fill`: a color, or an object, a gradient (below);
  - `stroke`: a color;
  - `width`: a finite number (`a stroke's width must be a finite number`), a negative one made 0;
  - `cap`: `"butt"` or `"round"` (`a stroke's cap must be "butt" or "round"`).
- **A gradient:** `linear`, when present, is a list of 4 finite numbers (`a linear gradient takes 4 numbers`; an item
  that isn't one: `linear must be a finite number`); `radial` likewise with 3 (`a radial gradient takes 3 numbers`,
  `radial must be a finite number`). Both are checked when present; with both, it is linear. With neither: `a
  gradient needs linear or radial`. Then `stops`, a list (`a gradient needs stops`, empty allowed) of `[offset,
  color]` pairs (`a stop is [offset, color]`), the offset a finite number (`a stop's offset must be a finite
  number`) clamped to 0..1.
- **A color:** a string that is a theme token or `#` and 3, 6 or 8 hex digits (either case); anything else, `null`
  included: `not a color`.
- **A text style** (argument 4): left off, `undefined` or `null` is `{}` (JSON writes an `undefined` array item as
  `null`); anything else but an object, arrays included: `a text style is an object`. Its fields, in this order:
  `size`, a finite number (`a text size must be a finite number`) clamped to 1..512; `weight`, 400, 500, 600 or 700
  (`a text weight must be 400, 500, 600 or 700`); `align`, `"left"`, `"center"` or `"right"` (`a text align must be
  "left", "center" or "right"`); `color`, a color; `mono`, `true` or `false` (`a text mono must be true or false`).
- **Fields of objects** (a paint, a gradient, a text style) that are absent or `undefined` take their defaults
  (above); `null` is a value, and fails as any other wrong one. Fields the type doesn't name are ignored.
- **Normalised commands:** each command with exactly its arguments, clamped values in place, a text style that was
  left off as `{}`; in paints, gradients (`linear` or `radial`, then `stops`) and text styles only the fields given,
  in the orders above, without unknown or `undefined` ones.

## GPU canvases

A canvas with `wgsl` runs that WGSL fragment shader on the GPU, free-running at `fps` (default 60). Its `wgsl` must
define

```wgsl
fn shade(frag: vec2f) -> vec4f   // frag: pixel position, origin top-left; returns premultiplied RGBA
```

Clients prepend this header and append the entry point (and provide a full-screen-triangle vertex stage):

```wgsl
struct Widget { resolution: vec2f, time: f32, scale: f32, pointer: vec4f, values: array<vec4f, 4> }
@group(0) @binding(0) var<uniform> widget: Widget;
// ... widget template wgsl ...
@fragment fn widget_main(@builtin(position) p: vec4f) -> @location(0) vec4f { return shade(p.xy); }
```

`frag`, `widget.resolution` and `widget.pointer` are in physical pixels (logical × `widget.scale`), `widget.time` in
seconds since the canvas appeared. Colors are sRGB-encoded: clients write them to the surface without a linear-to-sRGB
conversion. With `fps: 0` it renders once, and again when its `values` change.
`widget.pointer` is `(x, y, down, 0)`; `widget.values` carries the node's `values` (up to 16 floats, row-major, zero
padded), which the widget template sets from state in `view`. Rune passes WGSL to wgpu as is, and so do iOS and
Android (`widget-mobile`'s `ShaderCanvas`, on wgpu: Metal, Vulkan). Source is capped at 16 KB. A shader that fails to
compile shows `poster` (an image src) or `alt` with the error inline. A host never submits a new shader frame while the
previous one is still drawing. A shader whose frame is still unfinished more than 50 ms after its submit, three frames in a row,
stops and keeps showing its last frame: a client error (Failures) with exactly this text:
`the shader took over 50 ms a frame, three frames in a row`. A frame still unfinished 250 ms after its submit stops the
canvas before that, whatever this rule has counted (`widgets-gpu.md`, GPU hang). The TUI shows `alt` and `poster` for
every canvas.

When a new view changes only a GPU canvas's `values` (same `wgsl`, same place in the tree), clients update its uniforms
in place: no recompile, no rebuilt view, no restart of `widget.time`. Live programs drive shader games that way,
re-rendering with new `values` every frame.

## Failures

A widget can fail in two ways, and only one is the widget template's.

A **program error** is the widget template's own code failing or breaking a contract:

- a parse error or a runtime exception in the program (including a handler, hook, `draw` or `main`);
- an invalid view or invalid draw output (fails the node or draw command schema, more than 2,000 commands);
- WGSL that fails validation (naga's or the platform's validator rejects the shader as written);
- exceeding a program limit: the 250 ms step timeout, the 50 ms slice without awaiting (live), both in CPU time (Prelude
  and step ABI, Budgets count CPU time), the heap cap or the `send` rate (`rate_limited`). (Live `render` and `draw`
  posts over their rate wait instead; `widgets-live.md`, Post rate.)

Everything else is a **client error**: rendering or translating valid WGSL, a shader too slow on this device (the 50 ms
frame stop, GPU canvases: `the shader took over 50 ms a frame, three frames in a row`), a GPU hang (`widgets-gpu.md`:
`the GPU work hung; the canvas is stopped`), host internals, transport and RPC failures (a `program` fetch that fails),
and client bugs. Clients never send client errors with `report`. Each client error, and a GPU canvas's unavailable state
(`widgets-gpu.md`), has an exact reason: the message this spec gives, else the underlying error's text. Only in dev mode
(the one that allows local-network fetch, `widgets-live.md`, Capabilities) do clients log it and show it on the widget,
under a canvas's placeholder or, for other client errors, as a small dev line on the widget; outside dev mode it is
neither logged nor shown (a canvas shows only its placeholder). The reason is captured once, when the state changes (a
canvas becomes unavailable or stops), never formatted or logged per frame, per batch or per call, and with dev mode off
nothing on a hot path pays for it. Client errors are bugs to fix in the client, not a widget state. A fetch error a live
program gets from `widget.fetch` is the program's to handle; only an exception it lets escape is a program error.

A client that hits a program error shows it on the widget (error card or inline error) and calls `report` once with
`{ phase, message, line?, column? }`, positions relative to the widget template's source (the lines of the program before the source subtracted:
the prelude's, and a live program's live prelude's; dropped when they fall outside the widget template). The server records it as the widget's `failure`. Whether it reaches the
agent depends on who made the widget template:

- **The widget's Session created the widget template version** (its `widget_template` `save` or `edit` stored that version):
  the failure is sent to the agent automatically, as a waking message or, while a `wait: true` call waits, as that
  call's tool error. `failure.sent` becomes `true`.
- **Otherwise** (a built-in, or a widget template saved in another Session): nothing is sent; `failure.sent` stays `false`.
  Clients show the error with an **"Ask agent to fix it"** action, which calls `report` again with the same error and
  `ask: true`. That sends it to the agent in the widget's Session once (the text ends with `The user asked you to fix
  it.`) and sets `failure.sent`.

## Server plugin

Widgets are an internal server plugin, `@opencode/plugin-widgets`, built only on the public plugin API
(`@opencode/plugin/effect`): tools, a skill, plugin storage, an RPC registration and Session calls. Core registers it
only while the `widgets` flag is on. The flag is opt-in only: off in every build, including local and dev; enable it
with `OPENCODE_FLAGS=widgets` or `experimental.widgets: true`. Nothing in Core, Protocol, Server or the session history
schema knows about widgets.

### The widget in history

A widget is the `widget` tool call: an assistant tool part with `name: "widget"` and input
`{ widgetTemplate: string; data: object; title?: string; replaces?: string; wait?: boolean }`. It is identified by the assistant message ID
plus the call ID (`messageID`, `callID`; a call ID is unique only within its message). Clients find widgets by walking
tool parts named `widget` and look up their state by `(messageID, callID)`. The completed tool part's `metadata` is
`{ widgetTemplate: { name, version } }`; while the call runs (or when it failed after posting) the version comes from the
state.

### State

The plugin keeps one state record per widget in its storage and is the only writer:

```ts
type State = {
  sessionID: string
  messageID: string                     // assistant message holding the widget tool call
  callID: string
  widgetTemplate: { name: string; version: string }
  title?: string
  status: "open" | "submitted" | "dismissed" | "superseded"
  response?: unknown                    // the submitted value
  supersededBy?: { messageID: string; callID: string }   // the widget that replaced it (status "superseded")
  failure?: {                           // the program error last reported (see Failures); the status stays
    phase: string; message: string; line?: number; column?: number
    client: string                      // who reported it: tui, rune, ios, android, web
    sent: boolean                       // the agent has been told (automatically, or through ask)
  }
  wait: boolean                         // the tool call waits for the answer (see Tools)
  capabilities?: { https?: { hosts: string[] }; storage?: {} }   // the widget template's, for the client's grant chip
  time: { created: number; responded?: number }   // epoch ms
}
```

A widget goes `open → submitted`, `open → dismissed` or `open → superseded` (a newer widget `replaces` it), once;
`time.responded` records when. A superseded widget can't be answered or send (`closed`, `data: { status:
"superseded" }`), and reports for it are ignored. States of a deleted Session are removed.

### RPC: `opencode.widget`

`Widget.Definition` in `@opencode/schema/widget`. Clients call `POST /api/rpc/opencode.widget/<method>` (through
`client.rpc(Widget.Definition)`), passing the Session's Location, and follow the event like the goal plugin's.

| Method | Input | Output | Errors |
| --- | --- | --- | --- |
| `widgetTemplates` | `{}` | `Summary[]`: latest version of every widget template, sorted by name, without source | |
| `program` | `{ name, version? }` | `Program`: that immutable version, or the latest when `version` is omitted | `not_found` |
| `states` | `{ sessionID }` | `State[]` of the Session, oldest first | |
| `respond` | `{ sessionID, messageID, callID, response: { value } \| { dismiss: true } }` | the new `State` | `not_found`, `closed` (`data: { status }`) |
| `send` | `{ sessionID, messageID, callID, value, wake? }` | the `State` (unchanged) | `not_found`, `closed`, `rate_limited` |
| `report` | `{ sessionID, messageID, callID, error: { phase, message, line?, column? }, client, ask? }` | the `State`, with `failure` | `not_found` |

```ts
type Summary = {
  name: string; version: string; description: string; data: JSONSchema; mode: "step" | "live"
  capabilities?: { https?: { hosts: string[] }; storage?: {} }   // live widget templates only
  builtin: boolean
}
type Program = Summary & { source: string; program: string }   // program as served (Prelude and step ABI)
```

Event `changed`, `{ sessionID, state: State }`, published (as `rpc.opencode.widget.changed`) in the Session's Location
whenever a widget is posted or answered. A client fetches `states` when it opens a Session or reconnects, since changes
published meanwhile were missed, and applies `changed` after that.

Plugins load asynchronously after a Location boots, and the server never waits for them: on a cold server (or right
after `experimental.widgets` is turned on) calls answer `rpc.unavailable` until the plugin is up. Clients treat that as
"not loaded yet": retry when `plugin.updated` arrives for the Location (or poll `plugin.list`), not as "no widgets".
The plugin follows the flag while the server runs, so a config edit starts or stops it without a restart.

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
| report | `Widget "<label>" failed on <client>: <phase>: <message> (line N, col M)`, plus ` The user asked you to fix it.` for `ask` | `<label> failed on <client>` | `error` | yes |

`metadata` is `{ widget: { messageID, callID, kind } }` (`kind`: `response`, `message` or `error`); clients detect these by `metadata.widget`, never by text, and
show them as one quiet line (`◈ <description>` in the TUI). `<label>` is the title, or the widget template name. A send with
`wake: false` is admitted without waking (`resume: false`): it stays pending and the model sees it with the next turn.

Waiting tool calls and the lock that serializes respond and send live in the server process, shared by every Location
and plugin reload in it; this assumes one server process per database, like the goal plugin.

`report` carries one program error (see Failures; never a client error): `phase` is `init`, `event` (a handler or
hook), `view`, `draw`, `main`, `shader` or another string; `line`/`column` (1-based) are in the widget template's source when
known; `client` names the client (`tui`, `rune`, `ios`, `android`, `web`). The server writes it as the widget's
`failure` (publishing `changed`) unless it repeats the recorded one (same phase and message); a different error
replaces it, unsent. It sends the failure to the agent only when the widget's Session is the widget template version's
origin (automatic: repeats of an error already sent are dropped, and at most one automatic send per widget every 10
seconds), or when `ask: true` and `failure.sent` is still `false` (once). A send fails a waiting `wait: true` call with
the same text instead of messaging. Reports for a closed widget are ignored. Each saved version records its origin
Session (the one whose `save` or `edit` first stored it); built-ins have none.

Respond writes the state first and then admits the message. These are two writes without a transaction: if the server
dies between them, the widget shows as answered but the model never hears of it (the user can say so in the prompt).
Respond and send for one process are serialized, so a widget is answered once.

## Tools

`widget` — show a widget.

```ts
input: { widgetTemplate: string; data: object; title?: string; replaces?: string; wait?: boolean }
```

The plugin resolves the latest version, validates `data` against the widget template's JSON Schema (errors go back to the
model as the tool error), stores the widget's state and publishes `changed`. **The server never runs widget template code**:
not `init`, `view` or `main`. Errors in running a widget come from the clients that show it, through `report`.

- `replaces`: the call ID of an earlier widget in the same Session (an unknown one is a tool error and nothing is
  posted). If it is still open it becomes `superseded` with `supersededBy` set, and `changed` is published for it
  before the new widget's state; a `wait: true` call waiting on it ends with the tool error
  `Widget "<label>" was superseded by a newer widget.` The model uses it when iterating on the same widget (a fix, new
  data, the next step), so the transcript keeps one live widget.
- `wait` omitted or `false`: returns at once with `Widget "<title>" is shown to the user (call ID <callID>, for
  replaces). Their response arrives as the next message; end your turn now unless there is unrelated work to do.` The
  answer arrives as a synthetic message.
- `wait: true`: blocks until the final answer from any client, like the `question` tool. A submission returns
  `User responded to widget "<label>": <JSON value>` as the tool result (metadata adds `response`); a dismissal returns a
  tool error `User dismissed widget "<label>"`, which the model sees and continues with; no synthetic message is
  admitted for an answer the tool returned. Waiters live in the server process: when the user stops the call
  (interrupt), or the server restarts, the call ends, the widget stays open, and a later answer is delivered as a
  synthetic message with a wake. A send while the tool waits is still a synthetic message.

`widget_template` — manage widget templates. The input is one flat object (union inputs are poorly supported by some
providers); fields an action needs are checked at run time.

```ts
input: {
  action: "list" | "get" | "save" | "edit"  // list: names, descriptions, data schemas; get: the latest version with source
  name?: string                    // get, save, edit
  description?: string             // save; edit (optional, keeps the old one)
  data?: JSONSchema                // save; edit (optional); top-level `type` must be "object"
  from?: string                    // edit: copy this widget template's latest version to `name` first (e.g. a built-in)
  edits?: { oldText: string; newText: string }[]   // edit
  source?: string                  // save
  mode?: "step" | "live"           // save; default "step"
  capabilities?: { https?: { hosts: string[] }; storage?: {} }   // save; live widget templates only (widgets-live.md, Capabilities)
  example?: object                 // save; edit when `data` changes
}
```

`save` validates the name, checks `example` against the schema, and parses and lints the source without running it
(psychoscript's parser): at most 128 KB; the entry functions exist (`view` for step widget templates, `async function main` for
live ones; `init`, `draw` and the hooks are optional); no `update` function and no `widget.event` / `widget.next`
(the removed event API; the message says what replaces it); only function and `const` declarations at the top level, and no
`const` initializer that runs code (calls, `new`, assignments), so nothing runs when the program loads; no prelude name
(`ui`, `widget`, `submit`, `dismiss`, `send`, the `__widget_*` internals, `__input`, `__host`) is redeclared. Problems
come back as the tool error with `line N, col M`. `capabilities` are rejected on step widget templates, and each
`https.hosts` entry must be a lowercase host name (single labels and IPv4 literals included, for clients' dev-mode
local network), `*.` plus one, optionally with a `:port`, or `*` (1 to 32 entries). Built-in names cannot be overwritten. Saving content that already exists (same version) makes
that version the latest again and updates its description.

`edit` applies `edits` in order to the latest source of `name` (or of `from`, saved under the new `name`): each
`oldText` must occur exactly once in the source as edited so far, and `newText` replaces it literally. Errors name the
edit (`edit 2: oldText matches 3 times; include more surrounding text so it matches once`, `... was not found ...`,
empty `edits`, `oldText` equal to `newText`). The result is linted and saved like `save`, keeping the widget template's mode and
capabilities, as a new version. A built-in can only be edited as a copy (`from: "<built-in>"` with a new `name`). An
`example` is required when `data` changes; otherwise the stored schema stands and no example is checked.

Each saved version gets a **revision**: 1 for the first content saved under a name, counting distinct versions in the
order they were first stored (saving old content again keeps its revision). Results carry short metadata, so clients
never need the source to show the call: `list` → `{ action, count }`; `get`, `save`, `edit` →
`{ action, name, version, revision?, lines }` (`revision` is absent for built-ins). Clients render `widget_template`
calls as one quiet line, never the source: `Saved widget template <name> v<revision>`, `Edited widget template <name> v<revision>`,
`Read widget template <name>`, `Listed <count> widget templates`.

Permission actions are `widget` (resource: the widget template name) and `widget_template` (resource: the widget template name, or
`*` for list). The plugin's agent transform allows both for the Build agent, `widget` for Plan, and denies `widget` for
the `general` subagent; configured rules still win.

The `widgets` skill (shipped by the plugin) covers when to show a widget, when to `wait`, how to fill each built-in,
and the widget template language. Tool descriptions teach the node set and the ABI briefly and point at it.

## Built-in widget templates

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

`backdrop` — a GPU canvas demo: `data: { title: string; preset: "plasma" | "aurora" | "waves"; text?: string /* markdown */;
accent?: string /* #rgb | #rrggbb */ }`, submits nothing. The banner is followed by the title, the text and a speed
slider (0–2, 0 pauses with `fps: 0`); `values` is `[speed, accent r, g, b]`.

Diagrams — canvas widget templates for data, listed with their data in `packages/widget/docs/diagrams.md`. Each takes
`title` and `choose?: boolean`; with `choose` a Choose button submits the selected element, otherwise they submit
nothing.

## Client behaviour

- Step outputs and live posts reach iOS and Android in the binary format of `widgets-binary.md`, written by
  `widget-mobile`'s widget encoder (`packages/widgets-rs`, on psychoscript-mobile) from the VM's value; Rune reads the
  VM's value directly; the TUI and the web host keep JSON.
- Render each `widget` tool call inline in the timeline at its position, from its tool input plus its state.
- `failure` (any status `open`): show the error on the widget. With `failure.sent: false`, add an **"Ask agent to fix
  it"** action that calls `report` with that error and `ask: true`; with `sent: true`, say the agent was told.
- `superseded`: render one quiet line, "Updated below", instead of the widget (the replacement follows it in the
  timeline; `supersededBy` names it).
- `open`: interactive. `submitted` / `dismissed`: render the final view read-only with a status line ("Submitted",
  "Dismissed"); for a submitted widget, rerun `init` and show the response summary (clients do not persist the local
  state).
- Local state lives only on the client that the user is interacting with; other clients see the result when the
  state turns `submitted`.
- Post a step's `send` output with `send`; keep the widget interactive.
- Fetch widget templates by `name@version` and cache them; show a loading placeholder while fetching.
- Run steps off the render path where the platform allows; steps are small, so synchronous is acceptable in v1.

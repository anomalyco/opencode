// Edge cases of view tree building (ids, keys, flattening, stripping, depth) and of the rest of a step's output for
// the wire conformance fixtures in `wire/`. Each is a widget template source; `data` is its init input (default null),
// `input` another step input. `drops`: a function the native host fails on, which the prelude building the tree
// leaves out (protocol 1). `newer`: an event protocol 1's prelude doesn't know; the outcome is the TypeScript host's,
// with the handlers' events from the prelude building the tree on init (the view doesn't depend on the event).
const view = (expression: string) => `function view(state, data) {\n  return ${expression}\n}`

// `levels` of nodes, each a column with one child; `array` puts each child in an array of its own too. The innermost
// node is a button, or `leaf`.
const nested = (levels: number, array = false, leaf = `ui.button("deep", { onPress: (s) => s })`) =>
  `function view() {\n  let node = ${leaf}\n  for (let level = 1; level < ${levels}; level++) node = ui.column(${array ? "[[node]]" : "[node]"})\n  return node\n}`

const json = `{ when: new Date(0), invalid: new Date(NaN), error: Object.assign(new Error("boom"), { code: 7 }), big: [2 ** 64, 1e21, 2 ** 53 + 2, -0], own: { toJSON() { return { v: 1 } } }, nested: { toJSON: () => [1, () => 2] }, f: () => 1, list: [1, () => 2, undefined], map: new Map([[1, 2]]), set: new Set([1]), url: new URL("https://a.test/b?c=d"), nan: [NaN, Infinity] }`

export const cases: ReadonlyArray<{
  readonly name: string
  readonly source: string
  readonly data?: unknown
  readonly input?: unknown
  readonly drops?: boolean
  readonly newer?: boolean
}> = [
  {
    // Holes keep their index; nested arrays get index.index; deeper nesting index.index.index.
    name: "holes-and-nested-arrays",
    source: view(
      `ui.column({ gap: 1 }, [ui.text("a"), false, null, [ui.button("b", { onPress: (s) => s }), [ui.text("c"), ui.input("", { onChange: (s) => s })]], undefined, ui.button("d")])`,
    ),
  },
  {
    name: "single-child-not-an-array",
    source: view(`ui.card({ onPress: (s) => s }, ui.text("only"))`),
  },
  {
    // A keyed root; repeated keys get ~2, ~3; a key that looks like a repeat suffix collides with one (the later
    // sibling wins the handler); a keyed leaf counts toward repeats; numbers and odd strings as keys (URI-encoded).
    name: "keys-and-repeats",
    source: view(
      `ui.row({ key: "root" }, [ui.button("x", { key: "k", onPress: (s) => s }), ui.text("kk", { key: "k" }), ui.button("y", { key: "k", onPress: (s) => s }), ui.button("z", { key: "k~2", onPress: (s) => s }), ui.text("t", { key: 3 }), ui.card({ key: "a/b c", onPress: (s) => s }, [ui.button("in")]), ui.button("n", { key: 7 })])`,
    ),
  },
  {
    name: "keyed-leaf-root",
    source: view(`ui.text("keyed", { key: "k" })`),
  },
  {
    name: "plain-leaf-root",
    source: view(`ui.text("alone")`),
  },
  {
    // Props the prelude takes off (id, pointer, handlers), on leaves, controls and containers; undefined and null
    // keys; strings and numbers among children.
    name: "stray-props-and-null-keys",
    source: view(
      `ui.column({ id: "c", pointer: true }, [ui.text("s", { id: "mine", pointer: true, onPress: (s) => s, onChange: undefined }), ui.button("b", { id: "mine", pointer: true }), ui.text("n", { key: null }), ui.text("u", { key: undefined }), "loose", 7, ui.markdown("**m**"), ui.divider(), ui.image("i.png", { alt: "i" })])`,
    ),
  },
  {
    // Nodes built without `ui`: with handlers and a key, with a stray id, a card without a handler, a bare button.
    name: "raw-nodes",
    source: view(
      `({ type: "column", children: [{ type: "button", label: "raw", onPress: (s) => s, key: "r" }, { type: "text", text: "t", id: "x" }, { type: "card", children: [{ type: "text", text: "in" }] }, { type: "card", onPress: (s) => s, children: [{ type: "text", text: "pressable" }] }, { type: "button", label: "plain" }] })`,
    ),
  },
  {
    // Canvases: a key only (an id, no input), a handler only (an id and pointer: true), both, a GPU canvas with a
    // handler, a keyed canvas without a handler repeated; carousels with and without a handler.
    name: "canvases-and-carousels",
    source: view(
      `ui.stack([ui.canvas({ key: "scene", height: 10 }), ui.canvas({ height: 10, onPointer: (s) => s }), ui.canvas({ key: "game", height: 10, onPointer: (s) => s, place: "fill" }), ui.canvas({ key: "gpu", wgsl: "fn shade(p: vec2f) -> vec4f { return vec4f(1.0); }", height: 10, onPointer: (s) => s }), ui.canvas({ key: "scene", height: 5 }), ui.carousel({}, [ui.text("p")]), ui.carousel({ index: 1, onChange: (s) => s }, [ui.text("q"), ui.text("r")])])`,
    ),
  },
  {
    // Every control type, with and without handlers.
    name: "controls",
    source: view(
      `ui.column([ui.button("b"), ui.button("bh", { onPress: (s) => s, variant: "primary" }), ui.checkbox("c", true), ui.checkbox("ch", false, { onChange: (s) => s }), ui.slider({ value: 1, min: 0, max: 2 }), ui.slider({ value: 1, min: 0, max: 2, onChange: (s) => s }), ui.select(["a", "b"], { value: "a" }), ui.select(["a"], { multiple: true, onChange: (s) => s }), ui.input("v"), ui.input("w", { onChange: (s) => s, multiline: true }), ui.card({ selected: true }, [ui.text("no handler")]), ui.card({ onPress: (s) => s }, [ui.text("handler")])])`,
    ),
  },
  {
    // One node object used twice in one view: each place gets its own id.
    name: "shared-node",
    source: `function view() {\n  const go = ui.button("Go", { onPress: (s) => s })\n  return ui.column([go, ui.text("between"), go])\n}`,
  },
  {
    // Containers inside containers, keyed and not, with handlers deep down.
    name: "deep-tree",
    source: view(
      `ui.column([ui.row({ key: "a" }, [ui.stack([ui.card({ onPress: (s) => s }, [ui.row([ui.button("deep", { onPress: (s) => s })])])])]), ui.row([[ui.column({ key: "b" }, [ui.button("in b")])]])])`,
    ),
  },
  {
    // Handler props on nodes that don't take that event: left out, no id, no pointer.
    name: "handler-props-elsewhere",
    source: view(
      `ui.column([ui.text("t", { onPress: (s) => s }), ui.button("b", { onChange: (s) => s }), ui.select(["a"], { onPress: (s) => s }), ui.canvas({ height: 1, onPress: (s) => s }), ui.card({ onChange: (s) => s }, [ui.text("c")]), ui.column({ onPointer: (s) => s }, [])])`,
    ),
  },
  // A function anywhere else in the view fails the step: in a prop, as a child, inside a prop's value, as an id.
  { name: "function-in-a-prop", drops: true, source: view(`ui.column({ onHover: (s) => s }, [ui.text("t")])`) },
  { name: "function-as-a-child", drops: true, source: view(`ui.column([ui.text("t"), (s) => s])`) },
  {
    name: "function-in-an-option",
    drops: true,
    source: view(`ui.select([{ value: "a", label: "A", pick: (s) => s }])`),
  },
  { name: "function-as-an-id", drops: true, source: view(`ui.button("b", { id: (s) => s })`) },
  {
    // Number and boolean keys, written as JavaScript's String(key) writes them.
    name: "number-keys",
    source: view(
      `ui.row([ui.button("a", { key: 1.5 }), ui.button("b", { key: -0 }), ui.button("c", { key: 1e21 }), ui.button("d", { key: 0.1 + 0.2 }), ui.button("e", { key: 123456789012345680000 }), ui.button("f", { key: 1e-7 }), ui.button("g", { key: -12.25 }), ui.canvas({ key: 2, height: 1 }), ui.button("h", { key: NaN }), ui.button("i", { key: Infinity }), ui.button("j", { key: -Infinity }), ui.button("k", { key: true }), ui.button("l", { key: false })])`,
    ),
  },
  // A key that is not a string, a number or a boolean fails the step, in phase view.
  { name: "object-key", source: view(`ui.column([ui.text("t", { key: { a: 1 } })])`) },
  { name: "array-key", source: view(`ui.column([ui.button("b", { key: ["a"] })])`) },
  { name: "function-key", source: view(`ui.column([ui.button("b", { key: () => 1 })])`) },
  { name: "root-object-key", source: view(`ui.column({ key: {} }, [])`) },
  // Views of 16 and of 100 levels, the most, one with the deepest prop a node has at level 100 (an option's label:
  // value depth 201 of the 202 the boundary takes); views one level too deep (101), with and without arrays among the
  // children, which the host's walk fails in phase view; and one too deep to cross the boundary at all (150), which
  // the prelude reports as too deep in phase view.
  { name: "depth-16", source: nested(16) },
  { name: "depth-100", source: nested(100) },
  {
    name: "depth-100-options",
    source: nested(100, false, `ui.select([{ value: "a", label: "A", description: "d" }], { onChange: (s) => s })`),
  },
  { name: "depth-101", source: nested(101) },
  { name: "depth-101-in-arrays", source: nested(51, true) },
  { name: "depth-150", source: nested(150) },
  // The rest of a step's output is the run's result, as JSON: toJSON, Error fields, big numbers, functions left out.
  { name: "state-as-json", source: `function init() {\n  return ${json}\n}\n${view(`ui.text("x")`)}` },
  {
    name: "submit-as-json",
    source: view(`ui.button("go", { onPress: () => submit(${json}) })`),
    input: { phase: "event", data: null, state: { n: 1 }, event: { id: "0", type: "press" } },
  },
  {
    name: "send-as-json",
    source: view(`ui.button("go", { onPress: () => send(${json}, { wake: false, state: { n: 2 } }) })`),
    input: { phase: "event", data: null, state: { n: 1 }, event: { id: "0", type: "press" } },
  },
  {
    name: "dismiss",
    source: view(`ui.button("go", { onPress: () => dismiss() })`),
    input: { phase: "event", data: null, state: { n: 1 }, event: { id: "0", type: "press" } },
  },
  // A wheel (only under pointer capture) goes to `onPointer` as `{ kind, dx, dy }`; other fields are left out, and a
  // number that isn't one is 0.
  {
    name: "wheel",
    source: view(`ui.canvas({ height: 10, onPointer: (state, p) => ({ ...state, p }) })`),
    input: {
      phase: "event",
      data: null,
      state: { n: 1 },
      event: { id: "0", type: "pointer", value: { kind: "wheel", dx: 0, dy: -120, width: 9 } },
    },
    newer: true,
  },
  {
    name: "wheel-captured",
    source: view(`ui.canvas({ height: 10, onPointer: (state, p) => ({ ...state, p }) })`),
    input: {
      phase: "event",
      data: null,
      state: { n: 1 },
      event: { id: "0", type: "pointer", value: { kind: "wheel", dx: 3.5, dy: "down" } },
    },
    newer: true,
  },
  // A typed array can't be data: the step fails as the run's result does.
  {
    name: "typed-array-in-state",
    source: `function init() {\n  return { values: new Float32Array([1, 2]) }\n}\n${view(`ui.text("x")`)}`,
  },
  {
    // Two siblings with the same segment and handlers (a repeated key, and a key written like its repeat): the later
    // one takes the id's events, and the earlier one's subtree still takes the ids only it has. Carousels whose
    // children flatten to more and to fewer pages than the array has items.
    name: "collisions-and-pages",
    source: view(
      `ui.column([ui.button("first", { key: "k", onPress: (s) => s }), ui.card({ key: "k", onPress: (s) => s }, [ui.button("only here", { onPress: (s) => s })]), ui.card({ key: "k~2", onPress: (s) => s }, [ui.text("none")]), ui.carousel({ onChange: (s) => s }, [[ui.text("a"), ui.text("b"), ui.text("c"), ui.text("d")]]), ui.carousel({ onChange: (s) => s }, [null, null, null, ui.text("e")])])`,
    ),
  },
  {
    // The wire benchmark's grid: 200 cards of six nodes.
    name: "grid-200",
    source: view(
      `ui.column({ gap: 1 }, [ui.row({ wrap: true, gap: 1 }, Array.from({ length: 200 }, (_, i) => ui.card({ selected: i === 3, onPress: (s) => s }, [ui.row({ gap: 1 }, [ui.text("Item " + i, { style: "body" }), ui.text(String(i * 7), { tone: "muted" })]), ui.text("Note " + i, { style: "caption" }), ui.button("Go", { onPress: (s) => s })])))])`,
    ),
  },
  {
    // Tables: rows and a header that take presses (selectable, sortable, in that order, after the id), one that takes
    // only header presses, and one with no handlers (no id). Numbers stay numbers in the view. Protocol 1's prelude
    // doesn't know tables or onSort.
    name: "tables",
    source: view(
      `ui.column([ui.table(["Day", { label: "kg", align: "end" }, { label: "kcal", align: "end" }], [["Nov 27", 79.6, 1150], ["Nov 26", 80.1]], { sort: { column: 0, descending: true }, selected: 0, onPress: (s, row) => s, onSort: (s, column) => s }), ui.table(["a"], [["x"]], { key: "sorted", onSort: (s) => s }), ui.table([{ label: "n", align: "end" }], [[1e21], [0.1]])])`,
    ),
    newer: true,
  },
]

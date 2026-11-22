// Edge cases of view tree building (ids, keys, flattening, stripping) for the wire conformance fixtures in
// `wire/`. Each is a widget template source; `data` is its input (default null).
const view = (expression: string) => `function view(state, data) {\n  return ${expression}\n}`

export const cases: ReadonlyArray<{ readonly name: string; readonly source: string; readonly data?: unknown }> = [
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
    // Functions where no handler goes: as a child (null on the wire), in another prop, inside a prop's value, and
    // handler props on nodes that don't take that event.
    name: "function-values",
    source: view(
      `ui.column({ onHover: (s) => s }, [ui.text("t", { onPress: (s) => s }), (s) => s, ui.button("b", { onChange: (s) => s }), ui.select([{ value: "a", label: "A", pick: (s) => s }], { onPress: (s) => s }), ui.canvas({ height: 1, onPress: (s) => s }), ui.card({ onChange: (s) => s }, [ui.text("c")])])`,
    ),
  },
  {
    // Number keys, written as JavaScript's String(number) writes them (finite ones: a fixture is JSON).
    name: "number-keys",
    source: view(
      `ui.row([ui.button("a", { key: 1.5 }), ui.button("b", { key: -0 }), ui.button("c", { key: 1e21 }), ui.button("d", { key: 0.1 + 0.2 }), ui.button("e", { key: 123456789012345680000 }), ui.button("f", { key: 1e-7 }), ui.button("g", { key: -12.25 }), ui.canvas({ key: 2, height: 1 })])`,
    ),
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
]

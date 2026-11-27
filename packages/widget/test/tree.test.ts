import { expect, test } from "bun:test"
import { MAX_VALUE_DEPTH } from "../src/host.js"
import { Host, Runtime } from "psychoscript"
import { builtins, program } from "../src/index.js"
import { tree } from "../src/tree.js"
import { examples } from "./fixtures/diagrams.js"
import { STEP } from "./limits.js"

// The host's tree building (`src/tree.ts`) against the prelude's as it was before it was made faster and then moved to
// the hosts (one closure per node, a copy of every node, an id table of every path), run on the same view as built:
// views must come out byte-identical, with the same handler ids and canvas keys.
const reference = `
const __REFERENCE_CONTROLS = {
  button: { event: "press", handler: "onPress", always: true },
  card: { event: "press", handler: "onPress" },
  checkbox: { event: "change", handler: "onChange", always: true },
  slider: { event: "change", handler: "onChange", always: true },
  select: { event: "change", handler: "onChange", always: true },
  input: { event: "change", handler: "onChange", always: true },
  carousel: { event: "change", handler: "onChange" },
  canvas: { event: "pointer", handler: "onPointer", keyed: true },
}
function __reference_tree(root) {
  const handlers = {}
  const canvases = {}
  const used = {}
  const visit = (node, path) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return node
    const { key, id, pointer, onPress, onChange, onPointer, children, ...out } = node
    const control = __REFERENCE_CONTROLS[node.type]
    if (control) {
      const handler = node[control.handler]
      const keyed = control.keyed && key !== undefined && key !== null
      if (typeof handler === "function" || control.always || keyed) {
        out.id = path
        if (typeof handler === "function") handlers[path] = { event: control.event, handler, node: out }
        // Only a canvas with a handler takes input; one with just a key has an id for \`widget.draw\`.
        if (node.type === "canvas" && typeof handler === "function") out.pointer = true
        if (keyed && canvases[String(key)] === undefined)
          canvases[String(key)] = { id: path, wgsl: typeof node.wgsl === "string" }
      }
    }
    if (children === undefined) return out
    const items = []
    const collect = (value, at) => {
      if (Array.isArray(value))
        value.forEach((item, index) => collect(item, at === "" ? String(index) : at + "." + index))
      else if (value) items.push([value, at])
    }
    collect(Array.isArray(children) ? children : [children], "")
    out.children = items.map(([child, at]) => {
      const named = child && typeof child === "object" && child.key !== undefined && child.key !== null
      let next = path + "/" + (named ? ":" + encodeURIComponent(String(child.key)) : at)
      // Repeated keys among siblings still get distinct ids, in order.
      used[next] = (used[next] ?? 0) + 1
      if (used[next] > 1) next = next + "~" + used[next]
      return visit(child, next)
    })
    return out
  }
  const named = root && typeof root === "object" && root.key !== undefined && root.key !== null
  const view = visit(root, named ? ":" + encodeURIComponent(String(root.key)) : "0")
  return { view, handlers, canvases }
}
`

// Runs `source`'s view and returns both trees' JSON: the host's, from the view as it crosses, and the reference's.
const trees = async (source: string, data: unknown) => {
  const crossed: { view?: unknown } = {}
  const result = await Runtime.make({
    typedArrays: true,
    limits: { ...STEP, maxValueDepth: MAX_VALUE_DEPTH },
    translate: { functions: "mark" },
    globals: () => ({ __cross: Host.fn(([view]) => void (crossed.view = view)) }),
  }).execute(
    program(source) +
      reference +
      `
      const __data = ${JSON.stringify(data)}
      const __state = (typeof init === "function" ? init(__data) : undefined) ?? {}
      const __view = view(__state, __data)
      __cross(__view)
      const __tree = __reference_tree(__view)
      return JSON.stringify([__tree.view, Object.keys(__tree.handlers), __tree.canvases])`,
  )
  if (!result.ok) throw new Error(result.error.message)
  const host = tree(crossed.view, "Argument 1 to __cross")
  return [
    JSON.stringify([
      host.view,
      [...host.handlers],
      Object.fromEntries([...host.canvases].map(([key, canvas]) => [key, { id: canvas.id, wgsl: canvas.wgsl }])),
    ]),
    result.value as string,
  ] as const
}

const data: Record<string, unknown> = {
  ...examples,
  suggestions: {
    title: "Pick",
    options: [
      { label: "A", note: "n", images: ["a.png", "b.png"], recommended: true },
      { label: "B", images: ["b.png"] },
    ],
  },
  form: {
    title: "Form",
    fields: [
      { key: "name", type: "text", label: "Name" },
      { key: "size", type: "number", label: "Size", min: 1, max: 9 },
      { key: "on", type: "boolean", label: "On" },
      { key: "pick", type: "select", label: "Pick", options: [{ value: "a", label: "A" }], multiple: true },
    ],
  },
  confirm: { title: "Sure?", message: "Really.", danger: true },
  chart: { title: "Chart", kind: "bar", labels: ["a", "b"], series: [{ label: "s", values: [1, 2] }], choose: true },
  backdrop: { title: "Hi", preset: "plasma", text: "x" },
}

test("every built-in's view comes out byte-identical to the reference tree building", async () => {
  // The reference predates the table node, which the built-in `table` is (its wire fixture covers it).
  const step = builtins.filter((template) => template.mode === "step" && template.name !== "table")
  expect(step.map((template) => template.name).filter((name) => !(name in data))).toEqual([])
  for (const template of step) {
    const [fast, slow] = await trees(template.source, data[template.name])
    expect([template.name, fast]).toEqual([template.name, slow])
  }
})

test("edge cases come out byte-identical: holes, nested arrays, keys, repeats, stray props, plain leaves", async () => {
  const views = [
    // Holes keep their index; nested arrays get index.index; a single child that isn't an array.
    `ui.column({ gap: 1 }, [ui.text("a"), false, null, [ui.button("b", { onPress: (s) => s }), [ui.text("c"), ui.input("", { onChange: (s) => s })]], undefined, ui.button("d")])`,
    `ui.card({ onPress: (s) => s }, ui.text("only"))`,
    // Keys, repeated keys (and a key that looks like a repeat), a keyed root, numbers and strings as keys.
    `ui.row({ key: "root" }, [ui.button("x", { key: "k" }), ui.button("y", { key: "k" }), ui.button("z", { key: "k~2" }), ui.text("t", { key: 3 }), ui.card({ key: "a/b c" }, [ui.button("in")])])`,
    // Stray props the prelude takes off, on leaves and containers; undefined and null keys; non-object children.
    `ui.column([ui.text("s", { id: "mine", pointer: true, onPress: (s) => s, onChange: undefined }), ui.text("n", { key: null }), ui.text("u", { key: undefined }), "loose", 7, ui.markdown("**m**"), ui.divider(), ui.image("i.png", { alt: "i" })])`,
    // Canvases: a key only, a handler only, both, wgsl, and a carousel with and without a handler.
    `ui.stack([ui.canvas({ key: "scene", height: 10 }), ui.canvas({ height: 10, onPointer: (s) => s }), ui.canvas({ key: "gpu", wgsl: "x", height: 10, onPointer: (s) => s, place: "fill" }), ui.carousel({}, [ui.text("p")]), ui.carousel({ onChange: (s) => s }, [ui.text("q"), ui.text("r")])])`,
    // A big grid, as in the wire benchmark.
    `ui.column({ gap: 1 }, [ui.row({ wrap: true }, Array.from({ length: 200 }, (_, i) => ui.card({ selected: i === 3, onPress: (s) => s }, [ui.row({ gap: 1 }, [ui.text("Item " + i), ui.text(String(i), { tone: "muted" })]), ui.text("Note", { style: "caption" }), ui.button("Go", { onPress: (s) => s })])))])`,
    // A plain leaf as the root.
    `ui.text("alone")`,
  ]
  for (const view of views) {
    const [fast, slow] = await trees(`function view() { return ${view} }`, {})
    expect(fast).toBe(slow)
  }
})

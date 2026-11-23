import { expect, test } from "bun:test"
import {
  builtins,
  type Canvas,
  type Command,
  type Frame,
  NAME,
  type Node,
  type Pointer,
  program,
  validateData,
  WidgetSession,
} from "../src/index.js"
import { STEP } from "./limits.js"

const widgetTemplate = (name: string) => {
  const found = builtins.find((item) => item.name === name)
  if (!found) throw new Error(`no builtin ${name}`)
  return found
}

const start = async (name: string, data: unknown) => {
  expect(validateData(widgetTemplate(name).data, data)).toEqual([])
  return WidgetSession.start(program(widgetTemplate(name).source), data, STEP)
}

// Every node in the view, depth first, for asserting on parts of a built-in's view.
const nodes = (node: Node): Node[] => [node, ...("children" in node ? node.children.flatMap(nodes) : [])]
const find = (view: Node, predicate: (node: Node) => boolean) => nodes(view).filter(predicate)

const press = (id: string) => ({ id, type: "press" as const })
const change = (id: string, value: unknown) => ({ id, type: "change" as const, value })
// Ids come from the prelude (the node's place in the view), so tests find the node first, as a client would.
const idOf = (session: WidgetSession, predicate: (node: Node) => boolean) => {
  const found = nodes(session.view).find(predicate)
  if (!found || !("id" in found) || !found.id) throw new Error("no such node with an id")
  return found.id
}
const labeled = (label: string) => (node: Node) => "label" in node && node.label === label
const pressOn = (session: WidgetSession, predicate: (node: Node) => boolean) =>
  session.dispatch(press(idOf(session, predicate)))
const changeOn = (session: WidgetSession, predicate: (node: Node) => boolean, value: unknown) =>
  session.dispatch(change(idOf(session, predicate), value))
const card = (index: number) => {
  const seen = { count: -1 }
  return (node: Node) => node.type === "card" && ++seen.count === index
}

test("built-ins have valid names", () => {
  expect(builtins.map((item) => item.name)).toEqual([
    "suggestions",
    "form",
    "confirm",
    "chart",
    "backdrop",
    "pie",
    "scatter",
    "histogram",
    "area",
    "heatmap",
    "treemap",
    "sankey",
    "graph",
    "tree",
    "timeline",
    "funnel",
    "radar",
    "gauge",
    "boxplot",
    "flowchart",
    "sequence",
    "table",
  ])
  expect(builtins.every((item) => item.builtin && NAME.test(item.name) && item.description.length > 0)).toBe(true)
})

test("suggestions: pick a card, add a note, choose", async () => {
  const session = await start("suggestions", {
    title: "Pick a palette",
    options: [
      { label: "Warm", note: "Oranges and reds", images: ["warm-1.png", "warm-2.png"], recommended: true },
      { label: "Cool", images: ["https://example.com/cool.png"] },
    ],
  })
  const cards = find(session.view, (node) => node.type === "card")
  expect(cards.map((node) => node.type === "card" && node.id)).toEqual(["0/1/0", "0/1/1"])
  expect(find(cards[0], (node) => node.type === "carousel")).toHaveLength(1)
  expect(find(cards[0], (node) => node.type === "image")).toHaveLength(2)
  expect(find(cards[1], (node) => node.type === "carousel")).toHaveLength(0)
  expect(find(session.view, (node) => node.type === "text" && node.text === "(Recommended)")).toHaveLength(1)
  expect(
    find(session.view, (node) => node.type === "button" && node.label === "Choose" && node.disabled === true),
  ).toHaveLength(1)

  // Choosing before picking does nothing.
  expect((await pressOn(session, labeled("Choose"))).submit).toBeUndefined()
  await pressOn(session, card(1))
  expect(
    find(session.view, (node) => node.type === "card" && node.selected === true).map(
      (node) => node.type === "card" && node.id,
    ),
  ).toEqual(["0/1/1"])
  await changeOn(session, (node) => node.type === "input", "  but bluer  ")
  expect((await pressOn(session, labeled("Choose"))).submit).toEqual({ choice: "Cool", index: 1, note: "but bluer" })
})

test("suggestions: no note input when allowNote is false, and dismiss", async () => {
  const session = await start("suggestions", {
    title: "Pick",
    allowNote: false,
    options: [
      { label: "A", images: ["a.png"] },
      { label: "B", images: ["b.png"] },
    ],
  })
  expect(find(session.view, (node) => node.type === "input")).toHaveLength(0)
  await pressOn(session, card(0))
  expect((await pressOn(session, labeled("Choose"))).submit).toEqual({ choice: "A", index: 0 })
  expect((await pressOn(session, labeled("Dismiss"))).dismiss).toBe(true)
})

test("suggestions data schema enforces 2..3 options with 1..3 images", () => {
  const data = widgetTemplate("suggestions").data
  expect(validateData(data, { title: "x", options: [{ label: "a", images: ["a"] }] })).toEqual([
    "/options: must have at least 2 items",
  ])
  expect(
    validateData(data, {
      title: "x",
      options: [
        { label: "a", images: [] },
        { label: "b", images: ["b"] },
      ],
    }),
  ).toEqual(["/options/0/images: must have at least 1 items"])
})

test("form: one control per field type, edit, submit", async () => {
  const session = await start("form", {
    title: "New project",
    description: "Set up **everything**",
    submitLabel: "Create",
    fields: [
      { key: "name", type: "text", label: "Name", placeholder: "my-app" },
      { key: "size", type: "number", label: "Size", min: 1, max: 10, step: 1, default: 3 },
      { key: "private", type: "boolean", label: "Private" },
      {
        key: "stack",
        type: "select",
        label: "Stack",
        options: [
          { value: "bun", label: "Bun" },
          { value: "node", label: "Node" },
        ],
      },
      {
        key: "tags",
        type: "select",
        label: "Tags",
        multiple: true,
        options: [
          { value: "web", label: "Web" },
          { value: "cli", label: "CLI" },
        ],
      },
    ],
  })
  expect(nodes(session.view).map((node) => node.type)).toEqual([
    "column",
    "text",
    "markdown",
    "column",
    "input",
    "slider",
    "checkbox",
    "select",
    "select",
    "row",
    "button",
  ])
  expect(find(session.view, (node) => node.type === "slider")).toEqual([
    { type: "slider", id: "0/2/1", label: "Size", value: 3, min: 1, max: 10, step: 1 },
  ])
  expect(find(session.view, (node) => node.type === "button")).toEqual([
    { type: "button", id: "0/3/0", label: "Create", variant: "primary" },
  ])

  await changeOn(session, labeled("Name"), "atlas")
  // The slider's handler gets the value clamped to its range; values that aren't options are dropped.
  await changeOn(session, labeled("Size"), 42)
  await changeOn(session, labeled("Private"), true)
  await changeOn(session, labeled("Stack"), "node")
  await changeOn(session, labeled("Stack"), "deno")
  await changeOn(session, labeled("Tags"), ["web", "cli", "gui"])
  expect(find(session.view, (node) => node.type === "checkbox")).toEqual([
    { type: "checkbox", id: "0/2/2", label: "Private", checked: true },
  ])
  expect((await pressOn(session, labeled("Create"))).submit).toEqual({
    name: "atlas",
    size: 10,
    private: true,
    stack: "node",
    tags: ["web", "cli"],
  })
})

test("form submits defaults untouched", async () => {
  const session = await start("form", {
    title: "Defaults",
    fields: [
      { key: "note", type: "text", label: "Note", multiline: true, default: "hi" },
      { key: "level", type: "number", label: "Level", min: 2, max: 5 },
      { key: "on", type: "boolean", label: "On", default: true },
    ],
  })
  expect((await pressOn(session, labeled("Submit"))).submit).toEqual({ note: "hi", level: 2, on: true })
})

test("form data schema checks each field type", () => {
  expect(
    validateData(widgetTemplate("form").data, {
      title: "x",
      fields: [{ key: "n", type: "number", label: "N", min: 0 }],
    }),
  ).toEqual(["/fields/0/max: is required"])
})

test("confirm: confirm and cancel", async () => {
  const session = await start("confirm", {
    title: "Delete branch?",
    message: "This removes `widgets` for good.",
    confirmLabel: "Delete",
    danger: true,
  })
  expect(find(session.view, (node) => node.type === "button")).toEqual([
    { type: "button", id: "0/2/0", label: "Delete", variant: "danger" },
    { type: "button", id: "0/2/1", label: "Cancel", variant: "secondary" },
  ])
  expect((await pressOn(session, labeled("Cancel"))).submit).toEqual({ confirmed: false })
  expect((await pressOn(session, labeled("Delete"))).submit).toEqual({ confirmed: true })
})

const frame = (t: number, pointer: Frame["pointer"] = null): Frame => ({
  id: "0/1",
  t,
  dt: 1 / 60,
  width: 400,
  height: 240,
  scale: 2,
  pointer,
  dark: true,
})
const pointer = (kind: Pointer["kind"], x: number, y: number) => ({
  id: "0/1",
  type: "pointer" as const,
  value: { kind, x, y, width: 400, height: 240 },
})
const texts = (commands: ReadonlyArray<Command>) =>
  commands.flatMap((command) => (command[0] === "text" ? [command[3]] : []))
const shapes = (commands: ReadonlyArray<Command>, kind: Command[0]) => commands.filter((command) => command[0] === kind)
const caption = (view: Node) =>
  find(view, (node) => node.type === "text").map((node) => node.type === "text" && node.text)[1]

const revenue = {
  title: "Revenue",
  kind: "bar",
  unit: "k",
  labels: ["Jan", "Feb", "Mar", "Apr"],
  series: [
    { label: "2025", values: [12, 18, 9, 24] },
    { label: "2026", values: [15, 21, 14, 29], color: "#f59e0b" },
  ],
}

test("chart: bars grow in, then the canvas stops animating", async () => {
  const session = await start("chart", revenue)
  expect(find(session.view, (node) => node.type === "canvas")).toEqual([
    {
      type: "canvas",
      id: "0/1",
      pointer: true,
      height: 240,
      fps: 60,
      duration: 0.65,
      alt: "Bar chart. 2025: Jan 12k, Feb 18k, Mar 9k, Apr 24k; 2026: Jan 15k, Feb 21k, Mar 14k, Apr 29k",
    },
  ])
  const height = (commands: ReadonlyArray<Command>) =>
    shapes(commands, "rrect").reduce((sum, command) => sum + (command[0] === "rrect" ? command[4] : 0), 0)
  expect(shapes((await session.draw(frame(0))).commands, "rrect")).toHaveLength(0)
  // The groups start one after another: at 0.05 s only January's two bars have begun.
  const early = (await session.draw(frame(0.05))).commands
  const middle = (await session.draw(frame(0.3))).commands
  const end = (await session.draw(frame(0.65))).commands
  expect(shapes(early, "rrect")).toHaveLength(2)
  expect(height(middle)).toBeGreaterThan(height(early))
  expect(height(end)).toBeGreaterThan(height(middle))
  expect(shapes(end, "rrect")).toHaveLength(8)
  expect((await session.draw(frame(5))).commands).toEqual(end)
  // Axes, gridlines, the x labels and a legend for two series.
  expect(texts(end)).toEqual(["0", "10", "20", "30", "Jan", "Feb", "Mar", "Apr", "2025", "2026"])
  expect(shapes(end, "line")).toHaveLength(4)
})

test("chart: pressing a bar shows its value, animating only while down", async () => {
  const session = await start("chart", revenue)
  expect(caption(session.view)).toBe("Press a bar to read its value")
  // The plot starts at x 26 with 90.5 px per label: April's bars span 312.75..340.75 (2025) and 344.75..372.75 (2026).
  const down = await session.dispatch(pointer("down", 360, 120))
  expect(down.state).toEqual({ active: { series: 1, index: 3 }, down: true })
  expect(find(session.view, (node) => node.type === "canvas" && node.duration === undefined)).toHaveLength(1)
  expect(caption(session.view)).toBe("Apr · 2026: 29k")
  const pressed = (await session.draw(frame(2))).commands
  expect(texts(pressed).slice(-2)).toEqual(["Apr", "29k"])
  expect(shapes(pressed, "alpha")).toHaveLength(7)
  await session.dispatch(pointer("move", 325, 120))
  expect(session.state).toEqual({ active: { series: 0, index: 3 }, down: true })
  const up = await session.dispatch(pointer("up", 325, 120))
  expect(up.submit).toBeUndefined()
  expect(session.state).toEqual({ active: { series: 0, index: 3 }, down: false })
  expect(find(session.view, (node) => node.type === "canvas" && node.duration === 0.65)).toHaveLength(1)
  // A tap outside the plot clears the selection.
  await session.dispatch(pointer("down", 200, 5))
  await session.dispatch(pointer("up", 200, 5))
  expect(session.state).toEqual({ active: null, down: false })
})

test("chart: hovering without pressing highlights from the frame pointer", async () => {
  const session = await start("chart", revenue)
  const hovered = (await session.draw(frame(1, { x: 325, y: 120, down: false }))).commands
  expect(texts(hovered).slice(-2)).toEqual(["Apr", "24k"])
  expect(session.state).toEqual({ active: null, down: false })
})

test("chart: with choose, tapping a point submits it", async () => {
  const session = await start("chart", {
    title: "Latency",
    kind: "line",
    unit: "ms",
    choose: true,
    series: [
      { label: "p50", values: [120, 135, 128, 160] },
      { label: "p99", values: [420, 380, 510, 470] },
    ],
  })
  expect(caption(session.view)).toBe("Tap a point to choose it")
  const lines = (await session.draw(frame(1))).commands
  expect(shapes(lines, "path").filter((command) => command[0] === "path" && command[2].width === 2.5)).toHaveLength(2)
  expect(shapes(lines, "circle").length).toBeGreaterThanOrEqual(8)
  await session.dispatch(pointer("down", 380, 70))
  const output = await session.dispatch(pointer("up", 380, 70))
  expect(output.submit).toEqual({ series: "p99", index: 3, value: 470 })
})

test("chart: the line draws in progressively", async () => {
  const session = await start("chart", { title: "One", kind: "line", series: [{ label: "a", values: [1, 3, 2, 5] }] })
  const segments = async (t: number) =>
    (await session.draw(frame(t))).commands.flatMap((command) =>
      command[0] === "path" && command[2].width === 2.5 ? [command[1].length] : [],
    )
  expect(await segments(0)).toEqual([1])
  expect((await segments(0.1))[0]).toBeLessThan(4)
  expect(await segments(1)).toEqual([4])
})

test("chart data schema checks the kind and colors", () => {
  const data = widgetTemplate("chart").data
  expect(validateData(data, { title: "x", kind: "pie", series: [{ label: "a", values: [1] }] })).toEqual([
    '/kind: must be one of "bar", "line"',
  ])
  expect(validateData(data, { title: "x", kind: "bar", series: [{ label: "a", values: [1], color: "red" }] })).toEqual([
    "/series/0/color: must match ^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$",
  ])
})

test("backdrop: a GPU canvas per preset driven by the speed slider", async () => {
  const session = await start("backdrop", {
    title: "Launch",
    preset: "aurora",
    text: "We **shipped**.",
    accent: "#f0a",
  })
  const shader = () =>
    nodes(session.view).find((node): node is Canvas => node.type === "canvas" && node.wgsl !== undefined)
  expect(shader()).toMatchObject({ height: 200, fps: 60, values: [1, 1, 0, 2 / 3] })
  expect(shader()).not.toHaveProperty("id")
  expect(shader()?.wgsl).toContain("fn shade(frag: vec2f) -> vec4f")
  expect(nodes(session.view).map((node) => node.type)).toEqual(["column", "canvas", "text", "markdown", "slider"])
  await changeOn(session, labeled("Speed"), 0.25)
  expect(shader()).toMatchObject({ fps: 60, values: [0.3, 1, 0, 2 / 3] })
  const paused = await changeOn(session, labeled("Speed"), 0)
  expect(paused.submit).toBeUndefined()
  expect(shader()).toMatchObject({ fps: 0, values: [0, 1, 0, 2 / 3] })
  const presets = await Promise.all(
    (["plasma", "aurora", "waves"] as const).map(async (preset) => {
      const view = (await start("backdrop", { title: "x", preset })).view
      return find(view, (node) => node.type === "canvas").map((node) => node.type === "canvas" && node.wgsl)[0]
    }),
  )
  expect(new Set(presets).size).toBe(3)
})

test("step built-ins ignore key, focus and capture events", async () => {
  const { examples } = await import("./fixtures/diagrams.js")
  const data: Record<string, unknown> = {
    ...examples,
    suggestions: {
      title: "Pick",
      options: [
        { label: "A", images: ["a.png"] },
        { label: "B", images: ["b.png"] },
      ],
    },
    form: { title: "Form", fields: [{ key: "name", type: "text", label: "Name" }] },
    confirm: { title: "Sure?", message: "Really." },
    chart: revenue,
    backdrop: { title: "Hi", preset: "plasma" },
  }
  const events = [
    { id: "", type: "focus" as const, value: true },
    {
      id: "",
      type: "key" as const,
      value: {
        kind: "down" as const,
        key: "a",
        code: "KeyA",
        repeat: false,
        shift: false,
        alt: false,
        ctrl: false,
        meta: false,
      },
    },
    { id: "", type: "capture" as const, value: true },
    { id: "", type: "focus" as const, value: false },
  ]
  const step = builtins.filter((item) => item.mode === "step")
  expect(step.map((item) => item.name).filter((name) => !(name in data))).toEqual([])
  for (const item of step) {
    const session = await start(item.name, data[item.name])
    const before = session.state
    for (const event of events) {
      const output = await session.dispatch(event)
      expect({ name: item.name, submit: output.submit, dismiss: output.dismiss, send: output.send }).toEqual({
        name: item.name,
        submit: undefined,
        dismiss: undefined,
        send: undefined,
      })
    }
    expect({ name: item.name, state: session.state }).toEqual({ name: item.name, state: before })
  }
})

import { describe, expect, test } from "bun:test"
import {
  builtins,
  type Button,
  type Canvas,
  type Command,
  type Frame,
  MAX_COMMANDS,
  type Node,
  program,
  step,
  StepError,
  validateData,
  WidgetSession,
} from "../src/index.js"
import { examples } from "./fixtures/diagrams.js"
import { STEP } from "./limits.js"

type Name = keyof typeof examples

const widgetTemplate = (name: string) => {
  const found = builtins.find((item) => item.name === name)
  if (!found) throw new Error(`no builtin ${name}`)
  return found
}

const start = async (name: string, data: unknown) => {
  expect(validateData(widgetTemplate(name).data, data)).toEqual([])
  return WidgetSession.start(program(widgetTemplate(name).source), data, STEP)
}

const nodes = (node: Node): Node[] => [node, ...("children" in node ? node.children.flatMap(nodes) : [])]
const canvases = (view: Node) => nodes(view).filter((node): node is Canvas => node.type === "canvas")
const texts = (view: Node) => nodes(view).flatMap((node) => (node.type === "text" ? [node.text] : []))
// The button whose label starts with `label`, and a press on it: ids come from the prelude, so tests find nodes.
const button = (view: Node, label: string) =>
  nodes(view).find((node): node is Button => node.type === "button" && node.label.startsWith(label))
const press = (session: WidgetSession, label: string) =>
  session.dispatch({ id: button(session.view, label)?.id ?? "missing", type: "press" })

const WIDTH = 600
const frame = (canvas: Canvas, t: number, width = WIDTH): Frame => ({
  id: canvas.id ?? null,
  t,
  dt: 1 / 60,
  width: canvas.width ?? width,
  height: canvas.height,
  scale: 2,
  pointer: null,
  dark: true,
})

// Draws the session's first canvas (at its current height) after the intro.
const drawn = async (session: WidgetSession, t = 10) =>
  (await session.draw(frame(canvases(session.view)[0], t))).commands

// A tap (down then up) on the session's first canvas.
const tap = async (session: WidgetSession, x: number, y: number) => {
  const canvas = canvases(session.view)[0]
  const value = { x, y, width: canvas.width ?? WIDTH, height: canvas.height }
  await session.dispatch({ id: canvas.id ?? "", type: "pointer", value: { kind: "down", ...value } })
  return session.dispatch({ id: canvas.id ?? "", type: "pointer", value: { kind: "up", ...value } })
}

const choose = async (session: WidgetSession) => (await press(session, "Choose")).submit

// Where a text command with this string is drawn, to tap what it labels.
const label = (commands: ReadonlyArray<Command>, text: string) => {
  const found = commands.find((command) => command[0] === "text" && command[3] === text)
  if (!found || found[0] !== "text") throw new Error(`no text ${text}`)
  return { x: found[1], y: found[2] }
}

describe("every diagram", () => {
  for (const name of Object.keys(examples) as Name[]) {
    test(`${name}: valid example, animated canvas, valid draws within budget`, async () => {
      expect(widgetTemplate(name).builtin).toBe(true)
      expect(widgetTemplate(name).description.length).toBeGreaterThan(20)
      const session = await start(name, examples[name])
      expect(texts(session.view)[0]).toBe(examples[name].title)
      const list = canvases(session.view)
      expect(list.length).toBeGreaterThan(0)
      for (const canvas of list) {
        expect(canvas.id).toBeString()
        expect(canvas.alt?.length).toBeGreaterThan(10)
        expect(canvas.fps).toBe(60)
        expect(canvas.duration).toBeGreaterThan(0)
        const duration = canvas.duration ?? 0
        for (const width of [WIDTH, 320]) {
          const early = (await session.draw(frame(canvas, duration * 0.3, width))).commands
          const end = (await session.draw(frame(canvas, duration, width))).commands
          expect(early.length).toBeLessThanOrEqual(MAX_COMMANDS)
          expect(end.length).toBeGreaterThan(0)
          expect(end.length).toBeLessThanOrEqual(MAX_COMMANDS)
          // The intro changes the picture; after it the canvas is idle and stable.
          expect(early).not.toEqual(end)
          expect((await session.draw(frame(canvas, duration + 5, width))).commands).toEqual(end)
        }
      }
      // With choose, the button starts disabled until something is selected.
      expect(button(session.view, "Choose")).toMatchObject({ disabled: true })
      expect(await choose(session)).toBeUndefined()
    })
  }

  test("every diagram has an example", () => {
    const names = builtins.filter(
      (item) => !["suggestions", "form", "confirm", "chart", "backdrop"].includes(item.name),
    )
    expect(names.map((item) => item.name).sort()).toEqual(Object.keys(examples).sort())
  })
})

test("pie: tap a slice to select it, tap the legend to hide one, choose", async () => {
  const session = await start("pie", examples.pie)
  // Pie at (195, 120) with radius 106 and a 61 px hole; Search runs clockwise from the top past 3 o'clock.
  await tap(session, 280, 120)
  expect(session.state).toEqual({ selected: 0, hidden: [] })
  expect(texts(session.view)).toContain("Search: 48k (48%)")
  expect(await choose(session)).toEqual({ label: "Search", index: 0, value: 48, share: 0.48 })
  // The legend rows start at y 70, 20 px each: Direct is the second.
  await tap(session, 420, 95)
  expect(session.state).toEqual({ selected: 0, hidden: [1] })
  expect(await choose(session)).toEqual({ label: "Search", index: 0, value: 48, share: 0.658 })
  // Tapping the hole clears the selection.
  await tap(session, 195, 120)
  expect(session.state).toEqual({ selected: null, hidden: [1] })
})

test("scatter: press reads the nearest point, legend hides a series, choose", async () => {
  const session = await start("scatter", examples.scatter)
  const canvas = canvases(session.view)[0]
  // "checkout" (300 KB, 820 ms) sits at about (448, 76).
  const down = await session.dispatch({
    id: canvas.id!,
    type: "pointer",
    value: { kind: "down", x: 452, y: 80, width: WIDTH, height: canvas.height },
  })
  expect(down.state).toMatchObject({ active: { series: 1, index: 4 }, down: true })
  expect(canvases(session.view)[0].duration).toBeUndefined()
  await session.dispatch({
    id: canvas.id!,
    type: "pointer",
    value: { kind: "up", x: 452, y: 80, width: WIDTH, height: canvas.height },
  })
  expect(texts(session.view)).toContain("checkout (Mobile) · KB 300, ms 820")
  expect(await choose(session)).toEqual({ series: "Mobile", index: 4, x: 300, y: 820, label: "checkout" })
  const commands = await drawn(session)
  expect(commands.filter((command) => command[0] === "line" && command[5].width === 2)).toHaveLength(2)
  // The legend sits above the plot after the "ms" axis title.
  await tap(session, 80, 12)
  expect(session.state).toMatchObject({ hidden: [0] })
})

test("histogram: bins once in init, tap a bar, choose", async () => {
  const session = await start("histogram", examples.histogram)
  const state = session.state as { bins: { from: number; to: number; count: number }[]; stats: { n: number } }
  expect(state.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(240)
  expect(state.stats.n).toBe(240)
  expect(state.bins.every((bin, index) => index === 0 || bin.from === state.bins[index - 1].to)).toBe(true)
  const bars = (await drawn(session)).filter((command) => command[0] === "rrect" && command[6].fill === "accent")
  const third = bars[2]
  if (third[0] !== "rrect") throw new Error("bar")
  await tap(session, third[1] + third[3] / 2, third[2] + 4)
  expect(session.state).toMatchObject({ active: 2 })
  const bin = state.bins[2]
  expect(await choose(session)).toEqual({ index: 2, from: bin.from, to: bin.to, count: bin.count })
  expect(
    start("histogram", { title: "x", values: [5, 5, 5], bins: 3 }).then((s) => (s.state as typeof state).bins.length),
  ).resolves.toBe(3)
})

test("area: press reads a band at a time, legend hides a series, modes", async () => {
  const session = await start("area", examples.area)
  // August is index 7 at x 387; the Hot band spans 0..27 TB there.
  await tap(session, 387, 216)
  expect(session.state).toMatchObject({ active: { series: 0, index: 7 }, down: false })
  expect(texts(session.view)).toContain("Aug · Hot: 27 TB")
  expect(await choose(session)).toEqual({ series: "Hot", index: 7, label: "Aug", value: 27 })
  await tap(session, 160, 12)
  expect(session.state).toMatchObject({ active: null, hidden: [2] })
  for (const mode of ["percent", "stream"]) {
    const other = await start("area", { ...examples.area, mode })
    const paths = (await drawn(other)).filter((command) => command[0] === "path")
    expect(paths).toHaveLength(3)
  }
  const percent = await start("area", { ...examples.area, mode: "percent" })
  expect((await drawn(percent)).some((command) => command[0] === "text" && command[3] === "100%")).toBe(true)
})

test("heatmap: matrix cells, legend, tap and choose", async () => {
  const session = await start("heatmap", examples.heatmap)
  expect(canvases(session.view)[0].height).toBe(278)
  const commands = await drawn(session)
  expect(commands.filter((command) => command[0] === "rrect")).toHaveLength(56 + 6)
  expect(commands.some((command) => command[0] === "text" && command[3] === "25")).toBe(true)
  // Thursday is row 3 and "12" is column 4: cells are 70 × 32 px from (31.8, 20).
  await tap(session, 347, 132)
  expect(session.state).toMatchObject({ selected: 28 })
  expect(texts(session.view)).toContain("Thu × 12: 25")
  expect(await choose(session)).toEqual({ row: "Thu", column: "12", value: 25 })
})

test("heatmap: calendar weeks from Monday, diverging scale, choose a day", async () => {
  const days = Array.from({ length: 21 }, (_, i) => ({
    date: `2026-03-${String(i + 1).padStart(2, "0")}`,
    value: i - 10,
  }))
  const session = await start("heatmap", { title: "Balance", layout: "calendar", choose: true, days })
  const state = session.state as { cells: { column: number; row: number; value: number | null }[] }
  // 2026-03-01 is a Sunday: the grid starts on Monday Feb 23, so the first six cells are empty.
  expect(state.cells.slice(0, 7).map((cell) => cell.value)).toEqual([null, null, null, null, null, null, -10])
  expect(state.cells.at(-1)).toMatchObject({ column: 3, row: 5, value: 10 })
  const commands = await drawn(session)
  expect(commands.some((command) => command[0] === "text" && command[3] === "Mar")).toBe(true)
  const fills = new Set(
    commands.flatMap((command) =>
      command[0] === "rrect" && typeof command[6].fill === "string" ? [command[6].fill] : [],
    ),
  )
  expect(fills).toContain("#3b82f6")
  expect(fills).toContain("#ef4444")
  // Cells are 14 px squares from (34, 20): Sunday March 1 is column 0, row 6.
  await tap(session, 34 + 7, 20 + 6 * 14 + 7)
  expect(await choose(session)).toEqual({ date: "2026-03-01", value: -10 })
})

test("treemap: drill into a block, select, back, choose", async () => {
  const session = await start("treemap", examples.treemap)
  const core = label(await drawn(session), "core")
  await tap(session, core.x + 4, core.y)
  expect(session.state).toEqual({ path: [0], selected: 0 })
  expect(texts(session.view)).toContain("repo › packages")
  expect(texts(session.view)).toContain("core: 42 MB (35.6% of packages)")
  expect(await choose(session)).toEqual({ label: "core", value: 42, path: ["packages", "core"] })
  await press(session, "Back")
  expect(session.state).toEqual({ path: [], selected: 0 })
  const docs = label(await drawn(session), "docs")
  await tap(session, docs.x + 4, docs.y)
  expect(session.state).toEqual({ path: [], selected: 2 })
  expect(await choose(session)).toEqual({ label: "docs", value: 18, path: ["docs"] })
})

test("sankey: layout in init, tap a node to trace its flows, choose", async () => {
  const session = await start("sankey", examples.sankey)
  const state = session.state as { columns: number; nodes: { column: number; value: number }[] }
  expect(state.columns).toBe(4)
  expect(state.nodes.map((node) => node.column)).toEqual([0, 0, 0, 1, 2, 3, 3])
  const landing = label(await drawn(session), "Landing")
  await tap(session, landing.x - 11, landing.y - 4)
  expect(session.state).toMatchObject({ selected: { kind: "node", index: 3 } })
  expect(await choose(session)).toEqual({ kind: "node", id: "landing", label: "Landing", value: 95 })
  // Every flow through Landing is lit (all but Search → Pricing).
  const commands = await drawn(session)
  const lit = commands.findIndex((command) => command[0] === "alpha" && command[1] === 0.75)
  const end = commands.findIndex((command, index) => index > lit && command[0] === "restore")
  expect(commands.slice(lit, end).filter((command) => command[0] === "path")).toHaveLength(7)
  await expect(
    start("sankey", { title: "x", nodes: [{ id: "a" }, { id: "b" }], links: [{ source: "a", target: "c", value: 1 }] }),
  ).rejects.toBeInstanceOf(StepError)
})

test("graph: settles from snapshots, tap a node for its neighbors, choose", async () => {
  const session = await start("graph", examples.graph)
  const circles = (commands: ReadonlyArray<Command>) => commands.filter((command) => command[0] === "circle")
  const canvas = canvases(session.view)[0]
  const first = circles((await session.draw(frame(canvas, 0))).commands).slice(0, 3)
  const last = circles(await drawn(session)).slice(0, 3)
  expect(first).not.toEqual(last)
  const gateway = label(await drawn(session), "gateway")
  // The label sits 12 px under a node of radius 5 + 1.6 √6.
  await tap(session, gateway.x, gateway.y - 12 - (5 + 1.6 * Math.sqrt(6)))
  expect(session.state).toMatchObject({ selected: 2 })
  expect(texts(session.view)).toContain("gateway (edge) · 6 neighbors: web, mobile, auth, users, orders, search")
  expect(await choose(session)).toEqual({
    id: "gateway",
    label: "gateway",
    neighbors: ["web", "mobile", "auth", "users", "orders", "search"],
  })
  // Same data, same layout.
  expect((await start("graph", examples.graph)).state).toEqual(
    session.state === null ? null : { ...(session.state as object), selected: null },
  )
})

test("tree: collapse and expand with the knob, select, choose", async () => {
  const session = await start("tree", examples.tree)
  expect(canvases(session.view)[0].height).toBe(3 * 70 + 8)
  // Six leaves of 97.3 px: Grace's knob is under her box at (154, 116).
  await tap(session, 154, 116)
  expect(session.state).toEqual({ collapsed: ["0"], selected: null })
  const barbara = label(await drawn(session), "Barbara")
  await tap(session, barbara.x, barbara.y)
  expect(session.state).toEqual({ collapsed: ["0"], selected: "1" })
  // Tapping the selected node again collapses it; now only two levels show.
  await tap(session, barbara.x, barbara.y)
  expect(session.state).toEqual({ collapsed: ["0", "1"], selected: "1" })
  expect(canvases(session.view)[0].height).toBe(2 * 70 + 8)
  expect(await choose(session)).toEqual({ label: "Barbara", path: ["Ada", "Barbara"], note: "COO" })
  const right = await start("tree", { ...examples.tree, orientation: "right", expand: 1 })
  // One level open: the root's children show, collapsed.
  expect(right.state).toEqual({ collapsed: ["0", "1"], selected: null })
  expect(canvases(right.view)[0].height).toBe(3 * 36 + 8)
})

test("timeline: rows with group headers, tap a bar, choose", async () => {
  const session = await start("timeline", examples.timeline)
  expect(canvases(session.view)[0].height).toBe(26 + 10 * 26 + 6)
  const commands = await drawn(session)
  expect(commands.some((command) => command[0] === "text" && command[3] === "Today")).toBe(true)
  expect(commands.some((command) => command[0] === "text" && command[3] === "May 4")).toBe(true)
  await tap(session, 400, 26 + 2 * 26 + 13)
  expect(session.state).toMatchObject({ selected: 1 })
  expect(texts(session.view)).toContain("Wireframes · Apr 8 – Apr 21 (14 days) · 80% done · Design")
  expect(await choose(session)).toEqual({
    label: "Wireframes",
    index: 1,
    start: "2026-04-08",
    end: "2026-04-21",
    group: "Design",
  })
  await tap(session, 400, 26 + 13)
  expect(session.state).toMatchObject({ selected: null })
  const numbers = await start("timeline", {
    title: "Sprints",
    tasks: [
      { label: "A", start: 1, end: 3 },
      { label: "B", start: 2, end: 6 },
    ],
  })
  expect((await drawn(numbers)).some((command) => command[0] === "text" && command[3] === "2")).toBe(true)
})

test("funnel: tap a stage, conversion rates, choose", async () => {
  const session = await start("funnel", examples.funnel)
  await tap(session, 300, 2 + 2 * 44 + 20)
  expect(texts(session.view)).toContain("Checkout: 2,300 · 56.1% of Added to cart, 18.5% of Visited · drop-off 1,800")
  expect(await choose(session)).toEqual({ label: "Checkout", index: 2, value: 2300, ofFirst: 0.185, ofPrevious: 0.561 })
})

test("radar: tap an axis, legend hides a series, choose", async () => {
  const session = await start("radar", examples.radar)
  // Center (339.5, 150), radius 120; Cost is the third axis, 30° below 3 o'clock.
  await tap(session, 426, 200)
  expect(session.state).toEqual({ selected: 2, hidden: [] })
  expect(texts(session.view)).toContain("Cost: Model A 6, Model B 4")
  expect(await choose(session)).toEqual({ axis: "Cost", index: 2, values: { "Model A": 6, "Model B": 4 } })
  await tap(session, 20, 34)
  expect(session.state).toEqual({ selected: 2, hidden: [1] })
  expect((await drawn(session)).filter((command) => command[0] === "path" && command[2].width === 2)).toHaveLength(1)
})

test("gauge: value arcs take their band's tone, tap a gauge, choose", async () => {
  const session = await start("gauge", examples.gauge)
  const tones = (await drawn(session)).flatMap((command) =>
    command[0] === "path" && command[2].width === 10 && command[2].cap ? [command[2].stroke] : [],
  )
  expect(tones).toEqual(["border", "warning", "border", "success", "border", "success"])
  await tap(session, 300, 100)
  expect(texts(session.view)).toContain("p99 latency: 340 ms of 0–1000 · success band (0–500) · target 500 ms")
  expect(await choose(session)).toEqual({ label: "p99 latency", index: 1, value: 340, tone: "success" })
})

test("boxplot: quartiles from values or stats, tap a box, choose", async () => {
  const session = await start("boxplot", examples.boxplot)
  await tap(session, 382, 100)
  expect(texts(session.view)).toContain("windows: median 90s, IQR 86–97.5s, whiskers 80–101s, n = 11, 1 outlier")
  expect(await choose(session)).toEqual({
    label: "windows",
    index: 2,
    n: 11,
    min: 80,
    q1: 86,
    median: 90,
    q3: 97.5,
    max: 101,
    mean: 94.727273,
  })
  expect((session.state as { stats: object[] }).stats[3]).toEqual({
    min: 12,
    q1: 15,
    median: 17,
    q3: 20,
    max: 26,
    outliers: [41],
  })
  expect(validateData(widgetTemplate("boxplot").data, { title: "x", groups: [{ label: "a" }] })).not.toEqual([])
})

test("flowchart: layered layout with a cycle, tap a step, choose", async () => {
  const session = await start("flowchart", examples.flowchart)
  const state = session.state as { layers: number; nodes: { layer: number }[] }
  expect(state.layers).toBe(7)
  expect(state.nodes.map((node) => node.layer)).toEqual([0, 1, 2, 5, 3, 4, 5, 6])
  expect(canvases(session.view)[0].height).toBe(7 * 84 - 20)
  const commands = await drawn(session)
  expect(
    commands.filter((command) => command[0] === "text" && ["yes", "no", "retry"].includes(command[3])),
  ).toHaveLength(5)
  const step = label(commands, "Tests pass?")
  await tap(session, step.x, step.y - 4)
  expect(texts(session.view)).toContain(
    "Tests pass? · next: Deploy to staging (yes), Notify author (no) · from: Build and test",
  )
  expect(await choose(session)).toEqual({ id: "ok", label: "Tests pass?" })
  const loop = await start("flowchart", {
    title: "Loop",
    nodes: [{ id: "a" }, { id: "b" }],
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "a" },
      { from: "b", to: "b" },
    ],
  })
  expect((loop.state as { layers: number }).layers).toBe(2)
  expect((await drawn(loop)).length).toBeGreaterThan(0)
})

test("sequence: messages in rows, tap one, choose; unknown participants fail", async () => {
  const session = await start("sequence", examples.sequence)
  const commands = await drawn(session)
  expect(commands.some((command) => command[0] === "text" && command[3] === "1. POST /login")).toBe(true)
  await tap(session, 300, 34 + 14 + 4 * 36 + 10)
  expect(texts(session.view)).toContain("5. Auth → Auth: check hash")
  expect(await choose(session)).toEqual({ index: 4, from: "Auth", to: "Auth", label: "check hash" })
  await expect(
    start("sequence", { title: "x", participants: ["A"], messages: [{ from: "A", to: "B", label: "hi" }] }),
  ).rejects.toBeInstanceOf(StepError)
})

test("table: aligned monospace rows, sort, sparklines, select a row, choose", async () => {
  const session = await start("table", examples.table)
  const rows = () =>
    texts(session.view).filter((text) => text.startsWith("GET") || text.startsWith("POST") || text.startsWith("PUT"))
  expect(rows()).toEqual([
    "GET /users     182,400  120 ms   0.12%",
    "POST /orders    64,200  340 ms   1.40%",
    "GET /search    120,900  210 ms   0.30%",
    "PUT /profile     8,800   95 ms   0.05%",
  ])
  await press(session, "Requests")
  expect(rows().map((row) => row.split("  ")[0].trim())).toEqual([
    "GET /users",
    "GET /search",
    "POST /orders",
    "PUT /profile",
  ])
  expect(button(session.view, "Requests")).toMatchObject({ label: "Requests ↓", variant: "primary" })
  await press(session, "Requests")
  expect(rows()[0].startsWith("PUT /profile")).toBe(true)
  await press(session, "Endpoint")
  expect(rows()[0].startsWith("GET /search")).toBe(true)
  // Rows are keyed by their index in the data, so sorting keeps each row's (and its sparkline's) id.
  expect(canvases(session.view).map((canvas) => canvas.id)).toEqual([
    "0/:2/0/:spark2",
    "0/:0/0/:spark0",
    "0/:1/0/:spark1",
    "0/:3/0/:spark3",
  ])
  const spark = canvases(session.view)[1]
  expect(spark).toMatchObject({ width: 96, height: 22, alt: "7d requests: 20, 22, 25, 24, 27, 30, 34" })
  const first = (await session.draw(frame(spark, 0))).commands
  const end = (await session.draw(frame(spark, 1))).commands
  const line = (commands: ReadonlyArray<Command>) =>
    commands.find((command) => command[0] === "path" && command[2].width === 1.5)
  expect(line(first)?.[1]).toHaveLength(1)
  expect(line(end)?.[1]).toHaveLength(7)
  expect(end.filter((command) => command[0] === "circle")).toHaveLength(1)
  const row = nodes(session.view).find((node) => node.type === "card" && node.id?.endsWith("/:2"))
  await session.dispatch({ id: row?.type === "card" ? (row.id ?? "") : "", type: "press" })
  expect(button(session.view, "Choose")).toMatchObject({ label: "Choose GET /search", disabled: false })
  expect(await choose(session)).toEqual({
    index: 2,
    row: { Endpoint: "GET /search", Requests: 120900, p95: 210, Errors: 0.3 },
  })
})

test("table: a large table builds in linear time and lines up exactly", async () => {
  // Past the 50-row schema cap on purpose: clients may run old or hand-written data, and a view that rescans every row
  // per row (as `line` once did) blows the step and slice budgets there.
  const rows = 300
  const data = {
    title: "Big",
    columns: [{ label: "Name" }, { label: "Count" }],
    rows: Array.from({ length: rows }, (_, index) => ({
      cells: ["item " + index, index * 7],
      trend: [1, 2, index % 4],
    })),
  }
  const source = program(widgetTemplate("table").source)
  const times: number[] = []
  let view: Node | undefined
  for (let run = 0; run < 3; run++) {
    const started = performance.now()
    view = (await step(source, { phase: "init", data }, { timeoutMs: 5000 })).view
    times.push(performance.now() - started)
  }
  // About 50 ms on a laptop; the quadratic version took over twice that, and 800 rows hit the 250 ms step timeout.
  expect(times.toSorted((a, b) => a - b)[1]).toBeLessThan(200)
  const lines = texts(view!).filter((text) => text.startsWith("item "))
  expect(lines).toHaveLength(rows)
  // Names pad right and counts left, to the widest cell of each column.
  const count = (index: number) => String(index * 7).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  expect(lines.slice(0, 2)).toEqual(["item 0    " + "0".padStart(5), "item 1    " + "7".padStart(5)])
  expect(lines.at(-1)).toBe("item 299  " + count(299).padStart(5))
  expect(canvases(view!)).toHaveLength(rows)
})

test("in full screen, diagrams with content in the top-right corner lay out below the close button", async () => {
  for (const name of ["heatmap", "treemap", "timeline", "sequence", "sankey"] as const) {
    const plain = await start(name, examples[name])
    const covered = await start(name, examples[name])
    const canvas = canvases(plain.view)[0]!
    const height = canvas.height
    // The close button reaches 14 px into the canvas at its right end.
    const close = { x: WIDTH - 52, y: -30, width: 44, height: 44 }
    const without = (await plain.draw(frame(canvas, 10))).commands
    const below = (await covered.draw({ ...frame(canvas, 10), height: height + 14, close })).commands
    expect([name, below]).toEqual([name, [["translate", 0, 14], ...without]])
    // Taps agree with the drawing: the same point, 14 px lower, picks the same thing.
    const at = { x: WIDTH / 2, y: height / 2, width: WIDTH, height }
    for (const kind of ["down", "up"] as const) {
      await plain.dispatch({ id: canvas.id!, type: "pointer", value: { kind, ...at } })
      await covered.dispatch({
        id: canvas.id!,
        type: "pointer",
        value: { kind, ...at, y: at.y + 14, height: height + 14, close },
      })
    }
    expect([name, covered.state]).toEqual([name, plain.state])
  }
})

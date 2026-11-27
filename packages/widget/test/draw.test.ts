import { expect, test } from "bun:test"
import { draw, type Frame, MAX_COMMANDS, program, step, WidgetSession } from "../src/index.js"
import { STEP } from "./limits.js"

const frame: Frame = { id: "0/:c", t: 0.5, dt: 1 / 60, width: 200, height: 100, scale: 2, pointer: null, dark: true }

const drawn = (body: string) =>
  draw(
    program(
      `function view() { return ui.canvas({ key: "c", height: 100 }) }\nfunction draw(state, data, frame) {${body}}`,
    ),
    {
      data: null,
      state: {},
      frame,
    },
    STEP,
  )

const failure = (body: string) => drawn(body).catch((error: unknown) => error)

test("the canvas builder builds 2D and GPU canvases", async () => {
  const output = await step(
    program(`
      function view() {
        return ui.column([
          ui.canvas({ key: "c", height: 120, width: 300, fps: 30, duration: 0.6, alt: "A chart" }),
          ui.canvas({ wgsl: "fn shade(frag: vec2f) -> vec4f { return vec4f(1.0); }", height: 80, values: [1, 2], poster: "p.png", alt: "Glow" }),
          ui.canvas({ height: 40, type: "image" }),
        ])
      }
    `),
    { phase: "init", data: null },
  )
  expect(output.view).toEqual({
    type: "column",
    children: [
      { type: "canvas", id: "0/:c", height: 120, width: 300, fps: 30, duration: 0.6, alt: "A chart" },
      {
        type: "canvas",
        wgsl: "fn shade(frag: vec2f) -> vec4f { return vec4f(1.0); }",
        height: 80,
        values: [1, 2],
        poster: "p.png",
        alt: "Glow",
      },
      { type: "canvas", height: 40 },
    ],
  })
})

test("canvas nodes are validated", async () => {
  const invalid = (node: string) =>
    step(program(`function view() { return ${node} }`), { phase: "init", data: null }).catch((error: unknown) => error)
  expect(await invalid(`ui.canvas({})`)).toMatchObject({ kind: "invalid" })
  expect(await invalid(`ui.canvas({ height: 10, fps: 120 })`)).toMatchObject({ kind: "invalid" })
  expect(await invalid(`ui.canvas({ wgsl: "x", height: 10, values: Array(17).fill(0) })`)).toMatchObject({
    kind: "invalid",
  })
  expect(await invalid(`ui.canvas({ wgsl: "é".repeat(8193), height: 10 })`)).toMatchObject({
    kind: "invalid",
    message: expect.stringContaining("16 KB"),
  })
  expect(await invalid(`ui.canvas({ wgsl: "x".repeat(16384), height: 10 })`)).toMatchObject({
    view: { type: "canvas" },
  })
  // A canvas draws with commands or with WGSL, never both: `values` belong to a GPU canvas.
  expect(await invalid(`ui.canvas({ height: 10, values: [1] })`)).toMatchObject({
    kind: "invalid",
    message: expect.stringContaining("`values` need `wgsl`"),
  })
})

test("the draw builder emits the spec's compact commands", async () => {
  const output = await drawn(`
    const g = ui.draw()
    g.save().translate(1, 2).rotate(0.5).scale(2).scale(1, 3).alpha(0.5)
    g.rect(0, 0, 10, 10, "accent").rrect(0, 0, 10, 10, 3, { fill: { linear: [0, 0, 1, 1], stops: [[0, "#fff"], [1, "accent"]] } })
    g.circle(5, 5, 2).circle(5, 5, 2, { fill: { radial: [5, 5, 2], stops: [[0, "#ff000080"], [1, "bg"]] }, stroke: "border", width: 1 })
    g.line(0, 0, 1, 1).line(0, 0, 1, 1, "border").line(0, 0, 1, 1, { stroke: "#123456", width: 2, cap: "round" })
    g.path([["M", 0, 0], ["L", 1, 1], ["Q", 1, 2, 3, 4], ["C", 1, 2, 3, 4, 5, 6], ["Z"]], { stroke: "error" })
    g.text(1, 2, 42).text(1, 2, "hi", { size: 12, weight: 600, align: "center", color: "muted", mono: true })
    g.image("a.png", 0, 0, 4, 4).restore()
    return g.commands
  `)
  expect(output.commands).toEqual([
    ["save"],
    ["translate", 1, 2],
    ["rotate", 0.5],
    ["scale", 2, 2],
    ["scale", 1, 3],
    ["alpha", 0.5],
    ["rect", 0, 0, 10, 10, { fill: "accent" }],
    [
      "rrect",
      0,
      0,
      10,
      10,
      3,
      {
        fill: {
          linear: [0, 0, 1, 1],
          stops: [
            [0, "#fff"],
            [1, "accent"],
          ],
        },
      },
    ],
    ["circle", 5, 5, 2, { fill: "text" }],
    [
      "circle",
      5,
      5,
      2,
      {
        fill: {
          radial: [5, 5, 2],
          stops: [
            [0, "#ff000080"],
            [1, "bg"],
          ],
        },
        stroke: "border",
        width: 1,
      },
    ],
    ["line", 0, 0, 1, 1, { stroke: "text" }],
    ["line", 0, 0, 1, 1, { stroke: "border" }],
    ["line", 0, 0, 1, 1, { stroke: "#123456", width: 2, cap: "round" }],
    ["path", [["M", 0, 0], ["L", 1, 1], ["Q", 1, 2, 3, 4], ["C", 1, 2, 3, 4, 5, 6], ["Z"]], { stroke: "error" }],
    ["text", 1, 2, "42", {}],
    ["text", 1, 2, "hi", { size: 12, weight: 600, align: "center", color: "muted", mono: true }],
    ["image", "a.png", 0, 0, 4, 4],
    ["restore"],
  ])
})

test("draw gets state, data and frame; it may return the builder; no draw draws nothing", async () => {
  const source = program(`
    function view() { return ui.canvas({ key: "c", height: 100 }) }
    function draw(state, data, frame) {
      return ui.draw().text(0, 0, [state.n, data.label, frame.key, frame.t, frame.width, frame.dark].join(" "))
    }
  `)
  expect(await draw(source, { data: { label: "x" }, state: { n: 3 }, frame })).toEqual({
    commands: [["text", 0, 0, "3 x c 0.5 200 true", {}]],
  })
  expect(await draw(program(`function view() { return ui.text("a") }`), { data: null, state: {}, frame })).toEqual({
    commands: [],
  })
  expect((await drawn(`return undefined`)).commands).toEqual([])
})

test("invalid draw output is rejected, with the message every host gives", async () => {
  const invalid = (message: string) => ({ kind: "invalid", message })
  expect(await failure(`return ui.draw().rect(0, 0, 1, 1, "red")`)).toMatchObject(
    invalid("draw command 0: not a color"),
  )
  expect(await failure(`return ui.draw().rect(0, 0, 1, 1, "#12345")`)).toMatchObject(
    invalid("draw command 0: not a color"),
  )
  expect(await failure(`return ui.draw().save().rect(0, 0, "1", 1)`)).toMatchObject(
    invalid(`draw command 1: "rect" argument 3 must be a finite number`),
  )
  expect(await failure(`return ui.draw().path([["A", 1]])`)).toMatchObject(
    invalid("draw command 0: unknown path segment"),
  )
  expect(await failure(`return ui.draw().text(0, 0, "x", { weight: 450 })`)).toMatchObject(
    invalid("draw command 0: a text weight must be 400, 500, 600 or 700"),
  )
  expect(await failure(`return [["sparkle"]]`)).toMatchObject(invalid(`draw command 0: unknown draw command "sparkle"`))
  expect(await failure(`return "rect"`)).toMatchObject(invalid("draw commands must be a list"))
  // Clamped, not invalid.
  expect((await drawn(`return ui.draw().alpha(2)`)).commands).toEqual([["alpha", 1]])
  expect(await failure(`throw new Error("no")`)).toMatchObject({ kind: "error", message: "Error: no" })
  const cap = `const g = ui.draw(); for (let i = 0; i < N; i++) g.save(); return g`
  expect((await drawn(cap.replace("N", String(MAX_COMMANDS)))).commands).toHaveLength(MAX_COMMANDS)
  expect(await failure(cap.replace("N", String(MAX_COMMANDS + 1)))).toMatchObject({
    kind: "invalid",
    message: `${MAX_COMMANDS + 1} draw commands is over the budget of ${MAX_COMMANDS} per frame`,
  })
})

test("a session draws with its current state and draw never changes it", async () => {
  const session = await WidgetSession.start(
    program(`
      function init() { return { x: 0 } }
      function view(state) {
        return ui.canvas({
          key: "c",
          height: 100,
          fps: state.down ? 60 : 0,
          onPointer: (state, p) => ({ x: p.x / p.width, down: p.kind !== "up" }),
        })
      }
      function draw(state, data, frame) {
        state.x = 99
        if (frame.key !== "c" || "id" in frame) throw new Error("draw gets the canvas key, not its id")
        return ui.draw().circle(state.x * frame.width, 50, 4)
      }
    `),
    null,
  )
  await session.dispatch({ id: ":c", type: "pointer", value: { kind: "down", x: 50, y: 10, width: 200, height: 100 } })
  expect(session.view).toEqual({ type: "canvas", id: ":c", height: 100, fps: 60, pointer: true })
  expect((await session.draw({ ...frame, id: ":c" })).commands).toEqual([["circle", 19800, 50, 4, { fill: "text" }]])
  expect(session.state).toEqual({ x: 0.25, down: true })
})

test("a stack layers its children, each placed with place and inset", async () => {
  const output = await step(
    program(`
      function view() {
        return ui.stack([
          ui.canvas({ key: "game", height: 200, place: "fill", onPointer: (state) => state }),
          ui.text("Score 3", { place: "top-left", inset: 8 }),
          ui.button("Pause", { place: "bottom-right", inset: { right: 12, bottom: 12 }, onPress: (state) => state }),
        ])
      }
    `),
    { phase: "init", data: null },
  )
  expect(output.view).toEqual({
    type: "stack",
    children: [
      { type: "canvas", id: "0/:game", height: 200, place: "fill", pointer: true },
      { type: "text", text: "Score 3", place: "top-left", inset: 8 },
      { type: "button", id: "0/2", label: "Pause", place: "bottom-right", inset: { right: 12, bottom: 12 } },
    ],
  })
  const invalid = (node: string) =>
    step(program(`function view() { return ${node} }`), { phase: "init", data: null }).catch((error: unknown) => error)
  expect(await invalid(`ui.stack([ui.text("x", { place: "middle" })])`)).toMatchObject({ kind: "invalid" })
  expect(await invalid(`ui.stack([ui.text("x", { inset: -1 })])`)).toMatchObject({ kind: "invalid" })
  expect(await invalid(`ui.stack([ui.text("x", { inset: { top: "4" } })])`)).toMatchObject({ kind: "invalid" })
})

test("only a canvas with onPointer takes input: the prelude marks it pointer: true", async () => {
  const output = await step(
    program(`
      function view() {
        return ui.stack([
          ui.canvas({ key: "scene", height: 100 }),
          ui.canvas({ height: 100, onPointer: (state) => state }),
          ui.canvas({ height: 100, pointer: true }),
        ])
      }
    `),
    { phase: "init", data: null },
  )
  expect(output.view.type === "stack" && output.view.children).toEqual([
    // A key gives an id for live widget.draw, not input; an author can't set pointer itself.
    { type: "canvas", id: "0/:scene", height: 100 },
    { type: "canvas", id: "0/1", height: 100, pointer: true },
    { type: "canvas", height: 100 },
  ])
})

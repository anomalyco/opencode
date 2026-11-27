import { expect, test } from "bun:test"
import { MAX_VALUE_DEPTH } from "../src/host.js"
import { Schema } from "effect"
import { Host, Runtime } from "psychoscript"
import { checkDraw, draw, LiveWidget, type LiveMessage, Node, program, step, StepOutput } from "../src/index.js"
import { prune } from "../src/session.js"
import { fixtures, scriptedProgram } from "../script/conformance.js"
import { LIVE, STEP } from "./limits.js"

// The TypeScript runtime is a native host (specs/v2/widgets.md, Native hosts). These hold its steps and live runs to
// the last prelude that built trees itself (`scriptedProgram`, protocol 1's entries, with an id → handler table): the
// same outputs, events and posts, functions where none may go included.

// A step with the prelude building the tree, read as `step` reads one.
const scripted = async (source: string, input: unknown) => {
  const result = await Runtime.make({
    typedArrays: true,
    limits: { ...STEP, maxValueDepth: MAX_VALUE_DEPTH },
  }).execute(scriptedProgram(source) + `\nreturn __widget_step(${JSON.stringify(input)})`)
  if (!result.ok) return { error: result.error.message }
  const value = result.value as Record<string, unknown>
  const warnings: string[] = []
  const output = Schema.decodeUnknownSync(StepOutput)({ ...value, view: prune(value.view, warnings) })
  return warnings.length === 0 ? output : { ...output, warnings }
}

const native = (source: string, input: unknown) =>
  step(program(source), input as Parameters<typeof step>[1], STEP).then(
    (output) => output,
    (error: Error) => ({ error: error.message }),
  )

const ids = (node: unknown): string[] =>
  !node || typeof node !== "object"
    ? []
    : Array.isArray(node)
      ? node.flatMap(ids)
      : [
          ...("id" in node && typeof node.id === "string" ? [node.id] : []),
          ...ids((node as { children?: unknown }).children),
        ]

test("a native step takes every event as the prelude's own table does", async () => {
  const source = `function view(state) {
  return ui.column([
    ui.text("hit " + (state.hit ?? "")),
    ui.button("a", { key: "k", onPress: () => ({ hit: "a" }) }),
    ui.button("b", { key: "k", onPress: () => ({ hit: "b" }) }),
    ui.button("c", { key: "k~2", onPress: () => ({ hit: "c" }) }),
    [false, ui.slider({ value: 1, min: 0, max: 10, onChange: (state, value) => ({ hit: "slider " + value }) })],
    ui.carousel({ onChange: (state, index) => ({ hit: "page " + index }) }, [[ui.text("p"), ui.text("q")]]),
    ui.select(["x", "y"], { onChange: (state, value) => ({ hit: "select " + value }) }),
    ui.canvas({ key: "c", height: 1, onPointer: (state, p) => ({ hit: "pointer " + p.kind }) }),
    ui.card({ key: "c", onPress: () => send("card", { state: { hit: "card" } }) }, [ui.button("done", { onPress: () => submit("bye") })]),
    ui.button("throws", { onPress: () => { throw new Error("boom") } }),
  ])
}`
  const init = await scripted(source, { phase: "init", data: null })
  expect(await native(source, { phase: "init", data: null })).toEqual(init)
  const events = [...ids("view" in init ? init.view : undefined), "0/:k~3", "0/9", "", "x"].flatMap((id) =>
    [
      { type: "press" },
      { type: "change", value: 1 },
      { type: "change", value: 12 },
      { type: "change", value: "y" },
      { type: "pointer", value: { kind: "down", x: 1, y: 1, width: 2, height: 2 } },
    ].map((event) => ({ id, ...event })),
  )
  expect(events.length).toBeGreaterThan(50)
  for (const event of events) {
    const input = { phase: "event", data: null, state: { hit: "none" }, event }
    expect({ event, output: await native(source, input) }).toEqual({ event, output: await scripted(source, input) })
  }
}, 60_000)

test("a native step leaves functions out of the result as JSON does, and fails on one in the view", async () => {
  const source = `function init() {
  return { f: () => 1, list: [1, () => 2], nested: { g: () => 3, n: 4 } }
}
function view(state) {
  return ui.column([ui.text("t", state.bad ? { extra: { f: () => 1 } } : {}), ui.button("b", { onPress: () => send({ f: () => 1, v: 1 }) })])
}`
  const init = await native(source, { phase: "init", data: null })
  expect(init).toEqual(await scripted(source, { phase: "init", data: null }))
  expect(init).toMatchObject({ state: { list: [1, null], nested: { n: 4 } } })
  const input = { phase: "event", data: null, state: { n: 1 }, event: { id: "0/1", type: "press" } }
  const pressed = await native(source, input)
  expect(pressed).toMatchObject({ send: { value: { v: 1 } } })
  expect(pressed).toEqual(await scripted(source, input))
  // The view is a host call's argument: a function anywhere but a handler prop fails the call, where the call is.
  expect(
    await native(source, { phase: "event", data: null, state: { bad: true }, event: { id: "x", type: "press" } }),
  ).toEqual({
    error: expect.stringMatching(
      /^TypeError: Argument 1 to __widget_emit contains a function, which cannot be passed to the host\. \(line \d+, col \d+\)$/,
    ),
  })
})

test("a view with a key of another type, or deeper than 100 levels, fails in phase view in both modes", async () => {
  const cases = [
    [`ui.column([ui.text("t", { key: { a: 1 } })])`, "A node's key must be a string, a number or a boolean"],
    [`ui.column({ key: [1] }, [])`, "A node's key must be a string, a number or a boolean"],
    [
      `(() => { let node = ui.text("x"); for (let i = 1; i < 101; i++) node = ui.column([node]); return node })()`,
      "The view nests more than 100 levels",
    ],
  ] as const
  for (const [expression, message] of cases) {
    const source = `function view() {\n  return ${expression}\n}`
    const failed = await step(program(source), { phase: "init", data: null }, STEP).catch((error: unknown) => error)
    expect(failed).toMatchObject({ _tag: "Widget.StepError", kind: "invalid", phase: "view", message })
    expect(await scripted(source, { phase: "init", data: null })).toEqual({ error: expect.stringContaining(message) })
  }
  // 100 levels is the most, with the deepest prop a node has; 150 can't even cross the boundary, and the prelude
  // reports it as too deep.
  for (const [levels, failure] of [
    [100, undefined],
    [150, "The view nests more than 100 levels"],
  ] as const) {
    const source = `function view() {\n  let node = ui.select([{ value: "a", label: "A", description: "d" }])\n  for (let i = 1; i < ${levels}; i++) node = ui.column([node])\n  return node\n}`
    const output = await step(program(source), { phase: "init", data: null }, STEP).catch((error: unknown) => error)
    if (failure) expect(output).toMatchObject({ kind: "invalid", phase: "view", message: failure })
    else expect(output).toEqual(await scripted(source, { phase: "init", data: null }))
  }
})

// A live run with the prelude building trees, on a host that takes posts as they are, read as `LiveWidget` reads
// them. Its inbox holds `events`; once they are taken, `receive` never resolves, so a run that keeps waiting times out.
const scriptedLive = async (source: string, events: ReadonlyArray<unknown>) => {
  const messages: unknown[] = []
  const inbox = events.map((event) => ({ type: "event", event }))
  const read = (message: Record<string, unknown>): unknown => {
    if (message.type === "render")
      return { type: "render", node: Schema.decodeUnknownSync(Node)(prune(message.node, [])) }
    if (message.type === "draw")
      return {
        type: "draw",
        id: message.id,
        commands: (checkDraw(message.commands) as { commands: unknown }).commands,
      }
    if (message.type === "send") return { type: "send", value: message.value ?? null, wake: message.wake !== false }
    return message
  }
  const result = await Runtime.make({
    typedArrays: true,
    limits: { ...STEP, maxValueDepth: MAX_VALUE_DEPTH },
    globals: () => ({
      __input: Host.fn(() => ({ data: null })),
      __host: {
        post: Host.fn(([message]) => void messages.push(read(message as Record<string, unknown>))),
        receive: Host.fn(() => (inbox.length > 0 ? Promise.resolve(inbox.shift()) : new Promise(() => {})), {
          type: "async",
        }),
      },
    }),
  }).execute(scriptedProgram(source) + "\nreturn await __widget_live(__input())")
  return { messages, ended: result.ok ? "return" : result.error.message }
}

const nativeLive = async (source: string, events: ReadonlyArray<unknown>) => {
  const messages: unknown[] = []
  const widget = LiveWidget.start(program(source, "live"), null, {
    ...LIVE,
    onMessage: (message: LiveMessage) => messages.push(message),
  })
  events.forEach((event) => widget.event(event as Parameters<LiveWidget["event"]>[0]))
  const end = await Promise.race([widget.done, Bun.sleep(1000).then(() => undefined)])
  await widget.stop()
  return { messages, ended: end?.type === "error" ? end.error.message : (end?.type ?? "waiting") }
}

test("a native live run renders, draws, takes events and ends as the prelude's own table does", async () => {
  const source = `async function main() {
  let count = 0
  const show = () =>
    widget.render(
      ui.stack([
        ui.canvas({ key: "scene", height: 10, onPointer: (p) => widget.send(p.kind) }),
        ui.canvas({ key: "gpu", wgsl: "fn shade(p: vec2f) -> vec4f { return vec4f(1.0); }", height: 10 }),
        ui.row({ key: "hud" }, [ui.text("n " + count), ui.button("+", { key: "plus", onPress: press })]),
      ]),
    )
  const tryTo = (run) => {
    try {
      run()
    } catch (error) {
      widget.send(error.name + ": " + error.message)
    }
  }
  const press = () => {
    count++
    widget.draw("scene", ui.draw().rect(0, 0, count, 1, "accent"))
    for (const key of ["nope", "gpu", 3]) tryTo(() => widget.draw(key, []))
    tryTo(() => widget.draw("scene", [["rect", 0, 0, 1, 1, { fill: () => 1 }]]))
    tryTo(() => widget.send({ f: () => 1 }))
    tryTo(() => widget.render(ui.text("x", { extra: [() => 1] })))
    if (count < 2) return show()
    widget.render(ui.text("done " + count))
  }
  show()
}`
  const events = [
    { id: "0/:scene", type: "pointer", value: { kind: "down", x: 1, y: 1, width: 2, height: 2 } },
    { id: "0/:hud/:plus", type: "press" },
    { id: "0/:hud/:nope", type: "press" },
    { id: "0/:hud/:plus", type: "press" },
  ]
  const expected = await scriptedLive(source, events)
  expect(expected.ended).toBe("return")
  expect(expected.messages.length).toBe(18)
  expect(await nativeLive(source, events)).toEqual(expected)
})

test("a native live run stays while its view has handlers", async () => {
  const source = `async function main() {
  widget.render(ui.button("go", { onPress: () => widget.render(ui.text("bye")) }))
}`
  expect((await nativeLive(source, [])).ended).toBe("waiting")
  expect((await nativeLive(source, [{ id: "0", type: "press" }])).ended).toBe("return")
  expect((await nativeLive(`async function main() { widget.render(ui.button("go")) }`, [])).ended).toBe("return")
})

const postLine = (() => {
  const lines = program("", "live").split("\n")
  const line = lines.findIndex((text) => text.includes("__host.post(message)"))
  return { line: line + 1, column: lines[line]!.indexOf("__host.post(message)") + 1 }
})()

test("a function posted where none may go fails a native live run at the same line and column", async () => {
  for (const post of [`widget.send({ f: () => 1 })`, `widget.render(ui.text("x", { extra: [() => 1] }))`]) {
    const source = `async function main() {\n  ${post}\n}`
    const expected = await scriptedLive(source, [])
    expect(expected.ended).toMatch(
      /^TypeError: Argument 1 to __host.post contains a function, .* \(line \d+, col \d+\)$/,
    )
    // The call is the prelude's `__host.post(message)`, which has its own line in each prelude.
    expect(await nativeLive(source, [])).toEqual({
      ...expected,
      ended: expected.ended.replace(/\(line \d+, col \d+\)$/, `(line ${postLine.line}, col ${postLine.column})`),
    })
  }
  const missing = await nativeLive(`async function main() {\n  widget.draw("nope", [])\n}`, [])
  expect(missing.ended).toMatch(/^Error: No canvas with key "nope" in the rendered view \(line \d+, col \d+\)$/)
})

test("a live render with a key of another type, or deeper than 100 levels, ends the run in phase view", async () => {
  const end = async (expression: string) => {
    const widget = LiveWidget.start(
      program(`async function main() {\n  widget.render(${expression})\n}`, "live"),
      null,
      LIVE,
    )
    const done = await widget.done
    return done.type === "error" ? done.error : done
  }
  expect(await end(`ui.column([ui.button("b", { key: {} })])`)).toMatchObject({
    kind: "invalid",
    phase: "view",
    message: "A node's key must be a string, a number or a boolean",
  })
  const nested = (levels: number) =>
    `(() => { let node = ui.select([{ value: "a", label: "A", description: "d" }]); for (let i = 1; i < ${levels}; i++) node = ui.column([node]); return node })()`
  // 101 levels crosses (the render's wrapper and the option's label take the boundary's 202 only at 100); the host's
  // walk fails it. 150 can't cross: the prelude finds it is over 100 levels and posts that instead.
  for (const levels of [101, 150])
    expect(await end(nested(levels))).toMatchObject({
      kind: "invalid",
      phase: "view",
      message: "The view nests more than 100 levels",
    })
  // 100 levels, the deepest prop a node has in its deepest node: the render's value depth is 202 exactly.
  const widget = LiveWidget.start(
    program(`async function main() {\n  widget.render(${nested(100)})\n}`, "live"),
    null,
    LIVE,
  )
  expect(await widget.done).toEqual({ type: "return" })
  let deepest: unknown = widget.view
  for (let level = 1; level < 100; level++) deepest = (deepest as { children: unknown[] }).children[0]
  expect(deepest).toEqual({
    type: "select",
    options: [{ value: "a", label: "A", description: "d" }],
    id: "0" + "/0".repeat(99),
  })
  // Deep only in a prop: the boundary's own error, where the render is.
  expect(await end(`ui.text("x", { extra: JSON.parse("[".repeat(210) + "]".repeat(210)) })`)).toMatchObject({
    kind: "error",
    message: expect.stringContaining("exceeds the maximum value depth of 202"),
  })
})

// A draw with the prelude giving its commands as the run's result, read as `draw` reads one.
const scriptedDraw = async (source: string, input: Record<string, unknown>) => {
  const result = await Runtime.make({
    typedArrays: true,
    limits: { ...STEP, maxValueDepth: MAX_VALUE_DEPTH },
  }).execute(scriptedProgram(source) + `\nreturn __widget_step(${JSON.stringify({ phase: "draw", ...input })})`)
  if (!result.ok) return { error: result.error.message }
  const checked = checkDraw(isRecord(result.value) ? result.value.commands : undefined)
  return "error" in checked ? { error: checked.error } : checked
}

const nativeDraw = (source: string, input: Parameters<typeof draw>[1]) =>
  draw(program(source), input, STEP).then(
    (output) => output,
    (error: Error) => ({ error: error.message }),
  )

test("native draw steps give the commands the run's result gave, and fail as it did", async () => {
  const frame = { id: "0/:c", t: 0.5, dt: 1 / 60, width: 300, height: 200, scale: 2, pointer: null, dark: true }
  const drawn = fixtures().filter((fixture) => fixture.builtin !== undefined && /function draw\(/.test(fixture.source))
  expect(drawn.length).toBeGreaterThan(10)
  for (const fixture of drawn) {
    const init = await step(program(fixture.source), fixture.input as Parameters<typeof step>[1], STEP)
    const input = { data: fixture.input.data, state: init.state, frame }
    expect({ name: fixture.name, output: await nativeDraw(fixture.source, input) }).toEqual({
      name: fixture.name,
      output: await scriptedDraw(fixture.source, input),
    })
  }
  // What only JSON cleans up (functions, undefined, non-finite numbers), and invalid outputs.
  const outputs = [
    `[["rect", 0, 0, 1, 1, { fill: "accent", stroke: undefined, f: () => 1 }], ["line", 0, 0, 1, 1, () => 1]]`,
    `[["rect", NaN, 0, 1, 1, { fill: "accent" }]]`,
    `[["circle", 1, 2, Infinity]]`,
    `[["rect"]]`,
    `[["sparkle", 1]]`,
    `"commands"`,
    `{ commands: [] }`,
    `undefined`,
    `ui.draw().rect(0, 0, 1, 1, "#fff").text(1, 2, "t", { size: undefined })`,
    `Array.from({ length: 2001 }, () => ["save"])`,
    `[["rect", 0, 0, 1, 1, { fill: { linear: [0, 0, 1, 1], stops: [[0, "#fff"], [1, "accent"]] } }]]`,
  ]
  for (const output of outputs) {
    const source = `function view() { return ui.canvas({ key: "c", height: 1 }) }\nfunction draw() { return ${output} }`
    const input = { data: null, state: {}, frame }
    expect({ output, drawn: await nativeDraw(source, input) }).toEqual({
      output,
      drawn: await scriptedDraw(source, input),
    })
  }
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

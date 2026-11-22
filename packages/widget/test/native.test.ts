import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Host, Runtime } from "psychoscript"
import { DrawOutput, LiveWidget, type LiveMessage, Node, program, step, StepOutput } from "../src/index.js"
import { prune } from "../src/session.js"

// The TypeScript runtime is a native host (specs/v2/widgets.md, Native hosts). These hold its steps and live runs to
// the prelude building trees itself, which a host without `translate.functions: "mark"` still gets: the same outputs,
// events and posts, functions where none may go included.

// A step with the prelude building the tree, read as `step` reads one.
const scripted = async (source: string, input: unknown) => {
  const result = await Runtime.make({ limits: { timeoutMs: 5000 } }).execute(
    program(source) + `\nreturn __widget_step(${JSON.stringify(input)})`,
  )
  if (!result.ok) return { error: result.error.message }
  const value = result.value as Record<string, unknown>
  const warnings: string[] = []
  const output = Schema.decodeUnknownSync(StepOutput)({ ...value, view: prune(value.view, warnings) })
  return warnings.length === 0 ? output : { ...output, warnings }
}

const native = (source: string, input: unknown) =>
  step(program(source), input as Parameters<typeof step>[1], { timeoutMs: 5000 }).then(
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

test("a native step leaves out functions where no handler goes, as a step output does", async () => {
  const source = `function init() {
  return { f: () => 1, list: [1, () => 2], nested: { g: () => 3, n: 4 } }
}
function view(state) {
  return ui.column({ onHover: () => 1 }, [ui.text("t", { extra: { f: () => 1, n: 1 } }), ui.button("b", { onPress: () => send({ f: () => 1, v: 1 }) })])
}`
  const init = await native(source, { phase: "init", data: null })
  expect(init).toEqual(await scripted(source, { phase: "init", data: null }))
  expect(init).toMatchObject({ state: { list: [1, null], nested: { n: 4 } } })
  const input = { phase: "event", data: null, state: { n: 1 }, event: { id: "0/1", type: "press" } }
  const pressed = await native(source, input)
  expect(pressed).toMatchObject({ send: { value: { v: 1 } } })
  expect(pressed).toEqual(await scripted(source, input))
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
        commands: Schema.decodeUnknownSync(DrawOutput)({ commands: message.commands }).commands,
      }
    if (message.type === "send") return { type: "send", value: message.value ?? null, wake: message.wake !== false }
    return message
  }
  const result = await Runtime.make({
    limits: { timeoutMs: 2000 },
    globals: () => ({
      __input: Host.fn(() => ({ data: null })),
      __host: {
        post: Host.fn(([message]) => void messages.push(read(message as Record<string, unknown>))),
        receive: Host.fn(() => (inbox.length > 0 ? Promise.resolve(inbox.shift()) : new Promise(() => {})), {
          type: "async",
        }),
      },
    }),
  }).execute(program(source) + "\nreturn await __widget_live(__input())")
  return { messages, ended: result.ok ? "return" : result.error.message }
}

const nativeLive = async (source: string, events: ReadonlyArray<unknown>) => {
  const messages: unknown[] = []
  const widget = LiveWidget.start(program(source), null, {
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

test("a function posted where none may go fails a native live run at the same line and column", async () => {
  for (const post of [`widget.send({ f: () => 1 })`, `widget.render(ui.text("x", { extra: [() => 1] }))`]) {
    const source = `async function main() {\n  ${post}\n}`
    const expected = await scriptedLive(source, [])
    expect(expected.ended).toMatch(
      /^TypeError: Argument 1 to __host.post contains a function, .* \(line \d+, col \d+\)$/,
    )
    expect(await nativeLive(source, [])).toEqual(expected)
  }
  const missing = await nativeLive(`async function main() {\n  widget.draw("nope", [])\n}`, [])
  expect(missing.ended).toMatch(/^Error: No canvas with key "nope" in the rendered view \(line \d+, col \d+\)$/)
})

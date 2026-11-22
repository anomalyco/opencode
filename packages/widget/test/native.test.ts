import { expect, test } from "bun:test"
import { Host, Runtime } from "psychoscript"
import { FUNCTION } from "../script/conformance.js"
import { program } from "../src/index.js"
import { nativeTree } from "./native-tree.js"

// Native mode (specs/v2/widgets.md, Native hosts) against the prelude's own tree building: the same steps, events and
// live posts, with `native-tree.ts` as the host. psychoscript 0.2.1 has no `translate.functions: "mark"`, so the
// program marks functions itself (`__mark`) before they cross.
const mark = `
const __mark = (value) =>
  typeof value === "function"
    ? ${JSON.stringify(FUNCTION)}
    : Array.isArray(value)
      ? value.map(__mark)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, __mark(item)]))
        : value
`

const isFunction = (value: unknown) => value === FUNCTION
const wire = (value: unknown) => JSON.stringify(value, (_, item) => (item === FUNCTION ? undefined : item))

const step = async (source: string, input: unknown, native: boolean) => {
  const result = await Runtime.make({ limits: { timeoutMs: 5000 } }).execute(
    program(source) + mark + `\nreturn JSON.stringify(__mark(__widget_step(${JSON.stringify(input)}, ${native})))`,
  )
  if (!result.ok) throw new Error(result.error.message)
  const output = JSON.parse(result.value as string)
  return native ? { ...output, view: JSON.parse(wire(nativeTree(output.view, isFunction).view)) } : output
}

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
  ])
}`
  const init = await step(source, { phase: "init", data: null }, false)
  expect(await step(source, { phase: "init", data: null }, true)).toEqual(init)
  const events = [...ids(init.view), "0/:k~3", "0/9", "", "x"].flatMap((id) =>
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
    expect({ event, output: await step(source, input, true) }).toEqual({
      event,
      output: await step(source, input, false),
    })
  }
}, 60_000)

// A live run on a host that records posts: native, it walks renders with `nativeTree`, answers whether they have
// handlers and maps draw keys to ids; otherwise it takes the prelude's posts as they are.
const live = async (source: string, events: ReadonlyArray<unknown>, native: boolean, timeoutMs = 5000) => {
  const posts: unknown[] = []
  const inbox = events.map((event) => ({ type: "event", event }))
  const canvases = { current: {} as ReturnType<typeof nativeTree>["canvases"] }
  const post = (text: string) => {
    const message = JSON.parse(text)
    if (!native) return void posts.push(message)
    if (message.type === "render") {
      const tree = nativeTree(message.node, isFunction)
      canvases.current = tree.canvases
      posts.push({ type: "render", node: JSON.parse(wire(tree.view)) })
      return Object.keys(tree.handlers).length > 0
    }
    if (message.type === "draw") {
      const canvas = canvases.current[message.key]
      if (canvas === undefined) throw new Error('No canvas with key "' + message.key + '" in the rendered view')
      if (canvas.wgsl) throw new Error('Canvas "' + message.key + '" is drawn by its wgsl; it takes no draw commands')
      return void posts.push({ type: "draw", id: canvas.id, commands: message.commands })
    }
    posts.push(message)
  }
  const result = await Runtime.make({
    limits: { timeoutMs },
    globals: () => ({
      __input: Host.fn(() => ({ data: null })),
      __test: {
        post: Host.fn(([text]) => post(text as string)),
        // Never resolves once the inbox is empty: the run then times out instead of returning.
        receive: Host.fn(() => (inbox.length > 0 ? Promise.resolve(inbox.shift()) : new Promise(() => {})), {
          type: "async",
        }),
      },
    }),
  }).execute(
    program(source) +
      mark +
      `
      const __host = { post: (message) => __test.post(JSON.stringify(__mark(message))), receive: () => __test.receive() }
      return await __widget_live(__input(), ${native})`,
  )
  return { ok: result.ok, error: result.ok ? undefined : result.error.message, posts, left: inbox.length }
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
  const press = () => {
    count++
    widget.draw("scene", ui.draw().rect(0, 0, count, 1, "red"))
    for (const key of ["nope", "gpu", 3]) {
      try {
        widget.draw(key, [])
      } catch (error) {
        widget.send(error.message)
      }
    }
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
  const expected = await live(source, events, false)
  expect(expected).toMatchObject({ ok: true, left: 0 })
  expect(expected.posts.length).toBe(12)
  expect(await live(source, events, true)).toEqual(expected)
})

test("a native live run stays while its view has handlers", async () => {
  const source = `async function main() {
  widget.render(ui.button("go", { onPress: () => widget.render(ui.text("bye")) }))
}`
  const waiting = await live(source, [], true, 500)
  expect(waiting.ok).toBe(false)
  expect(waiting.error).toContain("timed out")
  expect(await live(source, [{ id: "0", type: "press" }], true)).toMatchObject({ ok: true, left: 0 })
  expect(await live(`async function main() { widget.render(ui.button("go")) }`, [], true)).toMatchObject({ ok: true })
})

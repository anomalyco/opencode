import { expect, test } from "bun:test"
import { NEWER, type Node, OLDER, program, step, StepError, WidgetSession } from "../src/index.js"

const counter = program(`
  function init(data) { return { count: data.start } }
  function view(state, data) {
    return ui.column([
      ui.text(data.label + ": " + state.count),
      ui.button("+", { onPress: (state) => ({ count: state.count + 1 }) }),
      ui.button("Done", { onPress: (state) => submit({ total: state.count }) }),
      ui.button("Close", { onPress: () => dismiss() }),
      ui.button("Empty", { onPress: () => submit() }),
      ui.button("Ping", { onPress: (state) => send({ count: state.count }, { state: { count: state.count + 1 } }) }),
      ui.button("Quiet", { onPress: () => send(undefined, { wake: false }) }),
      ui.button("Boom", { onPress: () => { throw new Error("boom") } }),
      ui.button("Spin", { onPress: () => { while (true) {} } }),
      ui.button("Inert"),
    ])
  }
`)

const data = { start: 1, label: "Count" }
const press = (id: string) => ({ id, type: "press" as const })
const nodes = (node: Node): Node[] => [node, ...("children" in node ? node.children.flatMap(nodes) : [])]
// The id of the button labeled `label` in the counter's view: ids come from the node's place in the tree.
const button = (view: Node, label: string) => {
  const found = nodes(view).find((node) => node.type === "button" && node.label === label)
  if (!found || found.type !== "button") throw new Error(`no button ${label}`)
  return found.id
}
const first = await step(counter, { phase: "init", data })
const event = (state: unknown, label: string) =>
  step(counter, { phase: "event", data, state, event: press(button(first.view, label)) })

test("init runs init and view; the prelude assigns ids from the tree and strips handlers", async () => {
  expect(first.state).toEqual({ count: 1 })
  expect(first.view.type === "column" && first.view.children.slice(0, 3)).toEqual([
    { type: "text", text: "Count: 1" },
    { type: "button", id: "0/1", label: "+" },
    { type: "button", id: "0/2", label: "Done" },
  ])
  expect(JSON.stringify(first.view)).not.toContain("onPress")
})

test("an event runs the pressed node's handler, then view", async () => {
  const output = await event({ count: 4 }, "+")
  expect(output.state).toEqual({ count: 5 })
  expect(output.view.type === "column" && output.view.children[0]).toEqual({ type: "text", text: "Count: 5" })
  expect("submit" in output).toBe(false)
  expect("dismiss" in output).toBe(false)
})

test("submit and dismiss end the widget and keep the state", async () => {
  const done = await event({ count: 3 }, "Done")
  expect(done.submit).toEqual({ total: 3 })
  expect(done.state).toEqual({ count: 3 })
  expect((await event({ count: 3 }, "Empty")).submit).toBeNull()
  const closed = await event({ count: 3 }, "Close")
  expect(closed.dismiss).toBe(true)
  expect(closed.state).toEqual({ count: 3 })
})

test("send messages the agent and keeps the widget open, waking it unless wake is false", async () => {
  const ping = await event({ count: 3 }, "Ping")
  expect(ping.send).toEqual({ value: { count: 3 }, wake: true })
  expect(ping.state).toEqual({ count: 4 })
  expect(ping.view.type === "column" && ping.view.children[0]).toEqual({ type: "text", text: "Count: 4" })
  expect("submit" in ping || "dismiss" in ping).toBe(false)
  const quiet = await event({ count: 3 }, "Quiet")
  expect(quiet.send).toEqual({ value: null, wake: false })
  expect(quiet.state).toEqual({ count: 3 })
  const session = await WidgetSession.start(counter, data)
  expect((await session.dispatch(press(button(session.view, "Ping")))).send).toEqual({
    value: { count: 1 },
    wake: true,
  })
  expect((await session.dispatch(press(button(session.view, "+")))).state).toEqual({ count: 3 })
})

test("unknown ids, nodes without a handler and mismatched event types change nothing; init is optional", async () => {
  for (const ignored of [
    press("0/404"),
    press(button(first.view, "Inert")),
    { id: button(first.view, "+"), type: "change" as const, value: 1 },
    { id: "", type: "sparkle" as never },
  ]) {
    const output = await step(counter, { phase: "event", data, state: { count: 2 }, event: ignored })
    expect(output.state).toEqual({ count: 2 })
    expect("submit" in output || "dismiss" in output || "send" in output).toBe(false)
  }
  const minimal = program(`function view(state) { return ui.text(JSON.stringify(state)) }`)
  expect((await step(minimal, { phase: "init", data: null })).view).toEqual({ type: "text", text: "{}" })
})

test("system events reach only the hooks and control events only the handlers", async () => {
  const hooked = program(`
    function view(state) {
      return ui.column([
        ui.text(state.log.join(" ")),
        ui.button("Go", { onPress: (state) => ({ log: [...state.log, "press"] }) }),
        ui.checkbox("On", false, { onChange: (state, on) => ({ log: [...state.log, "check:" + on] }) }),
      ])
    }
    function init() { return { log: [] } }
    function onKey(state, key) { return { log: [...state.log, "key:" + key.kind + ":" + key.code] } }
    function onFocus(state, focused) { return { log: [...state.log, "focus:" + focused] } }
    function onFullscreen(state, on, close) { return { log: [...state.log, "fullscreen:" + on + ":" + JSON.stringify(close)] } }
    function onCapture(state, captured) { return { log: [...state.log, "capture:" + captured] } }
  `)
  const session = await WidgetSession.start(hooked, null)
  const go = nodes(session.view).find((node) => node.type === "button")!
  const check = nodes(session.view).find((node) => node.type === "checkbox")!
  const id = (node: Node) => ("id" in node && node.id) || ""
  const key = {
    kind: "down",
    key: "a",
    code: "KeyA",
    repeat: false,
    shift: false,
    alt: false,
    ctrl: false,
    meta: false,
  }
  // System events carrying a control's id still go to the hooks, never the control's handler.
  await session.dispatch({ id: id(go), type: "focus", value: true })
  await session.dispatch({ id: id(check), type: "key", value: key as never })
  await session.dispatch({
    id: id(go),
    type: "fullscreen",
    value: true,
    close: { x: 300, y: 8, width: 44, height: 44 },
  })
  await session.dispatch({ id: "", type: "capture", value: false })
  // Control events go to the node with that id only, and only with the type it takes.
  await session.dispatch({ id: "", type: "press" })
  await session.dispatch({ id: id(check), type: "press" })
  await session.dispatch({ id: id(go), type: "change", value: true })
  await session.dispatch({ id: id(check), type: "change", value: "yes" })
  await session.dispatch(press(id(go)))
  await session.dispatch({ id: id(check), type: "change", value: true })
  expect(session.state).toEqual({
    log: [
      "focus:true",
      "key:down:KeyA",
      "fullscreen:true:" + JSON.stringify({ x: 300, y: 8, width: 44, height: 44 }),
      "capture:false",
      "press",
      "check:true",
    ],
  })
  // Without hooks, system events change nothing.
  const plain = await WidgetSession.start(counter, data)
  await plain.dispatch({ id: "", type: "focus", value: true })
  await plain.dispatch({ id: "", type: "key", value: key as never })
  expect(plain.state).toEqual({ count: 1 })
})

test("keyed list items keep their ids when an item before them is removed", async () => {
  const list = program(`
    function init() { return { items: ["a", "b", "c"], removed: [] } }
    function view(state) {
      return ui.column([
        ui.text("Items"),
        state.items.map((item) =>
          ui.row({ key: item }, [
            ui.text(item),
            ui.button("Remove " + item, {
              onPress: (state) => ({ items: state.items.filter((other) => other !== item), removed: [...state.removed, item] }),
            }),
          ]),
        ),
        ui.button("Unkeyed after the list", { onPress: (state) => state }),
      ])
    }
  `)
  const session = await WidgetSession.start(list, null)
  const ids = () =>
    Object.fromEntries(
      nodes(session.view).flatMap((node) => (node.type === "button" ? [[node.label, node.id] as const] : [])),
    )
  const before = ids()
  expect(before).toEqual({
    "Remove a": "0/:a/1",
    "Remove b": "0/:b/1",
    "Remove c": "0/:c/1",
    "Unkeyed after the list": "0/2",
  })
  await session.dispatch(press(before["Remove b"]!))
  expect(ids()).toEqual({
    "Remove a": before["Remove a"],
    "Remove c": before["Remove c"],
    "Unkeyed after the list": "0/2",
  })
  // The old id of the removed item is gone, so a late event for it does nothing.
  await session.dispatch(press(before["Remove b"]!))
  await session.dispatch(press(before["Remove c"]!))
  expect(session.state).toEqual({ items: ["a"], removed: ["b", "c"] })
})

test("failures reject with a typed StepError", async () => {
  const failure = (label: string) =>
    event({ count: 0 }, label).then(
      () => undefined,
      (error: unknown) => error,
    )
  const thrown = await failure("Boom")
  expect(thrown).toBeInstanceOf(StepError)
  expect(thrown).toMatchObject({ _tag: "Widget.StepError", kind: "error", message: "Error: boom" })
  expect(await failure("Spin")).toMatchObject({ kind: "timeout" })
  expect(await step(counter, { phase: "init", data: null }).catch((error: unknown) => error)).toMatchObject({
    kind: "error",
  })
  expect(
    await step(program("function view( {"), { phase: "init", data: null }).catch((error: unknown) => error),
  ).toMatchObject({ kind: "error" })
})

test("a program built for another prelude<->host contract is refused before it runs", async () => {
  const text = program(`function view() { return ui.text("x") }`)
  const declared = /^const __widget_protocol = 2\n/
  const run = (code: string) => step(code, { phase: "init", data: null }).catch((error: unknown) => error)
  // Without the prelude, or with one from before protocol 2: a program error the agent can fix by posting it again.
  expect(await run(`function view() { return { type: "text", text: "x" } }`)).toMatchObject({
    _tag: "Widget.StepError",
    kind: "invalid",
    message: OLDER,
  })
  expect(await run(text.replace(declared, ""))).toMatchObject({ kind: "invalid", message: OLDER })
  expect(await run(text.replace(declared, "const __widget_protocol = 1\n"))).toMatchObject({ message: OLDER })
  // A newer one: this host can't run it, a client error.
  const newer = await run(text.replace(declared, "const __widget_protocol = 3\n"))
  expect(newer).not.toBeInstanceOf(StepError)
  expect(newer).toMatchObject({ message: NEWER })
  expect(await run(text)).toMatchObject({ view: { type: "text", text: "x" } })
})

test("a view that breaks the node schema is invalid", async () => {
  const invalid = (view: string) =>
    step(program(`function view() { return ${view} }`), { phase: "init", data: null }).catch((error: unknown) => error)
  expect(await invalid(`({ type: "button" })`)).toMatchObject({ kind: "invalid" })
  expect(await invalid(`ui.column({ gap: 7 }, [])`)).toMatchObject({ kind: "invalid" })
  expect(await invalid(`ui.slider({ value: 1 })`)).toMatchObject({ kind: "invalid" })
  expect(await invalid(`{ type: "sparkle" }`)).toMatchObject({ kind: "invalid" })
  expect(await invalid(`"text"`)).toMatchObject({ kind: "invalid" })
})

test("unknown node types are dropped with a warning and unknown props ignored", async () => {
  const output = await step(
    program(`function view() { return ui.column([ui.text("a", { glow: true }), { type: "sparkle" }]) }`),
    { phase: "init", data: null },
  )
  expect(output.view).toEqual({ type: "column", children: [{ type: "text", text: "a" }] })
  expect(output.warnings).toEqual(['Unknown node type "sparkle" was not rendered'])
})

test("a session runs events in order and keeps its state when a step fails", async () => {
  const session = await WidgetSession.start(counter, data)
  expect(session.state).toEqual({ count: 1 })
  const plus = press(button(session.view, "+"))
  const results = await Promise.all([session.dispatch(plus), session.dispatch(plus)])
  expect(results.map((output) => output.state)).toEqual([{ count: 2 }, { count: 3 }])
  const view = session.view
  expect(await session.dispatch(press(button(view, "Boom"))).catch((error: unknown) => error)).toMatchObject({
    kind: "error",
  })
  expect(session.state).toEqual({ count: 3 })
  expect(session.view).toBe(view)
  expect((await session.dispatch(press(button(view, "Done")))).submit).toEqual({ total: 3 })
})

test("a session whose init fails does not start", async () => {
  expect(await WidgetSession.start(counter, null).catch((error: unknown) => error)).toBeInstanceOf(StepError)
})

test("in full screen a canvas's pointer carries the close button's area; off screen it has none", async () => {
  const canvas = program(`
    function init() { return { seen: [] } }
    function view(state) {
      return ui.canvas({ height: 100, onPointer: (state, p) => ({ seen: [...state.seen, p.close ?? null] }) })
    }
  `)
  const session = await WidgetSession.start(canvas, null)
  const value = { kind: "down" as const, x: 10, y: 10, width: 200, height: 100 }
  const close = { x: 148, y: -20, width: 44, height: 44 }
  await session.dispatch({ id: "0", type: "pointer", value })
  await session.dispatch({ id: "0", type: "pointer", value: { ...value, close } })
  await session.dispatch({ id: "0", type: "pointer", value: { ...value, close: { x: "?" } as never } })
  expect(session.state).toEqual({ seen: [null, close, null] })
})

import { expect, test } from "bun:test"
import { program, step, StepError, WidgetSession } from "../src/index.js"

const counter = program(`
  function init(data) { return { count: data.start } }
  function view(state, data) {
    return ui.column([ui.text(data.label + ": " + state.count), ui.button("inc", "+"), ui.button("done", "Done")])
  }
  function update(state, event) {
    if (event.id === "inc") return { count: state.count + 1 }
    if (event.id === "done") return submit({ total: state.count })
    if (event.id === "close") return dismiss({ count: -1 })
    if (event.id === "empty") return submit()
    if (event.id === "ping") return send({ count: state.count }, { count: state.count + 1 })
    if (event.id === "quiet") return send(undefined, undefined, { wake: false })
    if (event.id === "boom") throw new Error("boom")
    if (event.id === "spin") while (true) {}
  }
`)

const data = { start: 1, label: "Count" }
const press = (id: string) => ({ id, type: "press" as const })

test("init runs init and view", async () => {
  expect(await step(counter, { phase: "init", data })).toEqual({
    state: { count: 1 },
    view: {
      type: "column",
      children: [
        { type: "text", text: "Count: 1" },
        { type: "button", id: "inc", label: "+" },
        { type: "button", id: "done", label: "Done" },
      ],
    },
  })
})

test("event runs update then view", async () => {
  const output = await step(counter, { phase: "event", data, state: { count: 4 }, event: press("inc") })
  expect(output.state).toEqual({ count: 5 })
  expect(output.view.type === "column" && output.view.children[0]).toEqual({ type: "text", text: "Count: 5" })
  expect("submit" in output).toBe(false)
  expect("dismiss" in output).toBe(false)
})

test("submit and dismiss end the widget, keeping the state unless given", async () => {
  const done = await step(counter, { phase: "event", data, state: { count: 3 }, event: press("done") })
  expect(done.submit).toEqual({ total: 3 })
  expect(done.state).toEqual({ count: 3 })
  const empty = await step(counter, { phase: "event", data, state: { count: 3 }, event: press("empty") })
  expect(empty.submit).toBeNull()
  const closed = await step(counter, { phase: "event", data, state: { count: 3 }, event: press("close") })
  expect(closed.dismiss).toBe(true)
  expect(closed.state).toEqual({ count: -1 })
})

test("send messages the agent and keeps the widget open, waking it unless wake is false", async () => {
  const ping = await step(counter, { phase: "event", data, state: { count: 3 }, event: press("ping") })
  expect(ping.send).toEqual({ value: { count: 3 }, wake: true })
  expect(ping.state).toEqual({ count: 4 })
  expect(ping.view.type === "column" && ping.view.children[0]).toEqual({ type: "text", text: "Count: 4" })
  expect("submit" in ping || "dismiss" in ping).toBe(false)
  const quiet = await step(counter, { phase: "event", data, state: { count: 3 }, event: press("quiet") })
  expect(quiet.send).toEqual({ value: null, wake: false })
  expect(quiet.state).toEqual({ count: 3 })
  const session = await WidgetSession.start(counter, data)
  expect((await session.dispatch(press("ping"))).send).toEqual({ value: { count: 1 }, wake: true })
  expect((await session.dispatch(press("inc"))).state).toEqual({ count: 3 })
})

test("update returning nothing keeps the state; init and update are optional", async () => {
  const output = await step(counter, { phase: "event", data, state: { count: 2 }, event: press("other") })
  expect(output.state).toEqual({ count: 2 })
  const minimal = program(`function view(state) { return ui.text(JSON.stringify(state)) }`)
  expect((await step(minimal, { phase: "init", data: null })).view).toEqual({ type: "text", text: "{}" })
  const next = await step(minimal, { phase: "event", data: null, state: { a: 1 }, event: press("x") })
  expect(next.state).toEqual({ a: 1 })
})

test("failures reject with a typed StepError", async () => {
  const failure = (id: string) =>
    step(counter, { phase: "event", data, state: { count: 0 }, event: press(id) }).then(
      () => undefined,
      (error: unknown) => error,
    )
  const thrown = await failure("boom")
  expect(thrown).toBeInstanceOf(StepError)
  expect(thrown).toMatchObject({ _tag: "Widget.StepError", kind: "error", message: "Error: boom" })
  expect(await failure("spin")).toMatchObject({ kind: "timeout" })
  expect(await step(counter, { phase: "init", data: null }).catch((error: unknown) => error)).toMatchObject({
    kind: "error",
  })
  expect(await step("function view( {", { phase: "init", data: null }).catch((error: unknown) => error)).toMatchObject({
    kind: "error",
  })
})

test("a view that breaks the node schema is invalid", async () => {
  const invalid = (view: string) =>
    step(program(`function view() { return ${view} }`), { phase: "init", data: null }).catch((error: unknown) => error)
  expect(await invalid(`ui.button("x")`)).toMatchObject({ kind: "invalid" })
  expect(await invalid(`ui.column({ gap: 7 }, [])`)).toMatchObject({ kind: "invalid" })
  expect(await invalid(`ui.slider("s", { value: 1 })`)).toMatchObject({ kind: "invalid" })
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
  const results = await Promise.all([session.dispatch(press("inc")), session.dispatch(press("inc"))])
  expect(results.map((output) => output.state)).toEqual([{ count: 2 }, { count: 3 }])
  const view = session.view
  expect(await session.dispatch(press("boom")).catch((error: unknown) => error)).toMatchObject({ kind: "error" })
  expect(session.state).toEqual({ count: 3 })
  expect(session.view).toBe(view)
  expect((await session.dispatch(press("done"))).submit).toEqual({ total: 3 })
})

test("a session whose init fails does not start", async () => {
  expect(await WidgetSession.start(counter, null).catch((error: unknown) => error)).toBeInstanceOf(StepError)
})

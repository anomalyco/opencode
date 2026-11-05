import { expect, test } from "bun:test"
import {
  createListState,
  listActive,
  listScrollTarget,
  selectListEmptyState,
  transitionList,
  type ListEffect,
  type ListEvent,
  type ListKeyDown,
  type ListState,
} from "./list-machine"

const items = ["Alpha", "Beta", "Gamma"]

const config = { key: (item: string) => item }

function run(state: ListState<string>, ...events: ListEvent<string>[]) {
  return events.reduce<{ state: ListState<string>; effects: ListEffect<string>[]; handled: boolean }>(
    (result, event) => transitionList(result.state, event, config),
    { state, effects: [], handled: false },
  )
}

// Answers the load a transition asked for, as the driver does for a synchronous `items` list.
function settle(result: { state: ListState<string>; effects: ListEffect<string>[] }) {
  const load = result.effects.find((effect) => effect.type === "load")

  if (!load) return result.state
  const matches = items.filter((item) => item.toLowerCase().includes(load.query.toLowerCase()))

  return transitionList(result.state, { type: "load.resolved", attempt: load.attempt, items: matches }, config).state
}

function loaded(filter?: string) {
  return settle(run(createListState<string>(filter), { type: "items.reload" }))
}

function key(key: string, input: Partial<Omit<ListKeyDown, "type" | "key">> = {}): ListKeyDown {
  return {
    type: "key.down",
    key,
    ctrl: false,
    alt: false,
    meta: false,
    shift: false,
    composing: false,
    search: false,
    claimed: false,
    ...input,
  }
}

test("the clear button shows every row again and tells the parent", () => {
  const typed = settle(run(loaded(), { type: "query.change", value: "al" }))
  expect(typed.rows).toEqual(["Alpha"])

  const cleared = run(typed, { type: "query.change", value: "" })
  expect(cleared.effects).toEqual([
    { type: "notify.filter", value: "" },
    { type: "load", attempt: 3, query: "" },
  ])

  const state = settle(cleared)
  expect(state.filter).toEqual({ type: "uncontrolled", query: "" })
  expect(state.rows).toEqual(items)
  expect(state.highlight.activeKey).toBe("Alpha")
})

test("a controlled list clears when the parent accepts and keeps rows and query together when it does not", () => {
  const start = loaded("al")
  expect(start.rows).toEqual(["Alpha"])

  const cleared = run(start, { type: "query.change", value: "" })
  expect(cleared.effects).toEqual([{ type: "notify.filter", value: "" }])
  expect(cleared.state).toBe(start)

  const accepted = run(cleared.state, { type: "filter.controlled", value: "" })
  expect(accepted.effects).toEqual([{ type: "load", attempt: 2, query: "" }])
  expect(settle(accepted).rows).toEqual(items)
  expect(settle(accepted).filter).toEqual({ type: "controlled", query: "" })
})

test("a forced change reloads an unchanged query once", () => {
  const start = loaded()

  expect(run(start, { type: "query.change", value: "" }).effects).toEqual([])
  expect(run(start, { type: "query.change", value: "", force: true }).effects).toEqual([
    { type: "notify.filter", value: "" },
    { type: "load", attempt: 2, query: "" },
  ])
  expect(run(loaded("al"), { type: "query.change", value: "al", force: true }).effects).toEqual([
    { type: "notify.filter", value: "al" },
    { type: "load", attempt: 2, query: "al" },
  ])
})

test("switching between controlled and uncontrolled keeps the query and reloads only on a new one", () => {
  const start = loaded()
  const adopted = run(start, { type: "filter.controlled", value: "" })
  expect(adopted.effects).toEqual([])
  expect(adopted.state.filter).toEqual({ type: "controlled", query: "" })

  expect(run(adopted.state, { type: "filter.uncontrolled" }).state.filter).toEqual({ type: "uncontrolled", query: "" })
  expect(run(start, { type: "filter.controlled", value: "be" }).effects).toEqual([
    { type: "load", attempt: 2, query: "be" },
  ])
})

test("a superseded or late load result is ignored", () => {
  const first = run(loaded(), { type: "query.change", value: "a" })
  const second = run(first.state, { type: "query.change", value: "al" })
  const stale = transitionList(second.state, { type: "load.resolved", attempt: 2, items }, config)
  expect(stale.state).toBe(second.state)

  const ready = transitionList(second.state, { type: "load.resolved", attempt: 3, items }, config).state
  expect(ready).toMatchObject({ status: "ready", epoch: 3, rows: ["Alpha"] })
  expect(transitionList(ready, { type: "load.failed", attempt: 3 }, config).state).toBe(ready)
})

test("a rejected load reports a failure, not an empty result, and a reload or new query recovers", () => {
  // `load.failed` used to settle as `ready` with no rows, so the list said "No results" for a server error.
  const loading = run(loaded(), { type: "items.reload" })
  const failed = transitionList(loading.state, { type: "load.failed", attempt: 2 }, config)
  expect(failed.state).toMatchObject({ status: "failed", epoch: 2, rows: [], highlight: { activeKey: null } })
  expect(failed.effects).toEqual([{ type: "cancel.load" }])
  expect(selectListEmptyState(failed.state)).toEqual({ type: "failed" })

  const empty = transitionList(loading.state, { type: "load.resolved", attempt: 2, items: [] }, config).state
  expect(selectListEmptyState(empty)).toEqual({ type: "empty", query: "" })

  expect(run(failed.state, { type: "items.reload" }).effects).toEqual([{ type: "load", attempt: 3, query: "" }])
  expect(settle(run(failed.state, { type: "items.reload" }))).toMatchObject({ status: "ready", rows: items })
  expect(settle(run(failed.state, { type: "query.change", value: "be" }))).toMatchObject({
    status: "ready",
    rows: ["Beta"],
  })
})

test("a load that never settles times out into a failure and ignores its late result", () => {
  const typed = run(loaded(), { type: "query.change", value: "al" })
  expect(selectListEmptyState(typed.state)).toEqual({ type: "loading" })

  const timedOut = transitionList(typed.state, { type: "load.timed-out", attempt: 2 }, config)
  expect(timedOut.state).toMatchObject({ status: "failed", epoch: 2, rows: [] })
  expect(timedOut.effects).toEqual([{ type: "cancel.load" }])
  expect(transitionList(timedOut.state, { type: "load.resolved", attempt: 2, items }, config).state).toBe(
    timedOut.state,
  )

  // A superseded attempt's timeout does not fail the attempt that replaced it.
  const retyped = run(typed.state, { type: "query.change", value: "alp" }).state
  expect(transitionList(retyped, { type: "load.timed-out", attempt: 2 }, config).state).toBe(retyped)
})

test("disposing stops an in-flight load and ignores every later event", () => {
  const loading = run(loaded(), { type: "items.reload" }).state
  const disposed = transitionList(loading, { type: "disposed" }, config)
  expect(disposed.state.status).toBe("disposed")
  expect(disposed.effects).toEqual([{ type: "cancel.load" }])
  expect(transitionList(loaded(), { type: "disposed" }, config).effects).toEqual([])

  for (const event of [
    { type: "load.resolved", attempt: 2, items },
    { type: "load.failed", attempt: 2 },
    { type: "query.change", value: "be" },
    { type: "items.reload" },
    key("ArrowDown"),
  ] satisfies ListEvent<string>[])
    expect(transitionList(disposed.state, event, config)).toMatchObject({ state: disposed.state, effects: [] })
})

test("the pointer takes the highlight without scrolling and any key gives it back", () => {
  const start = loaded()
  expect(run(start, { type: "pointer.move", key: "Beta", moved: false }).state).toBe(start)

  const hovered = run(start, { type: "pointer.move", key: "Beta", moved: true }).state
  expect(hovered.highlight).toEqual({ mode: "mouse", activeKey: "Beta" })
  expect(listScrollTarget(hovered)).toEqual({ type: "none" })

  const left = run(hovered, { type: "pointer.leave" }).state
  expect(left.highlight).toEqual({ mode: "mouse", activeKey: null })
  expect(run(start, { type: "pointer.leave" }).state).toBe(start)

  const typed = run(hovered, key("Escape", { claimed: true }))
  expect(typed.handled).toBe(false)
  expect(typed.state.highlight).toEqual({ mode: "keyboard", activeKey: "Beta" })
  expect(listScrollTarget(typed.state)).toEqual({ type: "item", key: "Beta" })
})

test.each<{ name: string; events: ListKeyDown[]; active: string | null; handled: boolean }>([
  { name: "ArrowDown moves to the next row", events: [key("ArrowDown")], active: "Beta", handled: true },
  { name: "ArrowUp wraps to the last row", events: [key("ArrowUp")], active: "Gamma", handled: true },
  {
    name: "Ctrl+N and Ctrl+P move like arrows",
    events: [key("n", { ctrl: true }), key("n", { ctrl: true }), key("p", { ctrl: true })],
    active: "Beta",
    handled: true,
  },
  { name: "ArrowDown wraps to the first row", events: [key("End"), key("ArrowDown")], active: "Alpha", handled: true },
  {
    name: "Option+Arrow is left to text editing",
    events: [key("ArrowDown", { alt: true })],
    active: "Alpha",
    handled: false,
  },
  {
    name: "Cmd+Arrow is left to text editing",
    events: [key("ArrowDown", { meta: true })],
    active: "Alpha",
    handled: false,
  },
  { name: "End jumps to the last row", events: [key("End")], active: "Gamma", handled: true },
  { name: "a search input keeps End", events: [key("End", { search: true })], active: "Alpha", handled: false },
  { name: "Tab moves to the next row", events: [key("Tab")], active: "Beta", handled: true },
  {
    name: "Shift+Tab on the first row leaves focus to the browser",
    events: [key("Tab", { shift: true })],
    active: "Alpha",
    handled: false,
  },
  {
    name: "a claimed key does not move",
    events: [key("ArrowDown", { claimed: true })],
    active: "Alpha",
    handled: false,
  },
])("$name", (input) => {
  const result = run(loaded(), ...input.events)
  expect(result.state.highlight.activeKey).toBe(input.active)
  expect(result.handled).toBe(input.handled)
})

test("Enter selects the highlighted row and is handled even with none", () => {
  const start = run(loaded(), key("ArrowDown")).state
  expect(listActive(start)).toEqual({ item: "Beta", index: 1 })
  expect(run(start, key("Enter"))).toMatchObject({
    handled: true,
    effects: [{ type: "select", item: "Beta", index: 1 }],
  })
  expect(run(start, key("Enter", { composing: true })).handled).toBe(false)

  const empty = run(start, { type: "active.set", key: "" })
  expect(empty.state.highlight.activeKey).toBeNull()
  expect(run(empty.state, key("Enter"))).toMatchObject({ handled: true, effects: [] })
})

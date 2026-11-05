import { expect, test } from "bun:test"
import {
  createDeferredStoreState,
  createStoreLoadState,
  selectStoreReady,
  transitionDeferredStore,
  transitionStoreLoad,
  type DeferredStoreEffect,
  type DeferredStoreEvent,
  type DeferredStoreState,
  type StoreLoadEffect,
  type StoreLoadEvent,
  type StoreLoadState,
  type StoreWrite,
} from "./store-machine"

type Value = { readonly items: readonly string[] }

const set = (item: string): StoreWrite<Value> => ({ kind: "set", value: { items: [item] } })

function load(events: readonly StoreLoadEvent<Value>[], state: StoreLoadState<Value> = createStoreLoadState(true)) {
  return events.reduce<{ state: StoreLoadState<Value>; effects: StoreLoadEffect<Value>[] }>(
    (current, event) => {
      const next = transitionStoreLoad(current.state, event)

      return { state: next.state, effects: [...current.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

function defer(events: readonly DeferredStoreEvent<string, Value>[]) {
  return events.reduce<{ state: DeferredStoreState<string, Value>; effects: DeferredStoreEffect<string, Value>[] }>(
    (current, event) => {
      const next = transitionDeferredStore(current.state, event)

      return { state: next.state, effects: [...current.effects, ...next.effects] }
    },
    { state: createDeferredStoreState(), effects: [] },
  )
}

test("writes made while the store loads apply in order once it loads, and later writes at once", () => {
  const run = load([{ type: "write", write: set("a") }, { type: "write", write: set("b") }, { type: "loaded" }])

  expect({ ready: selectStoreReady(run.state), effects: run.effects }).toEqual({
    ready: true,
    effects: [{ type: "apply", writes: [set("a"), set("b")], hydrated: true }],
  })
  expect(transitionStoreLoad(run.state, { type: "write", write: set("c") }).effects).toEqual([
    { type: "apply", writes: [set("c")], hydrated: false },
  ])
})

// Before, a failed read only logged: the store looked like it was still loading, and it held every write for good.
test("a failed read ends in failed, drops the writes that waited, and ignores later ones", () => {
  const cause = new Error("read failed")

  const run = load([
    { type: "write", write: set("a") },
    { type: "failed", cause },
  ])

  expect({ state: run.state, effects: run.effects }).toEqual({
    state: { status: "failed" },
    effects: [{ type: "reject", cause, log: true }],
  })
  expect(transitionStoreLoad(run.state, { type: "write", write: set("b") }).state).toBe(run.state)
  expect(transitionStoreLoad(run.state, { type: "loaded" }).state).toBe(run.state)
})

test("a store that answered synchronously is ready at once", () => {
  expect(load([{ type: "write", write: set("a") }], createStoreLoadState(false)).effects).toEqual([
    { type: "apply", writes: [set("a")], hydrated: false },
  ])
})

test.each([
  { name: "loading", events: [{ type: "write", write: set("a") }] },
  { name: "ready", events: [{ type: "loaded" }] },
  { name: "failed", events: [{ type: "failed", cause: "x" }] },
] satisfies { name: string; events: StoreLoadEvent<Value>[] }[])(
  "a store disposed while $name settles only a pending load and ignores everything after",
  (row) => {
    const before = load(row.events)
    const run = load([{ type: "disposed" }], before.state)

    expect(run.state.status).toBe("disposed")
    expect(run.effects.map((effect) => effect.type)).toEqual(row.name === "loading" ? ["reject"] : [])
    const late: StoreLoadEvent<Value>[] = [{ type: "write", write: set("b") }, { type: "loaded" }, { type: "disposed" }]

    expect(late.map((event) => transitionStoreLoad(run.state, event).state)).toEqual([run.state, run.state, run.state])
  },
)

test("writes made before the store opens are handed to it in order, then later writes go straight to it", () => {
  const run = defer([
    { type: "write", write: set("a") },
    { type: "sync", handle: undefined },
    { type: "write", write: set("b") },
    { type: "sync", handle: "first" },
    { type: "sync", handle: "first" },
    { type: "write", write: set("c") },
  ])

  expect(run.effects).toEqual([
    { type: "handover", handle: "first", writes: [set("a"), set("b")] },
    { type: "forward", handle: "first", write: set("c") },
  ])
})

test("writes made while the store reopens wait for the next one, never the store that closed", () => {
  const run = defer([
    { type: "sync", handle: "first" },
    { type: "sync", handle: undefined },
    { type: "write", write: set("a") },
    { type: "sync", handle: "second" },
    { type: "write", write: set("b") },
  ])

  expect(run.effects).toEqual([
    { type: "handover", handle: "second", writes: [set("a")] },
    { type: "forward", handle: "second", write: set("b") },
  ])
})

test("a store replaced without closing takes the writes made after it opened", () => {
  const run = defer([
    { type: "sync", handle: "first" },
    { type: "sync", handle: "second" },
    { type: "write", write: set("a") },
  ])

  expect(run.effects).toEqual([{ type: "forward", handle: "second", write: set("a") }])
})

test("a deferred store disposed with writes waiting drops them and ignores later events", () => {
  const run = defer([{ type: "write", write: set("a") }, { type: "disposed" }, { type: "sync", handle: "first" }])

  expect({ state: run.state, effects: run.effects }).toEqual({ state: { status: "disposed" }, effects: [] })
  expect(transitionDeferredStore(run.state, { type: "write", write: set("b") }).state).toBe(run.state)
})

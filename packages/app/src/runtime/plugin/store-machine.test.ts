import { expect, test } from "bun:test"
import {
  createDeferredStoreState,
  createStoreLoadState,
  transitionDeferredStore,
  transitionStoreLoad,
  type DeferredStoreEvent,
  type StoreLoadEvent,
  type StoreWrite,
} from "./store-machine"

// `plugin-primitives.test.ts` covers loading, the hand-over before the first open and the batched open through the real
// handles. These cover the exits it cannot observe: a failed read, disposal and a store that reopens.

type Value = { readonly items: readonly string[] }

const set = (item: string): StoreWrite<Value> => ({ kind: "set", value: { items: [item] } })

// Before, a failed read only logged: the store looked like it was still loading, and it held every write for good.
test("a failed read ends in failed, drops the writes that waited, and ignores later ones", () => {
  const cause = new Error("read failed")
  const loading = transitionStoreLoad(createStoreLoadState<Value>(true), { type: "write", write: set("a") }).state
  const failed = transitionStoreLoad(loading, { type: "failed", cause })

  expect(failed).toEqual({ state: { status: "failed" }, effects: [{ type: "reject", cause, log: true }] })

  const late: StoreLoadEvent<Value>[] = [{ type: "write", write: set("b") }, { type: "loaded" }]

  expect(late.map((event) => transitionStoreLoad(failed.state, event).state)).toEqual([failed.state, failed.state])
})

test("disposal settles only a load still pending, and ignores everything after", () => {
  const loading = createStoreLoadState<Value>(true)
  const ready = createStoreLoadState<Value>(false)
  const disposed = transitionStoreLoad(loading, { type: "disposed" })

  expect({
    loading: disposed.effects.map((effect) => effect.type),
    ready: transitionStoreLoad(ready, { type: "disposed" }).effects,
    late: transitionStoreLoad(disposed.state, { type: "loaded" }).state,
  }).toEqual({ loading: ["reject"], ready: [], late: disposed.state })
})

test("writes made while the store reopens wait for the next one, never the store that closed", () => {
  const events: DeferredStoreEvent<string, Value>[] = [
    { type: "sync", handle: "first" },
    { type: "sync", handle: undefined },
    { type: "write", write: set("a") },
    { type: "sync", handle: "second" },
    { type: "write", write: set("b") },
    { type: "disposed" },
    { type: "write", write: set("c") },
  ]

  const machine = { state: createDeferredStoreState<string, Value>() }

  const effects = events.flatMap((event) => {
    const next = transitionDeferredStore(machine.state, event)

    machine.state = next.state

    return next.effects
  })

  expect(effects).toEqual([
    { type: "handover", handle: "second", writes: [set("a")] },
    { type: "forward", handle: "second", write: set("b") },
  ])
})

import { expect, test } from "bun:test"
import {
  createIpcState,
  selectIpcAvailable,
  selectIpcFailed,
  selectIpcGeneration,
  selectIpcNeedsSubscribe,
  selectIpcValue,
  transitionIpc,
  type IpcEffect,
  type IpcEvent,
  type IpcState,
} from "./ipc-machine"

/** Folds events through the machine, collecting every effect in order. */
function replay(events: readonly IpcEvent[], from = createIpcState()) {
  return events.reduce<{ state: IpcState; effects: IpcEffect[] }>(
    (current, event) => {
      const next = transitionIpc(current.state, event)

      return { state: next.state, effects: [...current.effects, ...next.effects] }
    },
    { state: from, effects: [] },
  )
}

function view(state: IpcState, id = "acme.awake") {
  return {
    available: selectIpcAvailable(state, id),
    value: selectIpcValue(state, id),
    generation: selectIpcGeneration(state, id),
    failed: selectIpcFailed(state, id),
    subscribe: selectIpcNeedsSubscribe(state, id),
  }
}

const subscribe: IpcEvent = { type: "subscribe", id: "acme.awake" }

// Before, a subscribe that rejected or never answered left the Ipc looking like it was still subscribing, so every
// `ctx.main()` call waited forever.
test.each<{ name: string; event: IpcEvent }>([
  { name: "rejects", event: { type: "failed", id: "acme.awake", attempt: 1, cause: new Error("boom") } },
  { name: "never answers", event: { type: "timeout", id: "acme.awake", attempt: 1 } },
])("a subscribe that $name fails the Ipc without retrying on every read", (input) => {
  const run = replay([subscribe, input.event, subscribe])

  expect(run.effects.map((effect) => effect.type)).toEqual(["subscribe", "timer.start", "timer.stop", "log"])
  expect(view(run.state)).toEqual({ available: false, value: undefined, generation: 0, failed: true, subscribe: false })
})

test("a failed Ipc subscribes again once main provides it again, keeping its generation count", () => {
  const run = replay([
    subscribe,
    { type: "failed", id: "acme.awake", attempt: 1, cause: "boom" },
    { type: "available", id: "acme.awake", available: false },
    { type: "available", id: "acme.awake", available: true },
  ])

  expect(run.effects.slice(-2)).toEqual([
    { type: "subscribe", id: "acme.awake", attempt: 2 },
    { type: "timer.start", id: "acme.awake", attempt: 2 },
  ])

  // The reply's own availability is older than the broadcast that started it.
  const answered = transitionIpc(run.state, {
    type: "subscribed",
    id: "acme.awake",
    attempt: 2,
    available: false,
    state: { awake: true },
  })

  expect(view(answered.state)).toEqual({
    available: true,
    value: { awake: true },
    generation: 1,
    failed: false,
    subscribe: false,
  })
})

test("results of an older subscribe change nothing", () => {
  const run = replay([
    subscribe,
    { type: "timeout", id: "acme.awake", attempt: 1 },
    { type: "available", id: "acme.awake", available: true },
  ])

  const stale: IpcEvent[] = [
    { type: "subscribed", id: "acme.awake", attempt: 1, available: true, state: 1 },
    { type: "failed", id: "acme.awake", attempt: 1, cause: "late" },
    { type: "timeout", id: "acme.awake", attempt: 1 },
  ]

  stale.forEach((event) => expect(transitionIpc(run.state, event)).toEqual({ state: run.state, effects: [] }))
})

// Before, a state push or reply while the Ipc was unavailable stored a value its readers then saw.
test("an unavailable Ipc holds no state", () => {
  const reply = replay([
    subscribe,
    { type: "subscribed", id: "acme.awake", attempt: 1, available: false, state: { awake: true } },
  ])

  expect(view(reply.state).value).toBeUndefined()
  expect(transitionIpc(reply.state, { type: "state", id: "acme.awake", value: 1 }).state).toBe(reply.state)

  const gone = replay([
    subscribe,
    { type: "state", id: "acme.awake", value: { awake: true } },
    { type: "available", id: "acme.awake", available: false },
    { type: "available", id: "acme.awake", available: true },
    { type: "subscribed", id: "acme.awake", attempt: 1, available: true, state: { awake: false } },
  ])

  // Going away cleared both the push and the reply's older state.
  expect(view(gone.state)).toMatchObject({ available: true, value: undefined, generation: 1 })
})

test.each<{ name: string; event: IpcEvent; reply: { available: boolean; state: unknown }; expected: object }>([
  {
    name: "the Ipc appearing",
    event: { type: "available", id: "acme.awake", available: true },
    reply: { available: false, state: undefined },
    expected: { available: true, value: undefined, generation: 1 },
  },
  {
    name: "the Ipc going away",
    event: { type: "available", id: "acme.awake", available: false },
    reply: { available: true, state: { count: 1 } },
    expected: { available: false, value: undefined, generation: 0 },
  },
  {
    name: "a state push",
    event: { type: "state", id: "acme.awake", value: { count: 2 } },
    reply: { available: true, state: { count: 1 } },
    expected: { available: true, value: { count: 2 }, generation: 1 },
  },
])("a subscribe reply older than $name keeps the event's data", (input) => {
  const run = replay([subscribe, input.event, { type: "subscribed", id: "acme.awake", attempt: 1, ...input.reply }])

  expect(view(run.state)).toMatchObject(input.expected)
})

test("availability broadcast before any read counts a generation once", () => {
  const run = replay([
    { type: "available", id: "acme.awake", available: true },
    subscribe,
    { type: "subscribed", id: "acme.awake", attempt: 1, available: true, state: undefined },
    { type: "available", id: "acme.awake", available: false },
    { type: "available", id: "acme.awake", available: true },
  ])

  expect(view(run.state)).toMatchObject({ available: true, generation: 2 })
})

test("disposing stops pending timers and ignores late replies", () => {
  const run = replay([subscribe, { type: "disposed" }])

  expect(run.effects.at(-1)).toEqual({ type: "timer.stop", id: "acme.awake" })

  const late = transitionIpc(run.state, {
    type: "subscribed",
    id: "acme.awake",
    attempt: 1,
    available: true,
    state: undefined,
  })

  expect(late.state).toBe(run.state)
  expect(selectIpcNeedsSubscribe(run.state, "acme.awake")).toBe(false)
})

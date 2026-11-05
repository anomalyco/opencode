import { expect, test } from "bun:test"
import { createDispatch } from "./dispatch"

type State = { readonly status: "idle" | "working" | "failed" | "done" }

type Event = { readonly type: "start" | "finish" | "noop" | "failed" }

type Effect = { readonly type: "explode" | "log" }

type Transition = { readonly state: State; readonly effects: readonly Effect[] }

const transition = (state: State, event: Event): Transition => {
  if (event.type === "start") return { state: { status: "working" }, effects: [{ type: "explode" }, { type: "log" }] }

  if (event.type === "failed") return { state: { status: "failed" }, effects: [] }

  if (event.type === "finish") return { state: { status: "done" }, effects: [] }

  return { state, effects: [] }
}

test("a throwing effect reports its failure event without stalling sibling effects or the queue", async () => {
  const log: string[] = []
  let current: State = { status: "idle" }

  const dispatch = createDispatch<State, Event, Effect>({
    read: () => current,
    write: (state) => {
      current = state
      log.push(`state:${state.status}`)
    },
    transition,
    run: (effect) => {
      log.push(`effect:${effect.type}`)

      if (effect.type === "explode") throw new Error("boom")
    },
    failed: (effect) => (effect.type === "explode" ? { type: "failed" } : undefined),
  })

  dispatch({ type: "start" })
  // An ignored event writes nothing.
  dispatch({ type: "noop" })
  expect(log).toEqual(["state:working", "effect:explode", "effect:log"])

  await Promise.resolve()
  await Promise.resolve()
  expect(log.slice(3)).toEqual(["state:failed"])

  dispatch({ type: "finish" })
  expect(current).toEqual({ status: "done" })
})

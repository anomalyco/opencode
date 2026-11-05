import { describe, expect, test } from "bun:test"
import {
  createComposerWriteState,
  transitionComposerWrite,
  type ComposerWriteEvent,
} from "./composer-write-machine"

type Draft = { readonly name: string; readonly log: string[] }

/**
 * Drives the machine as `mounted-session.ts` does: effects run in order, and an event an effect raises waits behind
 * the effects already running, so a write a queued write makes queues behind the writes already waiting.
 */
function harness() {
  const machine = { state: createComposerWriteState<Draft>() }
  const queue: ComposerWriteEvent<Draft>[] = []
  const observed: string[] = []
  const logged: unknown[] = []

  const dispatch = (event: ComposerWriteEvent<Draft>) => {
    queue.push(event)

    if (queue.length > 1) return

    while (queue[0]) {
      const next = transitionComposerWrite(machine.state, queue[0])

      machine.state = next.state
      next.effects.forEach((effect) => {
        if (effect.type === "apply") return effect.write(effect.target)

        if (effect.type === "drain") return dispatch({ type: "drain.next", target: effect.target })

        if (effect.type === "observe") return void observed.push(effect.target.name)

        logged.push(effect.cause)
      })
      queue.shift()
    }
  }

  const loading = Promise.resolve()

  const write = (draft: Draft, label: string, options: { pending?: boolean; then?: () => void } = {}) =>
    dispatch({
      type: "write",
      target: draft,
      load: options.pending ? loading : undefined,
      write: (target) => {
        target.log.push(label)
        options.then?.()
      },
    })

  return { machine, dispatch, write, observed, logged }
}

const draft = (name: string): Draft => ({ name, log: [] })

describe("composer write machine", () => {
  test("a write to a loaded draft applies at once", () => {
    const run = harness()
    const a = draft("a")

    run.write(a, "insert")

    expect(a.log).toEqual(["insert"])
    expect(run.observed).toEqual([])
  })

  test("writes before the draft loads wait for it, in call order", () => {
    const run = harness()
    const a = draft("a")

    run.write(a, "one", { pending: true })
    run.write(a, "two", { pending: true })
    // The draft loaded but its `loaded` event has not arrived: the write still waits its turn.
    run.write(a, "three")

    expect(a.log).toEqual([])
    expect(run.observed).toEqual(["a"])

    run.dispatch({ type: "loaded", target: a })

    expect(a.log).toEqual(["one", "two", "three"])
    expect(run.machine.state).toEqual({ status: "active", entries: [] })
  })

  test("a draft that fails to load is never overwritten by the writes that waited for it", () => {
    const run = harness()
    const a = draft("a")
    const cause = new Error("storage unavailable")

    run.write(a, "insert", { pending: true })
    run.dispatch({ type: "failed", target: a, cause })
    run.dispatch({ type: "loaded", target: a })

    expect(a.log).toEqual([])
    expect(run.logged).toEqual([cause])
  })

  test("a loading draft never holds back or releases another session's writes", () => {
    const run = harness()
    const a = draft("a")
    const b = draft("b")

    run.write(a, "a1", { pending: true })
    run.write(b, "b-ready")

    expect(b.log).toEqual(["b-ready"])

    run.dispatch({ type: "failed", target: a, cause: new Error("a") })
    run.write(b, "b-pending", { pending: true })

    // B's own load has not settled, whatever happened to A.
    expect(b.log).toEqual(["b-ready"])

    run.dispatch({ type: "loaded", target: b })

    expect(b.log).toEqual(["b-ready", "b-pending"])
  })

  test("a write a waiting write makes runs after the writes already waiting", () => {
    const run = harness()
    const a = draft("a")

    run.write(a, "attach", { pending: true, then: () => run.write(a, "nested") })
    run.write(a, "focus", { pending: true })
    run.dispatch({ type: "loaded", target: a })

    expect(a.log).toEqual(["attach", "focus", "nested"])
  })

  test("disposal ignores a late load and later writes", () => {
    const run = harness()
    const a = draft("a")

    run.write(a, "insert", { pending: true })
    run.dispatch({ type: "disposed" })
    run.dispatch({ type: "loaded", target: a })
    run.write(a, "late")

    expect(a.log).toEqual([])
    expect(run.machine.state).toEqual({ status: "disposed" })
  })

  test("an event for a target with nothing waiting keeps the same state", () => {
    const state = createComposerWriteState<Draft>()
    const a = draft("a")

    expect(transitionComposerWrite(state, { type: "loaded", target: a }).state).toBe(state)
    expect(transitionComposerWrite(state, { type: "drain.next", target: a }).state).toBe(state)
    expect(transitionComposerWrite(state, { type: "failed", target: a, cause: undefined }).state).toBe(state)
  })
})

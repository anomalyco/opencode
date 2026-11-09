import { expect, test } from "bun:test"
import {
  createHostApiAttachState,
  HOST_API_MAX_QUEUE,
  selectAttached,
  transitionHostApiAttach,
  type HostApiAttachEvent,
  type HostApiAttachState,
} from "./attach-machine"

type Mount = { readonly name: string }

/**
 * Drives the machine as the HostApis driver does: runs `run` effects at once, so a write can make another write, and
 * records which write ran against which mount.
 */
function harness() {
  const log: string[] = []
  const dropped: string[] = []
  const machine = { state: createHostApiAttachState<Mount>() }

  const dispatch = (event: HostApiAttachEvent<Mount>) => {
    const next = transitionHostApiAttach(machine.state, event)

    machine.state = next.state
    next.effects.forEach((effect) => {
      if (effect.type === "run") effect.run(effect.attached)

      if (effect.type === "drop") effect.items.forEach((item) => item.onDrop?.())
    })

    return next
  }

  const write = (name: string, then?: () => void) =>
    dispatch({
      type: "write",
      run: (mount) => {
        log.push(`${name}@${mount.name}`)
        then?.()
      },
      onDrop: () => dropped.push(name),
    }).queued

  const drain = (attempt: number) => {
    while (machine.state.status === "draining" && machine.state.attempt === attempt)
      dispatch({ type: "drain.next", attempt })
  }

  return { machine, log, dropped, dispatch, write, drain }
}

const one = { name: "one" }

const two = { name: "two" }

// Before, the flush spliced the whole queue first, so a write made by a waiting write found it empty and ran at once,
// ahead of the writes still waiting.
test("a write made by a waiting write runs after the writes that waited before it", () => {
  const run = harness()

  run.write("A", () => run.write("nested"))
  run.write("B")
  run.dispatch({ type: "attach", attached: one })
  run.drain(1)

  expect(run.log).toEqual(["A@one", "B@one", "nested@one"])
  expect(run.machine.state.status).toBe("live")
})

// Before, an empty queue at attach made writes during the interface's first render run in that render, while the same
// writes behind a waiting one ran after it.
test("a write made during the first render waits for the drain even when nothing waited before it", () => {
  const run = harness()
  const attached = run.dispatch({ type: "attach", attached: one })

  run.write("render")

  expect({ effects: attached.effects, log: [...run.log], attached: selectAttached(run.machine.state) }).toEqual({
    effects: [{ type: "schedule.drain", attempt: 1 }],
    log: [],
    attached: one,
  })
  run.drain(1)
  run.write("live")
  expect(run.log).toEqual(["render@one", "live@one"])
})

test("a waiting write cancelled by an earlier one never runs", () => {
  const run = harness()
  const ids: number[] = []

  run.write("A", () => run.dispatch({ type: "cancel", id: ids[0] ?? 0 }))
  ids.push(run.write("B") ?? 0)
  run.write("C")
  run.dispatch({ type: "attach", attached: one })
  run.drain(1)

  expect(run.log).toEqual(["A@one", "C@one"])
})

test("cancelling a write that already ran, or one never queued, changes nothing", () => {
  const run = harness()

  run.dispatch({ type: "attach", attached: one })
  run.drain(1)
  const live = run.machine.state

  expect(run.write("now")).toBeUndefined()
  expect(transitionHostApiAttach(live, { type: "cancel", id: 7 }).state).toBe(live)
})

test("a detached queue past its cap drops the oldest write", () => {
  const run = harness()

  Array.from({ length: HOST_API_MAX_QUEUE + 1 }, (_, index) => run.write(`w${index}`))

  expect({
    dropped: run.dropped,
    size: run.machine.state.status === "detached" ? run.machine.state.queue.length : -1,
  }).toEqual({ dropped: ["w0"], size: HOST_API_MAX_QUEUE })
})

test("disposal drops every waiting write and every later one", () => {
  const run = harness()

  run.write("A")
  run.write("B")
  run.dispatch({ type: "disposed" })
  run.write("late")
  run.dispatch({ type: "attach", attached: one })
  run.drain(1)

  expect({ dropped: run.dropped, log: run.log, status: run.machine.state.status }).toEqual({
    dropped: ["A", "B", "late"],
    log: [],
    status: "disposed",
  })
})

test("a detach while draining keeps the writes not run yet for the next mount", () => {
  const run = harness()

  run.write("A", () => run.dispatch({ type: "detach", attempt: 1 }))
  run.write("B")
  run.dispatch({ type: "attach", attached: one })
  run.drain(1)
  run.dispatch({ type: "attach", attached: two })
  run.drain(2)

  expect(run.log).toEqual(["A@one", "B@two"])
})

test("a detach or drain of an earlier mount is ignored", () => {
  const run = harness()

  run.write("A")
  run.dispatch({ type: "attach", attached: one })
  run.dispatch({ type: "attach", attached: two })

  const draining: HostApiAttachState<Mount> = run.machine.state

  expect(transitionHostApiAttach(draining, { type: "detach", attempt: 1 }).state).toBe(draining)
  expect(transitionHostApiAttach(draining, { type: "drain.next", attempt: 1 }).state).toBe(draining)
  run.drain(2)
  expect(run.log).toEqual(["A@two"])

  const live = run.machine.state

  expect(transitionHostApiAttach(live, { type: "detach", attempt: 1 }).state).toBe(live)
  run.dispatch({ type: "detach", attempt: 2 })
  expect(transitionHostApiAttach(run.machine.state, { type: "drain.next", attempt: 2 }).state).toBe(run.machine.state)
  expect(selectAttached(run.machine.state)).toBeUndefined()
})

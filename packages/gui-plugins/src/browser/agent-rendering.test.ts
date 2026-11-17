import { expect, test } from "bun:test"
import { agentRendering, needsWakeFrame } from "./agent-rendering"

test("only the last command starts the idle clock; wake before the next command and cancel at disposal", () => {
  const lifetime = new AbortController()
  const timers = new Set<() => void>()
  const throttles: boolean[] = []

  const render = agentRendering(lifetime.signal, value => throttles.push(value), (ms, run) => {
    expect(ms).toBe(30_000)
    timers.add(run)

    return () => { timers.delete(run) }
  })

  const wait = render.hold()
  render.hold()[Symbol.dispose]()
  expect(timers.size).toBe(0)
  wait[Symbol.dispose]()
  expect(timers.size).toBe(1)
  const followup = render.hold()
  expect(timers.size).toBe(0)
  followup[Symbol.dispose]()
  timers.forEach(run => run())
  render.committed()
  expect(throttles).toEqual([false, true])
  render.hold()[Symbol.dispose]()
  expect(throttles).toEqual([false, true, false])
  lifetime.abort()
  expect(timers.size).toBe(0)
})

test("overlapping commands await the same first frame", async () => {
  const render = agentRendering(new AbortController().signal, () => {}, () => () => {})
  const frame = Promise.withResolvers<void>()
  const first = render.hold(() => frame.promise)
  const second = render.hold(() => { throw new Error("duplicate wake") })
  expect(second.painted).toBe(first.painted)
  frame.resolve()
  await first.painted
  first[Symbol.dispose]()
  second[Symbol.dispose]()
})

test("idle past the deadline with a dialog open, the dialog command un-throttles without waiting for a frame", () => {
  const timers: (() => void)[] = []
  const throttles: boolean[] = []

  const render = agentRendering(new AbortController().signal, value => throttles.push(value), (_, run) => {
    timers.push(run)

    return () => {}
  })

  render.hold()[Symbol.dispose]()
  timers.forEach(run => run())
  expect(throttles).toEqual([false, true])

  // An open alert pauses the page's animation frames, so no command waits for one, including the one that answers it.
  for (const method of ["dialog", "snapshot", "click", "navigate"] as const) expect(needsWakeFrame(method, true, true)).toBe(false)

  const answer = render.hold(needsWakeFrame("dialog", true, true) ? () => new Promise(() => {}) : undefined)
  expect(answer.painted).toBeUndefined()
  expect(throttles).toEqual([false, true, false])
})

test("a renderer that never paints neither blocks navigation nor fails the command that waited for it", async () => {
  const render = agentRendering(new AbortController().signal, () => {}, () => () => {})
  const frame = Promise.withResolvers<void>()
  const snapshot = render.hold(needsWakeFrame("snapshot", true, false) ? () => frame.promise : undefined)
  expect(snapshot.painted).toBeDefined()

  for (const method of ["navigate", "reload", "stop", "back", "dialog", "tabs.close"] as const) expect(needsWakeFrame(method, true, false)).toBe(false)
  expect(needsWakeFrame("snapshot", false, false)).toBe(false)
  expect(render.hold(needsWakeFrame("navigate", true, false) ? () => frame.promise : undefined).painted).toBeUndefined()
  // The capture deadline rejects the wake; the snapshot then proceeds as it would without one.
  frame.reject(new Error("no frame"))
  await expect(snapshot.painted).resolves.toBeUndefined()
})

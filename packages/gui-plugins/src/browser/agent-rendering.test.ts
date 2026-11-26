import { afterEach, expect, jest, test } from "bun:test"
import { agentRendering, needsWakeFrame } from "./agent-rendering"

afterEach(() => {
  jest.useRealTimers()
})

test("only the last command starts the idle clock; wake before the next command and cancel at disposal", () => {
  jest.useFakeTimers()
  const lifetime = new AbortController()
  const throttles: boolean[] = []
  const render = agentRendering(lifetime.signal, value => throttles.push(value))

  const wait = render.hold()
  render.hold()[Symbol.dispose]()
  jest.advanceTimersByTime(30_000)
  expect(throttles).toEqual([false])
  wait[Symbol.dispose]()
  jest.advanceTimersByTime(29_999)
  const followup = render.hold()
  jest.advanceTimersByTime(30_000)
  expect(throttles).toEqual([false])
  followup[Symbol.dispose]()
  jest.advanceTimersByTime(29_999)
  expect(throttles).toEqual([false])
  jest.advanceTimersByTime(1)
  render.committed()
  expect(throttles).toEqual([false, true])
  render.hold()[Symbol.dispose]()
  expect(throttles).toEqual([false, true, false])
  lifetime.abort()
  jest.advanceTimersByTime(30_000)
  expect(throttles).toEqual([false, true, false])
})

test("overlapping commands await the same first frame", async () => {
  const render = agentRendering(new AbortController().signal, () => {})
  const frame = Promise.withResolvers<void>()
  const first = render.hold(() => frame.promise)
  const second = render.hold(() => { throw new Error("duplicate wake") })
  expect(second.painted).toBe(first.painted)
  frame.resolve()
  await first.painted
  first[Symbol.dispose]()
  second[Symbol.dispose]()
})

test("a command that needs no frame wakes the page without one; the next one that needs a frame still waits", async () => {
  jest.useFakeTimers()
  const throttles: boolean[] = []
  const frames: ReturnType<typeof Promise.withResolvers<void>>[] = []
  const render = agentRendering(new AbortController().signal, value => throttles.push(value))

  const wake = () => {
    const frame = Promise.withResolvers<void>()
    frames.push(frame)

    return frame.promise
  }

  for (const method of ["frames", "dialog"] as const) {
    const passive = render.hold(needsWakeFrame(method, true, false) ? wake : undefined)
    expect(passive.painted).toBeUndefined()
    passive[Symbol.dispose]()
  }

  expect(throttles).toEqual([false])
  expect(frames).toHaveLength(0)
  // The page is awake but has painted nothing since: an immediate snapshot waits for its first frame.
  const snapshot = render.hold(needsWakeFrame("snapshot", true, false) ? wake : undefined)
  expect(snapshot.painted).toBeDefined()
  expect(frames).toHaveLength(1)
  frames[0]?.resolve()
  await snapshot.painted
  const click = render.hold(needsWakeFrame("click", true, false) ? wake : undefined)
  expect(click.painted).toBeUndefined()
  expect(frames).toHaveLength(1)
  snapshot[Symbol.dispose]()
  click[Symbol.dispose]()
  // Throttled again after the idle time, the page owes the next painting command a fresh frame.
  jest.advanceTimersByTime(30_000)
  expect(throttles).toEqual([false, true])
  expect(render.hold(wake).painted).toBeDefined()
  expect(frames).toHaveLength(2)
})

test("idle past the deadline with a dialog open, the dialog command un-throttles without waiting for a frame", () => {
  jest.useFakeTimers()
  const throttles: boolean[] = []
  const render = agentRendering(new AbortController().signal, value => throttles.push(value))

  render.hold()[Symbol.dispose]()
  jest.advanceTimersByTime(30_000)
  expect(throttles).toEqual([false, true])

  // An open alert pauses the page's animation frames, so no command waits for one, including the one that answers it.
  for (const method of ["dialog", "snapshot", "click", "navigate"] as const) expect(needsWakeFrame(method, true, true)).toBe(false)

  const answer = render.hold(needsWakeFrame("dialog", true, true) ? () => new Promise(() => {}) : undefined)
  expect(answer.painted).toBeUndefined()
  expect(throttles).toEqual([false, true, false])
})

test("a renderer that never paints neither blocks navigation nor fails the command that waited for it", async () => {
  const render = agentRendering(new AbortController().signal, () => {})
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

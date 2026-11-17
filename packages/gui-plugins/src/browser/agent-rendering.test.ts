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

test("a missing frame never prevents acting; dialog and navigation bypass even a pending wake", async () => {
  const render = agentRendering(new AbortController().signal, () => {}, () => () => {})
  const frame = Promise.withResolvers<void>()
  const shot = render.hold(() => frame.promise)
  expect(needsWakeFrame("dialog", true, true)).toBe(false)
  expect(needsWakeFrame("navigate", true, false)).toBe(false)
  expect(needsWakeFrame("click", true, true)).toBe(false)
  expect(needsWakeFrame("snapshot", false, false)).toBe(false)
  expect(needsWakeFrame("evaluate", true, false)).toBe(true)
  expect(render.hold().painted).toBeUndefined()
  frame.reject(new Error("no frame"))
  await expect(shot.painted).resolves.toBeUndefined()
})

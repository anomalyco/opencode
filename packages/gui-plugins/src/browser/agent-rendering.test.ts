import { expect, test } from "bun:test"
import { agentRendering } from "./agent-rendering"

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

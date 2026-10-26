import { expect, test } from "bun:test"
import { recoveryPolicy } from "../src/service-recovery"
import { defaultEnsureTiming } from "../src/service-timing"

const info = { url: "http://127.0.0.1:4096", pid: 42 }

test("replaces only after a continuous window of unanswered probes", () => {
  const recovery = recoveryPolicy({ ...defaultEnsureTiming, unresponsiveAfter: 30 })

  expect(recovery.observe({ now: 0, info, timedOut: true, stalled: false, alive: true })).toBe(false)
  expect(recovery.observe({ now: 29, info, timedOut: true, stalled: false, alive: true })).toBe(false)
  expect(recovery.observe({ now: 30, info, timedOut: true, stalled: false, alive: true })).toBe(true)

  expect(recovery.observe({ now: 31, info, timedOut: true, stalled: true, alive: true })).toBe(false)
  expect(recovery.observe({ now: 40, info, timedOut: true, stalled: false, alive: true })).toBe(false)
})

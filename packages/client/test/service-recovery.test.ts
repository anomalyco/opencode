import { expect, test } from "bun:test"
import type { Info } from "../src/service"
import { recoveryPolicy } from "../src/service-recovery"
import { defaultEnsureTiming } from "../src/service-timing"

const timing = { ...defaultEnsureTiming, unresponsiveAfter: 1_000 }
const owner: Info = { id: "owner", url: "http://127.0.0.1:4096", pid: 4242 }

function silent(now: number, overrides: { info?: Info; timedOut?: boolean; stalled?: boolean; alive?: boolean } = {}) {
  return {
    now,
    info: owner,
    timedOut: true,
    stalled: false,
    alive: true,
    ...overrides,
  }
}

test("replaces a live owner only when the whole window stays unanswered", () => {
  const policy = recoveryPolicy(timing)

  expect(policy.observe(silent(0))).toBe(false)
  expect(policy.observe(silent(999))).toBe(false)
  expect(policy.observe(silent(1_000))).toBe(true)
})

test("an answering sample restarts the window", () => {
  const policy = recoveryPolicy(timing)

  expect(policy.observe(silent(0))).toBe(false)
  expect(policy.observe(silent(900))).toBe(false)
  expect(policy.observe(silent(950, { timedOut: false }))).toBe(false)
  expect(policy.observe(silent(1_400))).toBe(false)
  expect(policy.observe(silent(1_950))).toBe(false)
  expect(policy.observe(silent(2_400))).toBe(true)
})

test("a sample that spanned a suspend is not evidence and restarts the window", () => {
  const policy = recoveryPolicy(timing)

  expect(policy.observe(silent(0))).toBe(false)
  expect(policy.observe(silent(900))).toBe(false)
  expect(policy.observe(silent(1_100, { stalled: true, timedOut: false }))).toBe(false)
  expect(policy.observe(silent(1_500))).toBe(false)
  expect(policy.observe(silent(2_400))).toBe(false)
  expect(policy.observe(silent(2_500))).toBe(true)
})

test("a process that is already gone never opens a window", () => {
  const policy = recoveryPolicy(timing)

  expect(policy.observe(silent(0, { alive: false }))).toBe(false)
  for (let now = 500; now <= 5_000; now += 500) expect(policy.observe(silent(now, { alive: false }))).toBe(false)
})

test("a different or missing owner restarts the window", () => {
  const policy = recoveryPolicy(timing)
  const replacement: Info = { ...owner, pid: 4343 }

  expect(policy.observe(silent(0))).toBe(false)
  expect(policy.observe(silent(900))).toBe(false)
  expect(policy.observe(silent(950, { info: replacement }))).toBe(false)
  expect(policy.observe(silent(1_900, { info: replacement }))).toBe(false)
  expect(policy.observe(silent(1_950, { info: undefined }))).toBe(false)
  expect(policy.observe(silent(2_000))).toBe(false)
  expect(policy.observe(silent(3_000))).toBe(true)
})

test("replacing the owner starts a fresh window", () => {
  const policy = recoveryPolicy(timing)

  expect(policy.observe(silent(0))).toBe(false)
  expect(policy.observe(silent(900))).toBe(false)
  policy.replaced()
  expect(policy.observe(silent(1_000))).toBe(false)
  expect(policy.observe(silent(1_999))).toBe(false)
  expect(policy.observe(silent(2_000))).toBe(true)
})

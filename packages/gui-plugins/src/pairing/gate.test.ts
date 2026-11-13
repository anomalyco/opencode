import { expect, test } from "bun:test"
import { BUSY_THRESHOLD, createGate, RECENT_WINDOW, REPLACE_INTERVAL, SNOOZE_ALL, SNOOZE_DEVICE } from "./gate"

function clock() {
  const time = { now: 1_000_000 }

  return { time, now: () => time.now }
}

test("one request at a time: another device waits, the same device replaces its own after a while", () => {
  const { time, now } = clock()
  const gate = createGate(now)

  expect(gate.admit("a")).toBe("start")
  const active = { device: "a", since: time.now }
  expect(gate.admit("b", active)).toBe("refuse")
  expect(gate.admit("a", active)).toBe("refuse")
  time.now += REPLACE_INTERVAL
  expect(gate.admit("a", active)).toBe("replace")
})

test("snoozes are offered only once one device, or many, have been busy", () => {
  const { now } = clock()
  const gate = createGate(now)

  gate.admit("a")
  expect(gate.offers("a")).toEqual({ device: false, all: false })
  Array.from({ length: BUSY_THRESHOLD - 1 }, () => gate.admit("a"))
  expect(gate.offers("a")).toEqual({ device: true, all: false })
  gate.admit("b")
  gate.admit("c")
  expect(gate.offers("b")).toEqual({ device: false, all: true })
})

test("requests stop counting once they are old", () => {
  const { time, now } = clock()
  const gate = createGate(now)

  Array.from({ length: BUSY_THRESHOLD }, () => gate.admit("a"))
  time.now += RECENT_WINDOW + 1
  expect(gate.offers("a")).toEqual({ device: false, all: false })
})

test("a snoozed device, or everything, is refused until the snooze ends", () => {
  const { time, now } = clock()
  const gate = createGate(now)

  gate.snooze("device", "a")
  expect(gate.admit("a")).toBe("refuse")
  expect(gate.admit("b")).toBe("start")
  time.now += SNOOZE_DEVICE
  expect(gate.admit("a")).toBe("start")

  gate.snooze("all", "a")
  expect(gate.admit("c")).toBe("refuse")
  time.now += SNOOZE_ALL
  expect(gate.admit("c")).toBe("start")
})

test("clear forgets snoozes and counts", () => {
  const { now } = clock()
  const gate = createGate(now)

  Array.from({ length: BUSY_THRESHOLD }, () => gate.admit("a"))
  gate.snooze("all", "a")
  gate.clear()
  expect(gate.admit("a")).toBe("start")
  expect(gate.offers("a")).toEqual({ device: false, all: false })
})

import { expect, test } from "bun:test"
import { compareWorking, workingSince } from "./inbox-working"

test("uses the current run's start", () => {
  expect(workingSince({ time: { busy: 20 } })).toBe(20)
  expect(workingSince({ time: { busy: 20, idle: 10 } })).toBe(20)
})

test("has no start while only an earlier run's start is known", () => {
  expect(workingSince({ time: { busy: 10, idle: 20 } })).toBeUndefined()
  expect(workingSince({ time: { idle: 20 } })).toBeUndefined()
  expect(workingSince({ time: {} })).toBeUndefined()
})

test("orders by run start, then puts runs with no known start last", () => {
  const entry = (key: string, time: { busy?: number; idle?: number }) => ({ key, session: { time } })

  const sorted = [
    entry("d", {}),
    entry("b", { busy: 30 }),
    entry("c", { busy: 5, idle: 10 }),
    entry("a", { busy: 20, idle: 10 }),
  ].toSorted(compareWorking)

  expect(sorted.map((item) => item.key)).toEqual(["a", "b", "c", "d"])
})

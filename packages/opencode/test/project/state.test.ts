import { expect, test } from "bun:test"

import { State } from "../../src/project/state"

test("State.create caches values for the same key", async () => {
  let key = "a"
  let n = 0
  const state = State.create(
    () => key,
    () => ({ n: ++n }),
  )

  const a = state()
  const b = state()

  expect(a).toBe(b)
  expect(n).toBe(1)

  await State.dispose("a")
})

test("State.create isolates values by key", async () => {
  let key = "a"
  let n = 0
  const state = State.create(
    () => key,
    () => ({ n: ++n }),
  )

  const a = state()
  key = "b"
  const b = state()
  key = "a"
  const c = state()

  expect(a).toBe(c)
  expect(a).not.toBe(b)
  expect(n).toBe(2)

  await State.dispose("a")
  await State.dispose("b")
})

test("State.dispose clears a key and runs cleanup", async () => {
  const seen: string[] = []
  let key = "a"
  let n = 0
  const state = State.create(
    () => key,
    () => ({ n: ++n }),
    async (value) => {
      seen.push(String(value.n))
    },
  )

  const a = state()
  await State.dispose("a")
  const b = state()

  expect(a).not.toBe(b)
  expect(seen).toEqual(["1"])

  await State.dispose("a")
})

test("State.create dedupes concurrent promise initialization", async () => {
  const gate = Promise.withResolvers<void>()
  let n = 0
  const state = State.create(
    () => "a",
    async () => {
      n += 1
      await gate.promise
      return { n }
    },
  )

  const task = Promise.all([state(), state()])
  await Promise.resolve()
  expect(n).toBe(1)

  gate.resolve()
  const [a, b] = await task
  expect(a).toBe(b)

  await State.dispose("a")
})

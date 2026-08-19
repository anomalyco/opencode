import { expect, test } from "bun:test"
import { runPromptRollbackMutation } from "./session-prompt-rollback"

const prompt = (initial: string[], initialCursor?: number) => {
  let value = initial
  let cursor = initialCursor
  return {
    current: () => value,
    cursor: () => cursor,
    set: (next: string[], nextCursor?: number) => {
      value = next
      if (nextCursor !== undefined) cursor = nextCursor
    },
    setCursor: (next: number | undefined) => {
      cursor = next
    },
    reset: () => {
      value = []
      cursor = 0
    },
  }
}

test("captures the initiating prompt before asynchronous restore preparation", async () => {
  const first = prompt(["first draft"])
  const second = prompt(["second draft"])
  const prepared = Promise.withResolvers<string[]>()
  let active = first
  const rollback = active

  const mutation = runPromptRollbackMutation({
    prompt: rollback,
    prepare: () => prepared.promise,
    optimistic: (target, draft) => target.set(draft),
    request: async () => {},
    complete: () => {},
    rollback: () => {},
    fail: () => {},
  })

  active = second
  second.set(["edited second draft"])
  prepared.resolve(["restored first draft"])
  await mutation

  expect(first.current()).toEqual(["restored first draft"])
  expect(second.current()).toEqual(["edited second draft"])
})

test("restores the initiating prompt cursor when the request fails", async () => {
  const target = prompt(["original draft"], 7)

  await runPromptRollbackMutation({
    prompt: target,
    prepare: () => undefined,
    optimistic: (prompt) => prompt.reset(),
    request: async () => {
      throw new Error("request failed")
    },
    complete: () => {},
    rollback: () => {},
    fail: () => {},
  })

  expect(target.current()).toEqual(["original draft"])
  expect(target.cursor()).toBe(7)
})

test("rolls back prompt edits made while restore preparation is pending", async () => {
  const target = prompt(["original draft"], 7)
  const prepared = Promise.withResolvers<void>()
  const mutation = runPromptRollbackMutation({
    prompt: target,
    prepare: () => prepared.promise,
    optimistic: (prompt) => prompt.reset(),
    request: async () => {
      throw new Error("request failed")
    },
    complete: () => {},
    rollback: () => {},
    fail: () => {},
  })

  target.set(["edited during preparation"], 9)
  prepared.resolve()
  await mutation

  expect(target.current()).toEqual(["edited during preparation"])
  expect(target.cursor()).toBe(9)
})

test("reports preparation failures without changing the prompt", async () => {
  const target = prompt(["original draft"], 7)
  const error = new Error("prepare failed")
  let failed: unknown
  let optimistic = false

  await runPromptRollbackMutation({
    prompt: target,
    prepare: async () => {
      throw error
    },
    optimistic: () => {
      optimistic = true
    },
    request: async () => {},
    complete: () => {},
    rollback: () => {},
    fail: (cause) => {
      failed = cause
    },
  })

  expect(failed).toBe(error)
  expect(optimistic).toBe(false)
  expect(target.current()).toEqual(["original draft"])
  expect(target.cursor()).toBe(7)
})

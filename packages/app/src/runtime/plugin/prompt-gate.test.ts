import { afterEach, beforeEach, expect, jest, test } from "bun:test"
import type { SessionRef } from "@opencode/plugin/gui"
import { PROMPT_GATE_TIMEOUT_MS, settlePromptGates } from "./prompt-gate"

// SAFETY: the gates under test receive the ref and never read it.
const session = { key: "server\nses_alpha", id: "ses_alpha" } as SessionRef

beforeEach(() => void jest.useFakeTimers())

afterEach(() => void jest.useRealTimers())

// Runs the promise jobs queued so far, which the fake clock does not.
const settle = async (promise: Promise<void>) => {
  const state = { done: false }
  void promise.then(() => (state.done = true))

  // More turns than the longest chain here: a gate, allSettled, the race and its cleanup.
  for (const _ of Array.from({ length: 16 })) await Promise.resolve()

  return state.done
}

test("a send waits for every gate, and not for the timeout once they settled", async () => {
  const slow = Promise.withResolvers<void>()
  const signals: AbortSignal[] = []

  const waiting = settlePromptGates(
    [
      { ready: (input) => void signals.push(input.signal) },
      { ready: () => slow.promise },
      // A gate that throws or rejects is another plugin's fault, never the prompt's.
      { ready: () => Promise.reject(new Error("gate failed")) },
      {
        ready: () => {
          throw new Error("gate threw")
        },
      },
    ],
    session,
  )

  expect(await settle(waiting)).toBe(false)
  slow.resolve()
  expect(await settle(waiting)).toBe(true)
  // The host stopped waiting.
  expect(signals.map((signal) => signal.aborted)).toEqual([true])
})

test("a gate that never settles holds the send for the timeout and no longer", async () => {
  const signals: AbortSignal[] = []

  const waiting = settlePromptGates(
    [
      {
        ready: (input) => {
          signals.push(input.signal)

          return new Promise<void>(() => undefined)
        },
      },
    ],
    session,
  )

  jest.advanceTimersByTime(PROMPT_GATE_TIMEOUT_MS - 1)
  expect(await settle(waiting)).toBe(false)
  expect(signals[0]?.aborted).toBe(false)
  jest.advanceTimersByTime(1)
  expect(await settle(waiting)).toBe(true)
  expect(signals[0]?.aborted).toBe(true)
})

test("a send with no gate does not wait", async () => {
  expect(await settle(settlePromptGates([], session))).toBe(true)
})

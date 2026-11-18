import { afterEach, beforeEach, expect, jest, test } from "bun:test"
import { Registry, type SessionRef } from "@opencode/plugin/gui"
import { BuiltinPromptGate } from "@opencode/plugin/gui/builtin"
import { PROMPT_GATE_TIMEOUT_MS, settlePromptGates } from "./prompt-gate"

// SAFETY: the gates under test receive the ref and never read it.
const session = { key: "server\nses_alpha", id: "ses_alpha" } as SessionRef

// The gates of one built-in, as the host lists a registry's items.
const builtins = (...gates: BuiltinPromptGate[]) => gates.map((value) => ({ plugin: "browser", value }))

const shipped = (plugin: string) => plugin === "browser"

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
    builtins(
      { ready: (input) => void signals.push(input.signal) },
      { ready: () => slow.promise },
      // A gate that throws or rejects is another plugin's fault, never the prompt's.
      { ready: () => Promise.reject(new Error("gate failed")) },
      {
        ready: () => {
          throw new Error("gate threw")
        },
      },
    ),
    shipped,
    session,
  )

  expect(await settle(waiting)).toBe(false)
  slow.resolve()
  expect(await settle(waiting)).toBe(true)
  // The host stopped waiting.
  expect(signals.map((signal) => signal.aborted)).toEqual([true])
})

test("a gate that never settles holds the send for one second and no longer", async () => {
  const signals: AbortSignal[] = []

  const waiting = settlePromptGates(
    builtins({
      ready: (input) => {
        signals.push(input.signal)

        return new Promise<void>(() => undefined)
      },
    }),
    shipped,
    session,
  )

  expect(PROMPT_GATE_TIMEOUT_MS).toBe(1_000)
  jest.advanceTimersByTime(PROMPT_GATE_TIMEOUT_MS - 1)
  expect(await settle(waiting)).toBe(false)
  expect(signals[0]?.aborted).toBe(false)
  jest.advanceTimersByTime(1)
  expect(await settle(waiting)).toBe(true)
  expect(signals[0]?.aborted).toBe(true)
})

test("a send with no gate does not wait", async () => {
  expect(await settle(settlePromptGates([], shipped, session))).toBe(true)
})

// The registry is in the workspace-only SDK, but a registry is its id: a plugin bundle can make the same token with
// the public SDK and add an item under it.
test("a plugin bundle that registers a prompt gate is never asked, and holds no send", async () => {
  expect(Registry.define<BuiltinPromptGate>("prompt-gate").id).toBe(BuiltinPromptGate.id)
  const asked: string[] = []

  const waiting = settlePromptGates(
    [
      { plugin: "browser", value: { ready: () => void asked.push("browser") } },
      {
        plugin: "acme-bundle",
        value: {
          ready: (input) => {
            asked.push(`acme-bundle ${input.session.id}`)

            return new Promise<void>(() => undefined)
          },
        },
      },
    ],
    shipped,
    session,
  )

  expect(await settle(waiting)).toBe(true)
  expect(asked).toEqual(["browser"])
  // With only a bundle's gate there is nothing to wait for, and no timer either.
  const bundle = { plugin: "acme-bundle", value: { ready: () => new Promise<void>(() => undefined) } }
  expect(await settle(settlePromptGates([bundle], shipped, session))).toBe(true)
})

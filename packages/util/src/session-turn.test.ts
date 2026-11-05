import { expect, test } from "bun:test"
import { SessionTurn } from "./session-turn.js"

type Message = {
  id: string
  type: string
  time: { created: number; streamed?: number; completed?: number }
  tokens?: { output: number; reasoning: number }
}

test("measures turn duration from the user prompt across assistant steps", () => {
  const final = step("assistant-2", { created: 27_000, completed: 30_000 })
  const messages = [input("user-1", 1_000), step("assistant-1", { created: 8_000, completed: 11_000 }), final]

  expect(SessionTurn.duration(messages, final)).toBe(29_000)
})

test("measures request throughput including reasoning without tool time", () => {
  const first = step("assistant-1", { created: 6_000, streamed: 10_000, completed: 20_000 }, 20, 5)
  const final = step("assistant-2", { created: 24_000, streamed: 30_000, completed: 31_000 }, 30, 10)
  const messages = [input("user-1", 1_000), first, final]

  expect(SessionTurn.tokensPerSecond(messages, final)).toBe(6.5)
  first.time.streamed = undefined
  expect(SessionTurn.tokensPerSecond(messages, final)).toBeUndefined()
})

test("omits turn throughput when a stream boundary is unavailable", () => {
  const final = step("assistant-1", { created: 1 }, 20)
  expect(SessionTurn.tokensPerSecond([final], final)).toBeUndefined()
})

test.each([false, true])(
  "measures historical footers without later inputs or incomplete steps (indexed: %s)",
  (indexed) => {
    const timed = (id: string, created: number, streamed: number, completed: number, output: number) =>
      step(id, { created, streamed, completed }, output, 2)
    const messages: Message[] = [
      timed("before-input", 0, 1_000, 2_000, 5),
      input("input", 3_000),
      timed("first-step", 4_000, 5_000, 6_000, 10),
      { type: "system", id: "system", time: { created: 6_500 } },
      timed("second-step", 7_000, 8_000, 9_000, 20),
      { type: "synthetic", id: "synthetic", time: { created: 10_000 } },
      timed("after-synthetic", 11_000, 13_000, 14_000, 12),
      input("later-input", 15_000),
      step("incomplete", { created: 1 }),
    ]

    expect(
      messages.flatMap((message, index) => {
        if (message.type !== "assistant") return []
        const options = { index: indexed ? index : undefined }
        return [
          [SessionTurn.duration(messages, message, options), SessionTurn.tokensPerSecond(messages, message, options)],
        ]
      }),
    ).toEqual([
      [2_000, 7],
      [3_000, 12],
      [6_000, 17],
      [4_000, 7],
      [0, undefined],
    ])
  },
)

test("preserves missing-anchor fallbacks without including the absent assistant's tokens", () => {
  const absent = step("absent", { created: 8_000, streamed: 9_000, completed: 10_000 }, 900)
  const stored = step("stored", { created: 6_000, streamed: 8_000, completed: 9_000 }, 20)
  const prompt = input("input", 5_000)

  expect(SessionTurn.duration([prompt, stored], absent)).toBe(5_000)
  expect(SessionTurn.tokensPerSecond([prompt, stored], absent)).toBe(10)
  expect(SessionTurn.duration([stored], absent)).toBe(2_000)
  expect(SessionTurn.tokensPerSecond([stored], absent)).toBe(10)
  expect(SessionTurn.duration([], absent)).toBe(2_000)
  expect(SessionTurn.tokensPerSecond([], absent)).toBeUndefined()
})

test("measures a marker-era turn from its first prompt across steers", () => {
  const timed = (id: string, created: number, streamed: number, completed: number, output: number) =>
    step(id, { created, streamed, completed }, output)
  const final = timed("second-step", 8_000, 9_000, 10_000, 20)
  const messages: Message[] = [
    input("old-input", 0),
    timed("old-step", 1_000, 2_000, 3_000, 5),
    { type: "idle", id: "idle-1", time: { created: 3_500 } },
    input("input", 4_000),
    timed("first-step", 5_000, 6_000, 7_000, 10),
    input("steer", 7_500),
    final,
  ]

  expect(SessionTurn.legacy(messages)).toBe(false)
  expect(SessionTurn.duration(messages, final)).toBe(6_000)
  expect(SessionTurn.tokensPerSecond(messages, final)).toBe(15)
  expect(SessionTurn.duration(messages, final, { index: 6, legacy: true })).toBe(2_500)
  expect(SessionTurn.tokensPerSecond(messages, final, { index: 6, legacy: true })).toBe(20)
})

function input(id: string, created: number): Message {
  return { type: "user", id, time: { created } }
}

function step(id: string, time: Message["time"], output?: number, reasoning = 0): Message {
  return {
    type: "assistant",
    id,
    time,
    tokens: output === undefined ? undefined : { output, reasoning },
  }
}

import { describe, expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { LLMEvent } from "@opencode-ai/llm"
import { splitThink } from "../../src/llm/think"

function textEvents(pieces: string[]): LLMEvent[] {
  return [
    LLMEvent.stepStart({ index: 0 }),
    LLMEvent.textStart({ id: "text-0" }),
    ...pieces.map((text) => LLMEvent.textDelta({ id: "text-0", text })),
    LLMEvent.textEnd({ id: "text-0" }),
    LLMEvent.stepFinish({ index: 0, reason: "stop" }),
    LLMEvent.finish({ reason: "stop" }),
  ]
}

function run(pieces: string[], state = { inside: false }) {
  return Effect.runPromise(Stream.runCollect(splitThink(Stream.fromArray(textEvents(pieces)), state)))
}

function joined(events: readonly LLMEvent[], type: "text-delta" | "reasoning-delta") {
  return events.flatMap((event) => (event.type === type ? [event.text] : [])).join("")
}

describe("splitThink", () => {
  const input = "<think>plan a < b and </thi ok</think>\n\nThe answer is <b>42</b>."

  test("tags split across delta boundaries at every offset", async () => {
    for (const at of Array.from({ length: input.length - 1 }, (_, i) => i + 1)) {
      const events = await run([input.slice(0, at), input.slice(at)])
      expect(joined(events, "reasoning-delta")).toBe("plan a < b and </thi ok")
      expect(joined(events, "text-delta")).toBe("The answer is <b>42</b>.")
    }
  })

  test("one char per delta: partial tail never leaks and never exceeds the tag length", async () => {
    const events = await run([...input])
    const deltas = events.filter((event) => event.type === "text-delta" || event.type === "reasoning-delta")
    expect(deltas.every((event) => !event.text.includes("<think>") && !event.text.includes("</think>"))).toBe(true)
    expect(joined(events, "text-delta")).toBe("The answer is <b>42</b>.")
    expect(joined(events, "reasoning-delta")).toBe("plan a < b and </thi ok")
  })

  test("block lifecycle: reasoning closes before text starts; finish events pass through", async () => {
    const types = (await run(["<think>a</think>b"])).map((event) => event.type)
    expect(types).toEqual([
      "step-start", "reasoning-start", "reasoning-delta", "reasoning-end",
      "text-start", "text-delta", "text-end", "step-finish", "finish",
    ])
  })

  test("text without tags is unchanged, including a trailing partial '<thi' flushed at the end", async () => {
    const events = await run(["hello <th", "i"])
    expect(joined(events, "text-delta")).toBe("hello <thi")
    expect(joined(events, "reasoning-delta")).toBe("")
  })

  test("a turn that ends inside <think> is detected", async () => {
    const state = { inside: false }
    const events = await run(["<think>still going", " and going"], state)
    expect(state.inside).toBe(true)
    const end = events.find((event) => event.type === "reasoning-end")
    expect(end?.type === "reasoning-end" && end.providerMetadata?.oclite?.unterminated).toBe(true)
    expect(joined(events, "text-delta")).toBe("")

    const closed = { inside: false }
    await run(["<think>x</think>y"], closed)
    expect(closed.inside).toBe(false)
  })

  test("non-text events pass through untouched", async () => {
    const call = LLMEvent.toolCall({ id: "c1", name: "read", input: { filePath: "a" } })
    const events = await Effect.runPromise(Stream.runCollect(splitThink(Stream.make(call, LLMEvent.finish({ reason: "tool-calls" })))))
    expect(events).toEqual([call, LLMEvent.finish({ reason: "tool-calls" })])
  })
})

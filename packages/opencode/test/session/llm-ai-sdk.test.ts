import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { LLMAISDK } from "@/session/llm/ai-sdk"

describe("session.llm.ai-sdk adapter", () => {
  type AISDKAdapterEvent = Parameters<typeof LLMAISDK.toLLMEvents>[1]

  const adapt = (events: ReadonlyArray<AISDKAdapterEvent>) => {
    const state = LLMAISDK.adapterState()
    return Effect.runPromise(
      Effect.forEach(events, (event) => LLMAISDK.toLLMEvents(state, event)).pipe(Effect.map((items) => items.flat())),
    )
  }

  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- tests defensive adapter branches outside AI SDK's current typed surface
  const uncheckedAdapterEvent = (input: unknown) => input as AISDKAdapterEvent

  test("keeps the AI SDK tool-result name when the local name cache is missing", async () => {
    const events = await adapt([
      uncheckedAdapterEvent({
        type: "tool-result",
        toolCallId: "call_123",
        toolName: "bash",
        output: { title: "Bash", output: "done", metadata: {} },
      }),
    ])

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: "tool-result",
      id: "call_123",
      name: "bash",
    })
  })
})

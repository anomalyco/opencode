import { describe, expect, test } from "bun:test"
import { streamText, type ModelMessage } from "ai"
import {
  advice,
  encrypted,
  unavailable,
  call,
  callID,
  collect,
  executor,
  model,
  provider,
  read,
  response,
  result,
} from "../fixture/advisor"

const question: ModelMessage = { role: "user", content: "Inspect the fixture." }
const pending: ModelMessage = {
  role: "assistant",
  content: [{ type: "tool-call", toolCallId: callID, toolName: "advisor", input: {}, providerExecuted: true }],
}

describe("Anthropic advisor SDK contract", () => {
  for (const value of [advice, encrypted, unavailable]) {
    test(`streams ${value.type} as a provider-executed outcome`, async () => {
      const fixture = provider([response([call, result(value), { type: "text", text: "Continuing." }])])
      const stream = streamText({
        model: fixture.client(executor),
        tools: { advisor: fixture.advisor },
        messages: [question],
      })
      const events = await Array.fromAsync(stream.fullStream)
      expect(
        events.find(
          (event) => event.type === (value.type === "advisor_tool_result_error" ? "tool-error" : "tool-result"),
        ),
      ).toMatchObject({
        toolName: "advisor",
        toolCallId: callID,
        ...(value.type === "advisor_tool_result_error" ? { error: value } : { output: value }),
        providerExecuted: true,
      })
      expect(events.some((event) => event.type === "error")).toBe(false)
      expect(fixture.requests).toHaveLength(1)
      expect(JSON.parse(fixture.requests[0].body).tools).toContainEqual({
        type: "advisor_20260301",
        name: "advisor",
        model,
        max_uses: 3,
      })
      expect(fixture.requests[0].headers.get("anthropic-beta")).toContain("advisor-tool-2026-03-01")
      expect(await stream.providerMetadata).toMatchObject({
        anthropic: {
          iterations: expect.arrayContaining([expect.objectContaining({ type: "advisor_message", model })]),
        },
      })
    })
  }

  test("retains a pending call and the raw pause reason", async () => {
    const fixture = provider([response([call], "pause_turn")])
    const stream = streamText({
      model: fixture.client(executor),
      tools: { advisor: fixture.advisor },
      messages: [question],
    })
    const events = await Array.fromAsync(stream.fullStream)
    expect(events.find((event) => event.type === "tool-call")).toMatchObject({
      toolCallId: callID,
      toolName: "advisor",
      providerExecuted: true,
    })
    expect(events.find((event) => event.type === "finish-step")).toMatchObject({
      finishReason: "stop",
      rawFinishReason: "pause_turn",
    })
    expect(
      events.some((event) => event.type === "tool-result" || event.type === "tool-error" || event.type === "error"),
    ).toBe(false)
  })

  test("returns a result for a call from the previous request", async () => {
    const fixture = provider([response([result(advice), { type: "text", text: "Continuing." }])])
    const stream = streamText({
      model: fixture.client(executor),
      tools: { advisor: fixture.advisor },
      messages: [question, pending],
    })
    const events = await Array.fromAsync(stream.fullStream)
    expect(events.some((event) => event.type === "tool-call")).toBe(false)
    expect(events.find((event) => event.type === "tool-result")).toMatchObject({
      toolCallId: callID,
      toolName: "advisor",
      output: advice,
      providerExecuted: true,
    })
    expect(events.some((event) => event.type === "error")).toBe(false)
  })

  test("keeps pending advisor work separate from local tool calls", async () => {
    const fixture = provider([response([call, read], "tool_use")])
    const stream = await fixture.client(executor).doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "Inspect fixture." }] }],
      tools: [
        { type: "provider", id: "anthropic.advisor_20260301", name: "advisor", args: { model, maxUses: 3 } },
        {
          type: "function",
          name: "read",
          inputSchema: { type: "object", properties: { filePath: { type: "string" } } },
        },
      ],
    })
    const events = await collect(stream.stream)
    expect(events.filter((event) => event.type === "tool-call")).toMatchObject([
      { toolName: "advisor", providerExecuted: true },
      { toolName: "read", input: JSON.stringify({ filePath: "pool.ts" }) },
    ])
    expect(events.some((event) => event.type === "tool-result")).toBe(false)
  })

  for (const value of [advice, encrypted, unavailable]) {
    test(`replays ${value.type} without advertising new consultation`, async () => {
      const fixture = provider([response([{ type: "text", text: "Done." }])])
      const stream = await fixture.client(executor).doStream({
        prompt: [
          { role: "user", content: [{ type: "text", text: "Inspect fixture." }] },
          {
            role: "assistant",
            content: [
              { type: "tool-call", toolCallId: callID, toolName: "advisor", input: {}, providerExecuted: true },
              {
                type: "tool-result",
                toolCallId: callID,
                toolName: "advisor",
                output: { type: value.type === "advisor_tool_result_error" ? "error-json" : "json", value },
              },
            ],
          },
          { role: "user", content: [{ type: "text", text: "Continue without consulting." }] },
        ],
        headers: { "anthropic-beta": "advisor-tool-2026-03-01" },
      })
      const events = await collect(stream.stream)
      const body = JSON.parse(fixture.requests[0].body)
      expect(body.messages[1].content).toEqual([call, result(value)])
      expect(body.tools ?? []).toEqual([])
      expect(fixture.requests[0].headers.get("anthropic-beta")).toContain("advisor-tool-2026-03-01")
      expect(events.find((event) => event.type === "stream-start")).toMatchObject({ warnings: [] })
    })
  }
})

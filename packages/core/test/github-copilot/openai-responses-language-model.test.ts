import { OpenAIResponsesLanguageModel } from "@opencode-ai/core/github-copilot/responses/openai-responses-language-model"
import { convertToOpenAIResponsesInput } from "@opencode-ai/core/github-copilot/responses/convert-to-openai-responses-input"
import { describe, test, expect, mock } from "bun:test"
import type { LanguageModelV3Prompt, LanguageModelV3StreamPart } from "@ai-sdk/provider"

const TEST_PROMPT: LanguageModelV3Prompt = [{ role: "user", content: [{ type: "text", text: "Hello" }] }]

function createMockFetch(body: unknown) {
  return mock(
    async () => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }),
  )
}

function createStreamFetch(events: ReadonlyArray<Record<string, unknown>>) {
  return mock(
    async () =>
      new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
  )
}

function createModel(fetchFn: ReturnType<typeof mock>) {
  return new OpenAIResponsesLanguageModel("test-model", {
    provider: "copilot",
    url: () => "https://api.test.com/responses",
    headers: () => ({ Authorization: "Bearer test-token" }),
    fetch: fetchFn as any,
  })
}

// GitHub Copilot's Responses model echoes item metadata (itemId, reasoningEncryptedContent,
// responseId, ...) under the "copilot" providerOptions/providerMetadata namespace, matching the
// namespace request options already use. It used to echo this metadata under "openai" (a leftover
// from forking the OpenAI Responses model), which left it unreachable by anything reading the
// "copilot" namespace and let stale itemIds slip past stripping meant for that namespace.
describe("doGenerate", () => {
  test("attaches item metadata under the copilot namespace, not openai", async () => {
    const mockFetch = createMockFetch({
      id: "resp_1",
      created_at: 0,
      model: "gpt-5.5",
      output: [
        {
          type: "reasoning",
          id: "rs_1",
          encrypted_content: "enc_1",
          summary: [{ type: "summary_text", text: "thinking..." }],
        },
        {
          type: "message",
          role: "assistant",
          id: "msg_1",
          content: [{ type: "output_text", text: "Hello there", annotations: [] }],
        },
        {
          type: "function_call",
          call_id: "call_1",
          name: "bash",
          arguments: "{}",
          id: "fc_1",
        },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    })
    const model = createModel(mockFetch)

    const { content, providerMetadata } = await model.doGenerate({
      prompt: TEST_PROMPT,
      includeRawChunks: false,
    } as any)

    const reasoning = content.find((part: any) => part.type === "reasoning") as any
    expect(reasoning.providerMetadata?.copilot?.itemId).toBe("rs_1")
    expect(reasoning.providerMetadata?.copilot?.reasoningEncryptedContent).toBe("enc_1")
    expect(reasoning.providerMetadata?.openai).toBeUndefined()

    const text = content.find((part: any) => part.type === "text") as any
    expect(text.providerMetadata?.copilot?.itemId).toBe("msg_1")
    expect(text.providerMetadata?.openai).toBeUndefined()

    const toolCall = content.find((part: any) => part.type === "tool-call") as any
    expect(toolCall.providerMetadata?.copilot?.itemId).toBe("fc_1")
    expect(toolCall.providerMetadata?.openai).toBeUndefined()

    expect(providerMetadata?.copilot?.responseId).toBe("resp_1")
    expect(providerMetadata?.openai).toBeUndefined()
  })

  test("defaults to stateless encrypted reasoning and keeps previousResponseId opt-in", async () => {
    const requests: Array<Record<string, unknown>> = []
    const fetchFn = mock(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      requests.push(JSON.parse(init?.body as string))
      return new Response(
        JSON.stringify({
          id: "resp_1",
          created_at: 0,
          model: "gpt-5.5",
          output: [],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    })
    const model = createModel(fetchFn)

    await model.doGenerate({ prompt: TEST_PROMPT, includeRawChunks: false } as any)
    await model.doGenerate({
      prompt: TEST_PROMPT,
      includeRawChunks: false,
      providerOptions: { copilot: { previousResponseId: "resp_previous", store: false } },
    } as any)
    await model.doGenerate({
      prompt: TEST_PROMPT,
      includeRawChunks: false,
      providerOptions: { copilot: { store: true } },
    } as any)

    expect(requests[0]?.previous_response_id).toBeUndefined()
    expect(requests[0]?.store).toBe(false)
    expect(requests[0]?.include).toEqual(["reasoning.encrypted_content"])
    expect(requests[1]?.previous_response_id).toBe("resp_previous")
    expect(requests[1]?.store).toBe(false)
    expect(requests[1]?.include).toEqual(["reasoning.encrypted_content"])
    expect(requests[2]?.store).toBe(true)
    expect(requests[2]?.include).toEqual(["reasoning.encrypted_content"])
  })
})

describe("doStream", () => {
  test("streams sequential Copilot reasoning summary blocks", async () => {
    const model = createModel(
      createStreamFetch([
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "reasoning", id: "rs_1", encrypted_content: null },
        },
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "reasoning", id: "rs_rotated", encrypted_content: null },
        },
        { type: "response.reasoning_summary_part.added", item_id: "rs_1", summary_index: 0 },
        { type: "response.reasoning_summary_text.delta", item_id: "rs_1", summary_index: 0, delta: "First" },
        { type: "response.reasoning_summary_part.done", item_id: "rs_1", summary_index: 0 },
        { type: "response.reasoning_summary_part.added", item_id: "rs_1", summary_index: 1 },
        { type: "response.reasoning_summary_part.added", item_id: "rs_1", summary_index: 1 },
        { type: "response.reasoning_summary_text.delta", item_id: "rs_1", summary_index: 1, delta: "Second" },
        { type: "response.reasoning_summary_part.done", item_id: "rs_1", summary_index: 1 },
        {
          type: "response.output_item.done",
          output_index: 0,
          item: { type: "reasoning", id: "rs_rotated", encrypted_content: "encrypted-state" },
        },
      ]),
    )
    const result = await model.doStream({
      prompt: TEST_PROMPT,
      includeRawChunks: false,
      providerOptions: { copilot: { store: false } },
    } as any)
    const reader = result.stream.getReader()
    const events: LanguageModelV3StreamPart[] = []
    while (true) {
      const item = await reader.read()
      if (item.done) break
      if (item.value.type.startsWith("reasoning-")) events.push(item.value)
    }

    expect(events).toMatchObject([
      {
        type: "reasoning-start",
        id: "rs_1:0",
        providerMetadata: { copilot: { itemId: "rs_1", reasoningEncryptedContent: null } },
      },
      { type: "reasoning-delta", id: "rs_1:0", delta: "First" },
      { type: "reasoning-end", id: "rs_1:0", providerMetadata: { copilot: { itemId: "rs_1" } } },
      {
        type: "reasoning-start",
        id: "rs_1:1",
        providerMetadata: { copilot: { itemId: "rs_1", reasoningEncryptedContent: null } },
      },
      { type: "reasoning-delta", id: "rs_1:1", delta: "Second" },
      {
        type: "reasoning-end",
        id: "rs_1:1",
        providerMetadata: { copilot: { itemId: "rs_rotated", reasoningEncryptedContent: "encrypted-state" } },
      },
    ])

    const deltas = new Map(
      events.filter((event) => event.type === "reasoning-delta").map((event) => [event.id, event.delta] as const),
    )
    const { input } = await convertToOpenAIResponsesInput({
      prompt: [
        {
          role: "assistant",
          content: events
            .filter((event) => event.type === "reasoning-end")
            .map((event) => ({
              type: "reasoning" as const,
              text: deltas.get(event.id) ?? "",
              providerOptions: event.providerMetadata,
            })),
        },
      ],
      systemMessageMode: "system",
      store: false,
    })
    expect(input).toEqual([
      {
        type: "reasoning",
        id: "rs_rotated",
        encrypted_content: "encrypted-state",
        summary: [],
      },
    ])
  })

  test("closes reasoning when a Copilot stream ends before output_item.done", async () => {
    const model = createModel(
      createStreamFetch([
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "reasoning", id: "rs_1", encrypted_content: null },
        },
        { type: "response.reasoning_summary_text.delta", item_id: "rs_rotated", summary_index: 0, delta: "First" },
      ]),
    )
    const result = await model.doStream({
      prompt: TEST_PROMPT,
      includeRawChunks: false,
      providerOptions: { copilot: { store: false } },
    } as any)
    const reader = result.stream.getReader()
    const events: LanguageModelV3StreamPart[] = []
    while (true) {
      const item = await reader.read()
      if (item.done) break
      if (item.value.type.startsWith("reasoning-")) events.push(item.value)
    }

    expect(events.map((event) => event.type)).toEqual(["reasoning-start", "reasoning-delta", "reasoning-end"])
    expect(events.at(-1)).toMatchObject({
      type: "reasoning-end",
      id: "rs_1:0",
      providerMetadata: { copilot: { itemId: "rs_1" } },
    })
  })
})

describe("convertToOpenAIResponsesInput", () => {
  test("omits response item IDs from stateless function calls", async () => {
    const { input } = await convertToOpenAIResponsesInput({
      prompt: [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call_1",
              toolName: "bash",
              input: { command: "ls" },
              providerOptions: { copilot: { itemId: "fc_999" } },
            },
          ],
        },
      ],
      systemMessageMode: "system",
      store: false,
    })

    expect(input).toEqual([
      {
        type: "function_call",
        call_id: "call_1",
        name: "bash",
        arguments: JSON.stringify({ command: "ls" }),
      },
    ])
  })

  test("preserves response item IDs for stored function calls", async () => {
    const { input } = await convertToOpenAIResponsesInput({
      prompt: [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call_1",
              toolName: "bash",
              input: { command: "ls" },
              providerOptions: { copilot: { itemId: "fc_999" } },
            },
          ],
        },
      ],
      systemMessageMode: "system",
      store: true,
    })

    expect((input[0] as any).id).toBe("fc_999")
  })

  test("preserves reasoning items keyed by the copilot namespace instead of dropping them", async () => {
    const { input, warnings } = await convertToOpenAIResponsesInput({
      prompt: [
        {
          role: "assistant",
          content: [
            {
              type: "reasoning",
              text: "thinking...",
              providerOptions: { copilot: { itemId: "rs_1", reasoningEncryptedContent: "enc_1" } },
            },
          ],
        },
      ],
      systemMessageMode: "system",
      store: false,
    })

    expect(warnings).toEqual([])
    expect(input).toEqual([
      {
        type: "reasoning",
        id: "rs_1",
        encrypted_content: "enc_1",
        summary: [],
      },
    ])
  })

  test("drops encrypted reasoning with no completed copilot itemId", async () => {
    const { input, warnings } = await convertToOpenAIResponsesInput({
      prompt: [
        {
          role: "assistant",
          content: [
            {
              type: "reasoning",
              text: "thinking...",
              providerOptions: { copilot: { reasoningEncryptedContent: "enc_1" } },
            },
          ],
        },
      ],
      systemMessageMode: "system",
      store: false,
    })

    expect(input).toEqual([])
    expect(warnings).toHaveLength(1)
  })

  test("drops reasoning with neither a copilot itemId nor encrypted content", async () => {
    const { input, warnings } = await convertToOpenAIResponsesInput({
      prompt: [
        {
          role: "assistant",
          content: [{ type: "reasoning", text: "thinking...", providerOptions: {} }],
        },
      ],
      systemMessageMode: "system",
      store: false,
    })

    expect(input).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({
      message: expect.stringContaining("Non-OpenAI reasoning parts are not supported"),
    })
  })

  test("reads imageDetail from the copilot namespace on user file parts", async () => {
    const { input } = await convertToOpenAIResponsesInput({
      prompt: [
        {
          role: "user",
          content: [
            {
              type: "file",
              mediaType: "image/png",
              data: "aGVsbG8=",
              providerOptions: { copilot: { imageDetail: "high" } },
            },
          ],
        },
      ],
      systemMessageMode: "system",
      store: false,
    })

    expect((input[0] as any).content[0].detail).toBe("high")
  })
})

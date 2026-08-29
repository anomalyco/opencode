import { OpenAIResponsesLanguageModel } from "@opencode-ai/core/github-copilot/responses/openai-responses-language-model"
import { convertToOpenAIResponsesInput } from "@opencode-ai/core/github-copilot/responses/convert-to-openai-responses-input"
import { describe, test, expect, mock } from "bun:test"
import type { LanguageModelV3Prompt, LanguageModelV3ProviderTool, LanguageModelV3StreamPart } from "@ai-sdk/provider"

const TEST_PROMPT: LanguageModelV3Prompt = [{ role: "user", content: [{ type: "text", text: "Hello" }] }]

const HOSTED_TOOL_CASES = [
  {
    id: "openai.web_search",
    name: "current_web",
    args: {},
    wireType: "web_search",
    output: {
      type: "web_search_call",
      id: "web_1",
      status: "completed",
      action: { type: "search", query: "news" },
    },
    stream: [
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "web_search_call",
          id: "web_1",
          status: "in_progress",
          action: { type: "search", query: "news" },
        },
      },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "web_search_call",
          id: "web_1",
          status: "completed",
          action: { type: "search", query: "news" },
        },
      },
    ],
    streamEventTypes: ["tool-input-start", "tool-input-end", "tool-call", "tool-result"],
    eventTypes: ["tool-input-start", "tool-call", "tool-result"],
  },
  {
    id: "openai.web_search_preview",
    name: "preview_web",
    args: {},
    wireType: "web_search_preview",
    output: {
      type: "web_search_call",
      id: "preview_1",
      status: "completed",
      action: { type: "search", query: "news" },
    },
    stream: [
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "web_search_call",
          id: "preview_1",
          status: "in_progress",
          action: { type: "search", query: "news" },
        },
      },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "web_search_call",
          id: "preview_1",
          status: "completed",
          action: { type: "search", query: "news" },
        },
      },
    ],
    streamEventTypes: ["tool-input-start", "tool-input-end", "tool-call", "tool-result"],
    eventTypes: ["tool-input-start", "tool-call", "tool-result"],
  },
  {
    id: "openai.file_search",
    name: "documents",
    args: { vectorStoreIds: ["store_1"] },
    wireType: "file_search",
    output: { type: "file_search_call", id: "file_1", queries: ["news"], results: null },
    stream: [
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { type: "file_search_call", id: "file_1" },
      },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: { type: "file_search_call", id: "file_1", queries: ["news"], results: null },
      },
    ],
    streamEventTypes: ["tool-call", "tool-result"],
    eventTypes: ["tool-call", "tool-result"],
  },
  {
    id: "openai.code_interpreter",
    name: "python",
    args: {},
    wireType: "code_interpreter",
    output: {
      type: "code_interpreter_call",
      id: "code_1",
      code: "print(1)",
      container_id: "container_1",
      outputs: null,
    },
    stream: [
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "code_interpreter_call",
          id: "code_1",
          code: null,
          container_id: "container_1",
          outputs: null,
          status: "in_progress",
        },
      },
      {
        type: "response.code_interpreter_call_code.delta",
        item_id: "code_1",
        output_index: 0,
        delta: "print(",
      },
      {
        type: "response.code_interpreter_call_code.done",
        item_id: "code_1",
        output_index: 0,
        code: "print(1)",
      },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "code_interpreter_call",
          id: "code_1",
          code: "print(1)",
          container_id: "container_1",
          outputs: null,
        },
      },
    ],
    streamEventTypes: [
      "tool-input-start",
      "tool-input-delta",
      "tool-input-delta",
      "tool-input-delta",
      "tool-input-end",
      "tool-call",
      "tool-result",
    ],
    eventTypes: ["tool-input-start", "tool-call", "tool-result"],
  },
  {
    id: "openai.image_generation",
    name: "illustrate",
    args: {},
    wireType: "image_generation",
    output: { type: "image_generation_call", id: "image_1", result: "final-image" },
    stream: [
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { type: "image_generation_call", id: "image_1" },
      },
      {
        type: "response.image_generation_call.partial_image",
        item_id: "image_1",
        output_index: 0,
        partial_image_b64: "partial-image",
      },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: { type: "image_generation_call", id: "image_1", result: "final-image" },
      },
    ],
    streamEventTypes: ["tool-call", "tool-result", "tool-result"],
    eventTypes: ["tool-call", "tool-result", "tool-result"],
  },
] as const

function hostedTool(testCase: (typeof HOSTED_TOOL_CASES)[number]): LanguageModelV3ProviderTool {
  return { type: "provider", id: testCase.id, name: testCase.name, args: testCase.args }
}

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

async function readStream(stream: ReadableStream<LanguageModelV3StreamPart>) {
  const reader = stream.getReader()
  const events: LanguageModelV3StreamPart[] = []
  while (true) {
    const item = await reader.read()
    if (item.done) return events
    events.push(item.value)
  }
}

// GitHub Copilot's Responses model echoes item metadata (itemId, reasoningEncryptedContent,
// responseId, ...) under the "copilot" providerOptions/providerMetadata namespace, matching the
// namespace request options already use. It used to echo this metadata under "openai" (a leftover
// from forking the OpenAI Responses model), which left it unreachable by anything reading the
// "copilot" namespace and let stale itemIds slip past stripping meant for that namespace.
describe("doGenerate", () => {
  test.each([...HOSTED_TOOL_CASES])("forces $id by its declared logical name", async (testCase) => {
    const requests: unknown[] = []
    const model = createModel(
      mock(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        requests.push(await new Response(init?.body).json())
        return new Response(
          JSON.stringify({
            id: "resp_1",
            created_at: 0,
            model: "test-model",
            output: [],
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }),
    )

    await model.doGenerate({
      prompt: TEST_PROMPT,
      tools: [hostedTool(testCase)],
      toolChoice: { type: "tool", toolName: testCase.name },
    })

    expect(requests[0]).toMatchObject({ tool_choice: { type: testCase.wireType } })
  })

  test("does not mistake a colliding function name for a hosted tool", async () => {
    const requests: unknown[] = []
    const model = createModel(
      mock(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        requests.push(await new Response(init?.body).json())
        return new Response(
          JSON.stringify({
            id: "resp_1",
            created_at: 0,
            model: "test-model",
            output: [],
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }),
    )
    await model.doGenerate({
      prompt: TEST_PROMPT,
      tools: [
        { type: "provider", id: "openai.web_search", name: "lookup", args: {} },
        { type: "function", name: "web_search", inputSchema: { type: "object" } },
      ],
      toolChoice: { type: "tool", toolName: "web_search" },
    })

    expect(requests[0]).toMatchObject({ tool_choice: { type: "function", name: "web_search" } })
  })

  test.each([...HOSTED_TOOL_CASES])("uses $name for generated $id calls and results", async (testCase) => {
    const model = createModel(
      createMockFetch({
        id: "resp_1",
        created_at: 0,
        model: "test-model",
        output: [testCase.output],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    )

    const result = await model.doGenerate({ prompt: TEST_PROMPT, tools: [hostedTool(testCase)] })

    expect(result.content.filter((part) => part.type === "tool-call" || part.type === "tool-result")).toMatchObject([
      { type: "tool-call", toolName: testCase.name },
      { type: "tool-result", toolName: testCase.name },
    ])
  })

  test("uses canonical names only when no hosted declaration matches", async () => {
    const model = createModel(
      createMockFetch({
        id: "resp_1",
        created_at: 0,
        model: "test-model",
        output: [
          HOSTED_TOOL_CASES[0].output,
          HOSTED_TOOL_CASES[2].output,
          HOSTED_TOOL_CASES[3].output,
          HOSTED_TOOL_CASES[4].output,
          { type: "computer_call", id: "computer_1", status: "completed" },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    )

    const result = await model.doGenerate({ prompt: TEST_PROMPT })

    expect(result.content.filter((part) => part.type === "tool-call").map((part) => part.toolName)).toEqual([
      "web_search",
      "file_search",
      "code_interpreter",
      "image_generation",
      "computer_use",
    ])
  })

  test("rejects an automatic web response when both variants have different logical names", async () => {
    const model = createModel(
      createMockFetch({
        id: "resp_1",
        created_at: 0,
        model: "test-model",
        output: [HOSTED_TOOL_CASES[0].output],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    )

    await expect(
      model.doGenerate({
        prompt: TEST_PROMPT,
        tools: [hostedTool(HOSTED_TOOL_CASES[0]), hostedTool(HOSTED_TOOL_CASES[1])],
      }),
    ).rejects.toThrow("ambiguous web_search response for hosted tools: current_web, preview_web")
  })

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
  test.each([...HOSTED_TOOL_CASES])("uses $name for every streamed $id identity event", async (testCase) => {
    const model = createModel(createStreamFetch(testCase.stream))
    const result = await model.doStream({
      prompt: TEST_PROMPT,
      tools: [hostedTool(testCase)],
    })
    const streamEvents = (await readStream(result.stream)).filter(
      (event) => event.type !== "stream-start" && event.type !== "finish",
    )
    const events = streamEvents.filter((event) => "toolName" in event)

    expect(streamEvents.map((event) => event.type)).toEqual([...testCase.streamEventTypes])
    expect(events.map((event) => event.type)).toEqual([...testCase.eventTypes])
    expect(events.map((event) => event.toolName)).toEqual(testCase.eventTypes.map(() => testCase.name))
  })

  test("uses the forced web variant's logical name when both variants are declared", async () => {
    const model = createModel(createStreamFetch(HOSTED_TOOL_CASES[1].stream))

    const result = await model.doStream({
      prompt: TEST_PROMPT,
      tools: [hostedTool(HOSTED_TOOL_CASES[0]), hostedTool(HOSTED_TOOL_CASES[1])],
      toolChoice: { type: "tool", toolName: "preview_web" },
    })
    const events = (await readStream(result.stream)).filter((event) => "toolName" in event)

    expect(events.map((event) => event.toolName)).toEqual(["preview_web", "preview_web", "preview_web"])
  })

  test("rejects ambiguous web variants before fetching or exposing a stream", async () => {
    const fetchFn = createStreamFetch(HOSTED_TOOL_CASES[0].stream)
    const model = createModel(fetchFn)

    await expect(
      model.doStream({
        prompt: TEST_PROMPT,
        tools: [hostedTool(HOSTED_TOOL_CASES[0]), hostedTool(HOSTED_TOOL_CASES[1])],
      }),
    ).rejects.toThrow("ambiguous web_search response for hosted tools")
    expect(fetchFn).not.toHaveBeenCalled()
  })

  test("rejects an ambiguous forced wire choice before fetching or exposing a stream", async () => {
    const fetchFn = createStreamFetch(HOSTED_TOOL_CASES[0].stream)
    const model = createModel(fetchFn)

    await expect(
      model.doStream({
        prompt: TEST_PROMPT,
        tools: [hostedTool(HOSTED_TOOL_CASES[0]), { ...hostedTool(HOSTED_TOOL_CASES[0]), name: "backup_web" }],
        toolChoice: { type: "tool", toolName: HOSTED_TOOL_CASES[0].name },
      }),
    ).rejects.toThrow("ambiguous web_search tool choice for hosted tools")
    expect(fetchFn).not.toHaveBeenCalled()
  })

  test("streams a shared logical name for both web variants", async () => {
    const model = createModel(createStreamFetch(HOSTED_TOOL_CASES[0].stream))
    const tools = [hostedTool(HOSTED_TOOL_CASES[0]), hostedTool(HOSTED_TOOL_CASES[1])].map((tool) => ({
      ...tool,
      name: "web",
    }))

    const result = await model.doStream({ prompt: TEST_PROMPT, tools })
    const events = (await readStream(result.stream)).filter((event) => "toolName" in event)

    expect(events.map((event) => event.toolName)).toEqual(["web", "web", "web"])
  })

  test("uses canonical names for undeclared streamed web and computer calls", async () => {
    const model = createModel(
      createStreamFetch([
        ...HOSTED_TOOL_CASES[0].stream,
        {
          type: "response.output_item.added",
          output_index: 1,
          item: { type: "computer_call", id: "computer_1", status: "in_progress" },
        },
        {
          type: "response.output_item.done",
          output_index: 1,
          item: { type: "computer_call", id: "computer_1", status: "completed" },
        },
      ]),
    )

    const result = await model.doStream({ prompt: TEST_PROMPT })
    const events = (await readStream(result.stream)).filter((event) => "toolName" in event)

    expect(events.map((event) => event.toolName)).toEqual([
      "web_search",
      "web_search",
      "web_search",
      "computer_use",
      "computer_use",
      "computer_use",
    ])
  })

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

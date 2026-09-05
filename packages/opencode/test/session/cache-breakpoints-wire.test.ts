import { describe, expect, test } from "bun:test"
import { createAnthropic } from "@ai-sdk/anthropic"
import { jsonSchema, streamText, tool, wrapLanguageModel, type ModelMessage } from "ai"
import { ProviderTransform } from "@/provider/transform"
import type { Provider } from "@/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { MessageV2 } from "@/session/message-v2"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { SessionID, MessageID, PartID } from "@/session/schema"
import { Effect } from "effect"

const sessionID = SessionID.make("session")

function makeModel(input: { providerID: string; apiID: string; npm: string; id?: string }): Provider.Model {
  return {
    id: ModelV2.ID.make(input.id ?? input.apiID),
    providerID: ProviderV2.ID.make(input.providerID),
    api: { id: input.apiID, url: "https://example.com", npm: input.npm },
    name: "Probe",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 100000, input: 0, output: 8000 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-01-01",
  } as unknown as Provider.Model
}

/** Eligible, and takes applyCaching's message-level write path. */
const anthropicModel = () => makeModel({ providerID: "anthropic", apiID: "claude-opus-5", npm: "@ai-sdk/anthropic" })

const deepseekModel = () =>
  makeModel({ providerID: "deepseek", apiID: "deepseek-reasoner", npm: "@ai-sdk/openai-compatible" })

const mistralModel = () => makeModel({ providerID: "mistral", apiID: "mistral-large-latest", npm: "@ai-sdk/mistral" })

/** Not eligible for automatic breakpoints at all. */
const ineligibleModel = () => makeModel({ providerID: "openai", apiID: "gpt-5", npm: "@ai-sdk/openai" })

/**
 * Eligible, but takes applyCaching's *content-part* write path rather than the message-level one.
 *
 * The eligibility predicate is strictly broader than the message-level condition, so a Claude
 * served through a non-Anthropic package is eligible and writes into the last content part. This is
 * the only fixture shape on which the non-mutation property can actually fail.
 */
const contentBranchModel = () =>
  makeModel({ providerID: "openrouter", apiID: "anthropic/claude-opus-5", npm: "@openrouter/ai-sdk-provider" })

function sse(events: Record<string, unknown>[]) {
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("")
}

function textTurn(text: string) {
  return sse([
    {
      type: "message_start",
      message: {
        id: "msg_probe",
        type: "message",
        role: "assistant",
        model: "claude-opus-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
  ])
}

function toolTurn(id: string, input: { x: number }) {
  return sse([
    {
      type: "message_start",
      message: {
        id: `msg_${id}`,
        type: "message",
        role: "assistant",
        model: "claude-opus-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id, name: "probe_tool", input: {} } },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: JSON.stringify(input) },
    },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
  ])
}

const probeTool = tool({
  description: "probe",
  inputSchema: jsonSchema({ type: "object", properties: { x: { type: "number" } } }),
  execute: async () => "tool output for the probe",
})

type WireBody = { messages: Array<{ role: string; content: Array<Record<string, unknown>> }> }

async function request(
  messages: ModelMessage[],
  options?: {
    suffix?: ProviderTransform.MessageSuffix
    model?: Provider.Model
    scripted?: string
  },
): Promise<{ body: WireBody; produced: ModelMessage[]; fetches: number }> {
  const model = options?.model ?? anthropicModel()
  const captured: { body?: string } = {}
  let fetches = 0
  const fetch = (async (_url: unknown, init: RequestInit | undefined) => {
    fetches++
    captured.body = typeof init?.body === "string" ? init.body : JSON.stringify(init?.body)
    return new Response(options?.scripted ?? textTurn("done"), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    })
  }) as typeof globalThis.fetch
  const anthropic = createAnthropic({ apiKey: "probe", fetch })
  const wrapped = wrapLanguageModel({
    model: anthropic("claude-opus-5") as never,
    middleware: [
      {
        specificationVersion: "v3" as const,
        async transformParams(args) {
          if (args.type === "stream") {
            // @ts-expect-error The middleware prompt is the runtime shape transformed in production.
            args.params.prompt = ProviderTransform.message(args.params.prompt, model, {}, options?.suffix)
          }
          return args.params
        },
      },
    ],
  })
  const result = streamText({
    model: wrapped as never,
    messages,
    tools: { probe_tool: probeTool },
    maxRetries: 0,
  })
  for await (const _ of result.fullStream) {
  }
  const response = await result.response
  return {
    body: JSON.parse(captured.body!) as WireBody,
    produced: response.messages as ModelMessage[],
    fetches,
  }
}

async function wire(messages: ModelMessage[], options?: Parameters<typeof request>[1]): Promise<WireBody> {
  return (await request(messages, options)).body
}

function textPart(messageID: string, partID: string, text: string) {
  return {
    id: PartID.make(partID),
    sessionID,
    messageID: MessageID.make(messageID),
    type: "text",
    text,
  }
}

function userSource(id: string, text: string): SessionV1.WithParts {
  return {
    info: {
      id,
      sessionID,
      role: "user",
      time: { created: 0 },
      agent: "user",
      model: { providerID: ProviderV2.ID.make("anthropic"), modelID: ModelV2.ID.make("claude-opus-5") },
      tools: {},
      mode: "",
    } as unknown as SessionV1.User,
    parts: [textPart(id, `prt_${id}`, text)] as SessionV1.Part[],
  }
}

function assistantSource(id: string, parentID: string, text: string): SessionV1.WithParts {
  return {
    info: {
      id,
      sessionID,
      role: "assistant",
      time: { created: 0 },
      parentID,
      modelID: "claude-opus-5",
      providerID: "anthropic",
      mode: "",
      agent: "agent",
      path: { cwd: "/", root: "/" },
      cost: 0,
    } as unknown as SessionV1.Assistant,
    parts: [textPart(id, `prt_${id}`, text)] as SessionV1.Part[],
  }
}

function conversation(): SessionV1.WithParts[] {
  return [
    userSource("msg_durable_user", "durable question"),
    assistantSource("msg_durable_assistant", "msg_durable_user", "durable answer"),
    userSource("msg_request_status", "request status"),
    userSource("msg_request_policy", "request policy"),
  ]
}

const separatedConversation = (model: Provider.Model = anthropicModel()) =>
  Effect.runPromise(MessageV2.toModelMessagesSplitEffect(conversation(), model, { requestOnlyTailCount: 2 }))

function breakpoints(body: WireBody): string[] {
  return body.messages.flatMap((message) =>
    message.content.flatMap((block) => (block["cache_control"] ? [String(block["text"] ?? block["type"])] : [])),
  )
}

describe("cache breakpoints on the provider wire", () => {
  test("breakpoints land on durable content while appended messages carry none", async () => {
    const converted = await separatedConversation()
    const body = await wire(converted.messages, { suffix: converted.tail })
    const text = body.messages.flatMap((message) => message.content.map((block) => block["text"]))

    expect(text).toEqual(["durable question", "durable answer", "request status", "request policy"])
    expect(breakpoints(body)).toEqual(["durable question", "durable answer"])
  })

  test("flattening appended messages back into the conversation reproduces the defect", async () => {
    const converted = await separatedConversation()
    const body = await wire([...converted.messages, ...converted.tail])

    expect(breakpoints(body)).toEqual(["request status", "request policy"])
  })

  test("the negative control produces a different provider request", async () => {
    const converted = await separatedConversation()
    const separated = await wire(converted.messages, { suffix: converted.tail })
    const flattened = await wire([...converted.messages, ...converted.tail])

    expect(JSON.stringify(separated)).not.toBe(JSON.stringify(flattened))
  })

  test("plain appended messages are structurally excluded from selection", async () => {
    const messages = await MessageV2.toModelMessages(conversation().slice(0, 2), anthropicModel())
    const body = await wire(messages, {
      suffix: [
        { role: "user", content: [{ type: "text", text: "plain suffix one" }] },
        { role: "user", content: [{ type: "text", text: "plain suffix two" }] },
      ],
    })

    expect(breakpoints(body)).toEqual(["durable question", "durable answer"])
  })

  test("an empty suffix is byte-identical to no suffix on the provider wire", async () => {
    const messages = await MessageV2.toModelMessages(conversation().slice(0, 2), anthropicModel())
    const without = await wire(messages)
    const empty = await wire(await MessageV2.toModelMessages(conversation().slice(0, 2), anthropicModel()), {
      suffix: [],
    })

    expect(JSON.stringify(empty)).toBe(JSON.stringify(without))
  })

  test("conversion returns the conversation and appended messages separately", async () => {
    const converted = await separatedConversation()
    expect(converted.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "durable question" }] },
      { role: "assistant", content: [{ type: "text", text: "durable answer" }] },
    ])
    expect(converted.tail).toEqual([
      { role: "user", content: [{ type: "text", text: "request status" }] },
      { role: "user", content: [{ type: "text", text: "request policy" }] },
    ])
  })

  test("an ineligible model receives no breakpoints", async () => {
    const converted = await separatedConversation(ineligibleModel())
    const body = await wire(converted.messages, { suffix: converted.tail, model: ineligibleModel() })

    expect(breakpoints(body)).toEqual([])
  })

  test("breakpoints stay within the provider's four-marker cap", async () => {
    const converted = await separatedConversation()
    const body = await wire(converted.messages, { suffix: converted.tail })

    expect(breakpoints(body).length).toBeLessThanOrEqual(4)
  })

  test("every request in the OpenCode-shaped outer loop selects the last two durable messages", async () => {
    const durable: ModelMessage[] = [
      { role: "system", content: "stable system" },
      { role: "user", content: "u1: first user turn" },
      { role: "assistant", content: "a1: first assistant turn" },
      { role: "user", content: "u2: the real current prompt" },
    ]
    const scripts = [toolTurn("toolu_1", { x: 1 }), toolTurn("toolu_2", { x: 2 }), textTurn("done")]
    const expected = [
      ["a1: first assistant turn", "u2: the real current prompt"],
      ["tool_use", "tool_result"],
      ["tool_use", "tool_result"],
    ]

    for (const [step, scripted] of scripts.entries()) {
      const suffix: ModelMessage[] = [
        { role: "user", content: [{ type: "text", text: "request status" }] },
        { role: "user", content: [{ type: "text", text: "request policy" }] },
      ]
      const result = await request(durable, { suffix, scripted })
      const blocks = result.body.messages.flatMap((message) => message.content)

      expect(result.fetches).toBe(1)
      expect(breakpoints(result.body)).toEqual(expected[step])
      expect(blocks.filter((block) => block["text"] === "request status")).toHaveLength(1)
      expect(blocks.filter((block) => block["text"] === "request policy")).toHaveLength(1)
      expect(
        blocks
          .filter((block) => ["request status", "request policy"].includes(String(block["text"])))
          .every((block) => block["cache_control"] === undefined),
      ).toBe(true)
      durable.push(...result.produced)
    }
  })
})

type NormalizationFixture = { messages: ModelMessage[]; tail: ModelMessage[] }

function textFixture(): NormalizationFixture {
  return {
    messages: [
      { role: "system", content: "stable system" },
      { role: "user", content: [{ type: "text", text: "durable user" }] },
      { role: "assistant", content: [{ type: "text", text: "durable assistant" }] },
      { role: "user", content: [{ type: "text", text: "current prompt" }] },
    ],
    tail: [
      { role: "assistant", content: [{ type: "text", text: "assistant notice" }] },
      { role: "user", content: [{ type: "text", text: "user notice" }] },
    ],
  }
}

function mistralFixture(): NormalizationFixture {
  return {
    messages: [
      { role: "system", content: "stable system" },
      { role: "assistant", content: "durable assistant" },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_main",
            toolName: "probe",
            output: { type: "text", value: "durable tool output" },
          },
        ],
      },
    ],
    tail: [
      { role: "user", content: [{ type: "text", text: "request-only seam notice" }] },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_suffix",
            toolName: "probe",
            output: { type: "text", value: "request-only tool output" },
          },
        ],
      },
      { role: "user", content: [{ type: "text", text: "request-only user notice" }] },
    ],
  }
}

function expectNormalizationIdentity(model: Provider.Model, fixture: () => NormalizationFixture) {
  const combined = fixture()
  const previous = ProviderTransform.message([...combined.messages, ...combined.tail], model, { cacheControl: true })
  const separated = fixture()
  const redesigned = ProviderTransform.message(separated.messages, model, { cacheControl: true }, separated.tail)
  expect(JSON.stringify(redesigned)).toBe(JSON.stringify(previous))
  return redesigned
}

function expectNoSuffixIdentity(model: Provider.Model, fixture: () => NormalizationFixture) {
  const without = ProviderTransform.message(fixture().messages, model, {})
  const empty = ProviderTransform.message(fixture().messages, model, {}, [])
  expect(JSON.stringify(empty)).toBe(JSON.stringify(without))
}

describe("appended message normalization", () => {
  test("Anthropic normalization is byte-identical with appended messages", () => {
    expectNormalizationIdentity(anthropicModel(), textFixture)
  })

  test("DeepSeek normalization is byte-identical with appended messages", () => {
    const output = expectNormalizationIdentity(deepseekModel(), textFixture)
    const assistant = output.filter((message) => message.role === "assistant")
    expect(assistant).toHaveLength(2)
    expect(
      assistant.every(
        (message) => Array.isArray(message.content) && message.content.some((part) => part.type === "reasoning"),
      ),
    ).toBe(true)
  })

  test("Mistral normalization is byte-identical with appended messages", () => {
    const output = expectNormalizationIdentity(mistralModel(), mistralFixture)
    const bridges = output.filter(
      (message) =>
        message.role === "assistant" &&
        Array.isArray(message.content) &&
        message.content.some((part) => part.type === "text" && part.text === "Done."),
    )
    expect(bridges).toHaveLength(2)
  })

  test("Anthropic is byte-identical with no appended messages", () =>
    expectNoSuffixIdentity(anthropicModel(), textFixture))

  test("DeepSeek is byte-identical with no appended messages", () =>
    expectNoSuffixIdentity(deepseekModel(), textFixture))

  test("Mistral is byte-identical with no appended messages", () =>
    expectNoSuffixIdentity(mistralModel(), mistralFixture))

  test("appended messages receive provider-key remapping and itemId stripping", () => {
    const model = makeModel({ providerID: "custom-openai", apiID: "gpt-5", npm: "@ai-sdk/openai" })
    const output = ProviderTransform.message([{ role: "user", content: "durable" }], model, { store: false }, [
      {
        role: "user",
        content: [{ type: "text", text: "request-only" }],
        providerOptions: { "custom-openai": { itemId: "item_suffix", keep: "yes" } },
      },
    ])

    expect(output.at(-1)?.providerOptions).toEqual({ openai: { keep: "yes" } })
  })
})

function marked(messages: ModelMessage[]): number {
  return messages.filter((message) => {
    if (message.providerOptions?.["anthropic"]) return true
    if (!Array.isArray(message.content)) return false
    return message.content.some(
      (part) =>
        typeof part === "object" && part !== null && "providerOptions" in part && part.providerOptions?.["anthropic"],
    )
  }).length
}

function arrayContent(): ModelMessage[] {
  return [
    { role: "user", content: [{ type: "text", text: "one" }] },
    { role: "assistant", content: [{ type: "text", text: "two" }] },
  ]
}

describe("cache selection invariants", () => {
  test("does not mutate input on the content-part write path", () => {
    // This fixture must satisfy BOTH conditions or it passes vacuously: a content-branch model AND
    // array content with a markable last part. A content-branch model carrying string content
    // falls through to the message-level write, which a shallow message copy already protects.
    const model = contentBranchModel()
    const input = arrayContent()
    const before = structuredClone(input)

    const output = ProviderTransform.cacheBreakpoints(input, model)

    expect(input).toEqual(before)
    expect(marked(input)).toBe(0)
    expect(marked(output)).toBe(2)
    expect(output).not.toBe(input)
    // The copy must reach the part, not just the message: these are the objects that were written.
    expect(output[0]).not.toBe(input[0])
    expect((output[0]!.content as unknown[])[0]).not.toBe((input[0]!.content as unknown[])[0])
  })

  test("does not mutate input on the message-level write path", () => {
    const input = arrayContent()
    const before = structuredClone(input)

    const output = ProviderTransform.cacheBreakpoints(input, anthropicModel())

    expect(input).toEqual(before)
    expect(marked(input)).toBe(0)
    expect(marked(output)).toBe(2)
  })

  test("returns its input by reference when the model is ineligible", () => {
    const input = arrayContent()
    const output = ProviderTransform.cacheBreakpoints(input, ineligibleModel())

    expect(output).toBe(input)
    expect(marked(output)).toBe(0)
  })

  test("normalizes before selection so a deleted empty message cannot consume a breakpoint", () => {
    const output = ProviderTransform.message(
      [
        { role: "user", content: [{ type: "text", text: "durable one" }] },
        { role: "assistant", content: [{ type: "text", text: "durable two" }] },
        { role: "user", content: [{ type: "text", text: "" }] },
      ],
      anthropicModel(),
      {},
    )

    expect(output).toHaveLength(2)
    expect(output[0]!.providerOptions?.["anthropic"]).toBeDefined()
    expect(output[1]!.providerOptions?.["anthropic"]).toBeDefined()
    expect(marked(output)).toBe(2)
  })

  test("repeated selection over the same input does not accumulate breakpoints", () => {
    const input: ModelMessage[] = [
      { role: "user", content: [{ type: "text", text: "one" }] },
      { role: "assistant", content: [{ type: "text", text: "two" }] },
    ]
    const first = ProviderTransform.message(input, anthropicModel(), {})
    const second = ProviderTransform.message(input, anthropicModel(), {})
    const third = ProviderTransform.message(input, anthropicModel(), {})

    expect(marked(first)).toBe(2)
    expect(marked(second)).toBe(2)
    expect(marked(third)).toBe(2)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    expect(JSON.stringify(third)).toBe(JSON.stringify(first))
  })

  test("appended messages remain unmarked after the transformed arrays are joined", () => {
    const output = ProviderTransform.message(
      [
        { role: "user", content: [{ type: "text", text: "durable one" }] },
        { role: "assistant", content: [{ type: "text", text: "durable two" }] },
      ],
      anthropicModel(),
      {},
      [
        { role: "user", content: [{ type: "text", text: "notice one" }] },
        { role: "user", content: [{ type: "text", text: "notice two" }] },
      ],
    )

    expect(marked(output)).toBe(2)
    expect(output[0]!.providerOptions?.["anthropic"]).toBeDefined()
    expect(output[1]!.providerOptions?.["anthropic"]).toBeDefined()
    expect(output[2]!.providerOptions?.["anthropic"]).toBeUndefined()
    expect(output[3]!.providerOptions?.["anthropic"]).toBeUndefined()
  })
})

import { describe, expect, test } from "bun:test"
import { LLM, LLMRequest, Message, ToolCallPart, ToolDefinition } from "../src/effect.js"
import { OpenAIChat } from "../src/protocols.js"
import { Auth } from "../src/route.js"
import { sanitizeSurrogates } from "../src/utils/sanitize.js"

const model = OpenAIChat.route
  .with({ endpoint: { baseURL: "https://api.openai.test/v1/" }, auth: Auth.bearer("test") })
  .model({ id: "gpt-4o-mini" })

const tool = new ToolDefinition({
  name: "lookup",
  description: "Look something up",
  inputSchema: { type: "object", properties: { query: { type: "string" } } },
})

const sanitizeRequest = (request: LLMRequest) =>
  LLMRequest.update(request, sanitizeSurrogates({ ...LLMRequest.input(request), model: undefined }))

describe("sanitizeSurrogates", () => {
  test("replaces lone surrogates in nested message text, tool input, and tool output", () => {
    const sanitized = sanitizeRequest(
      LLM.request({
        model,
        system: "system \uD800",
        tools: [tool],
        messages: [
          Message.user("user \uDC00 \u{1F600}"),
          Message.assistant([
            ToolCallPart.make({ id: "call_1", name: "lookup", input: { "q\uD800": "input \uDC00" } }),
          ]),
          Message.tool({ id: "call_1", name: "lookup", result: { output: ["result \uD800", "valid"] } }),
        ],
      }),
    )

    expect(sanitized.messages.every((message) => message instanceof Message)).toBe(true)
    expect(sanitized.tools[0]).toBe(tool)
    expect(sanitized.system).toEqual([{ type: "text", text: "system \uFFFD" }])
    expect(sanitized.messages).toEqual([
      Message.user("user \uFFFD \u{1F600}"),
      Message.assistant([ToolCallPart.make({ id: "call_1", name: "lookup", input: { "q\uFFFD": "input \uFFFD" } })]),
      Message.tool({ id: "call_1", name: "lookup", result: { output: ["result \uFFFD", "valid"] } }),
    ])
  })

  test("keeps clean requests equal and shares unchanged nested values", () => {
    const messages = [Message.user("hello \u{1F600}"), Message.assistant("hi")]
    const request = LLM.request({
      model,
      system: "system",
      tools: [tool],
      messages: [...messages, Message.user("bad \uD800")],
      generation: { maxTokens: 10 },
      metadata: { nested: { list: ["a", "b"] } },
    })
    const sanitized = sanitizeRequest(request)

    expect(sanitized).toBeInstanceOf(LLMRequest)
    expect(sanitized.messages.slice(0, 2)).toEqual(request.messages.slice(0, 2))
    expect(sanitized.messages[0]).toBe(request.messages[0])
    expect(sanitized.messages[1]).toBe(request.messages[1])
    expect(sanitized.messages[2]).not.toBe(request.messages[2])
    expect(sanitized.messages[2]).toEqual(Message.user("bad \uFFFD"))
    expect(sanitized.tools[0]).toBe(request.tools[0])
    expect(sanitized.generation).toBe(request.generation)

    const input = LLMRequest.input(request)
    const output = sanitizeSurrogates(input)
    expect(output.system).toBe(input.system)
    expect(output.tools).toBe(input.tools)
    expect(output.metadata).toBe(input.metadata)
    expect(output.messages).not.toBe(input.messages)

    const clean = LLM.request({ model, system: "system", tools: [tool], messages })
    expect(sanitizeRequest(clean)).toEqual(clean)
    expect(sanitizeSurrogates(LLMRequest.input(clean)).messages).toBe(clean.messages)
  })
})

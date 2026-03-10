import {
  getOpenAICompatibleToolParsers,
  rewriteOpenAICompatibleJsonResponse,
  rewriteOpenAICompatibleRequestBody,
  rewriteOpenAICompatibleStreamResponse,
} from "@/provider/openai-compatible-compat"
import { describe, expect, test } from "bun:test"

describe("openai-compatible compat", () => {
  test("rewrites tools and tool_choice to legacy functions and function_call", () => {
    const parsers = getOpenAICompatibleToolParsers({
      toolParser: [{ type: "raw-function-call" }],
    })

    const rewritten = rewriteOpenAICompatibleRequestBody(
      {
        model: "demo",
        tools: [
          {
            type: "function",
            function: {
              name: "bash",
              description: "Run a shell command",
              parameters: {
                type: "object",
                properties: {
                  command: { type: "string" },
                },
                required: ["command"],
              },
            },
          },
        ],
        tool_choice: {
          type: "function",
          function: {
            name: "bash",
          },
        },
        parallel_tool_calls: false,
      },
      parsers,
    )

    expect(rewritten.tools).toBeUndefined()
    expect(rewritten.tool_choice).toBeUndefined()
    expect(rewritten.parallel_tool_calls).toBeUndefined()
    expect(rewritten.functions).toEqual([
      {
        name: "bash",
        description: "Run a shell command",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string" },
          },
          required: ["command"],
        },
      },
    ])
    expect(rewritten.function_call).toEqual({ name: "bash" })
  })

  test("rewrites legacy function_call responses to tool_calls", () => {
    const parsers = getOpenAICompatibleToolParsers({
      toolParser: [{ type: "raw-function-call" }],
    })

    const rewritten = rewriteOpenAICompatibleJsonResponse(
      {
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              function_call: {
                name: "bash",
                arguments: "{\"command\":\"ls -la\"}",
              },
            },
            finish_reason: "function_call",
          },
        ],
      },
      parsers,
    )

    expect(rewritten.choices[0].finish_reason).toBe("tool_calls")
    expect(rewritten.choices[0].message.function_call).toBeUndefined()
    expect(rewritten.choices[0].message.tool_calls).toEqual([
      {
        id: "call_opencode_compat_0",
        type: "function",
        function: {
          name: "bash",
          arguments: "{\"command\":\"ls -la\"}",
        },
      },
    ])
  })

  test("rewrites text-only SSE content into a synthetic tool call when configured", () => {
    const parsers = getOpenAICompatibleToolParsers({
      toolParser: [
        {
          type: "single-tool-text",
          tool: "bash",
          argument: "command",
        },
      ],
    })

    const transformed = rewriteOpenAICompatibleStreamResponse(
      [
        'data: {"id":"chatcmpl-1","created":1,"model":"demo","choices":[{"index":0,"delta":{"role":"assistant","content":"ls -la"},"finish_reason":"stop"}]}',
        "data: [DONE]",
      ].join("\n\n"),
      parsers,
    )

    expect(transformed).not.toContain("\"content\":\"ls -la\"")
    expect(transformed).toContain("\"tool_calls\"")
    expect(transformed).toContain("\"finish_reason\":\"tool_calls\"")
    expect(transformed).toContain("{\\\"command\\\":\\\"ls -la\\\"}")
  })

  test("rewrites tagged JSON tool content into a synthetic tool call", () => {
    const parsers = getOpenAICompatibleToolParsers({
      toolParser: [{ type: "json" }],
    })

    const transformed = rewriteOpenAICompatibleStreamResponse(
      [
        'data: {"id":"chatcmpl-2","created":2,"model":"demo","choices":[{"index":0,"delta":{"role":"assistant","content":"<tool_call>{\\"name\\":\\"bash\\",\\"arguments\\":{\\"command\\":\\"pwd\\"}}</tool_call>"},"finish_reason":"stop"}]}',
        "data: [DONE]",
      ].join("\n\n"),
      parsers,
    )

    expect(transformed).toContain("\"tool_calls\"")
    expect(transformed).toContain("{\\\"command\\\":\\\"pwd\\\"}")
    expect(transformed).toContain("\"name\":\"bash\"")
  })
})

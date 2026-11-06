import { expect, test } from "bun:test"
import { aliasRequest, aliasResponse } from "../src/plugin/provider/opencode-free"

test("free wire alias preserves execute arguments, schemas, history and ordinary text", async () => {
  const body = {
    model: "deepseek-v4.1-flash-free",
    stream: true,
    tools: [
      {
        type: "function",
        function: {
          name: "execute",
          description: "Run code",
          parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
        },
      },
    ],
    messages: [
      { role: "user", content: "execute read" },
      {
        role: "assistant",
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "execute", arguments: '{"code":"return 1"}' } },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "1" },
    ],
    tool_choice: { type: "function", function: { name: "execute" } },
  }
  const request = await aliasRequest(new Request("https://example.com", { method: "POST", body: JSON.stringify(body) }))
  const result = await request!.json()
  expect(result).toEqual({
    ...body,
    tools: [{ ...body.tools[0], function: { ...body.tools[0].function, name: "read" } }],
    messages: [
      body.messages[0],
      {
        ...body.messages[1],
        tool_calls: [
          {
            ...body.messages[1].tool_calls![0],
            function: { ...body.messages[1].tool_calls![0].function, name: "read" },
          },
        ],
      },
      body.messages[2],
    ],
    tool_choice: { type: "function", function: { name: "read" } },
  })
  const chunk =
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read","arguments":"{\\\"code\\\":\\\"return 1\\\"}"}}]},"finish_reason":null}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"read execute"}}]}\n\ndata: [DONE]\n\n'
  const response = await aliasResponse(
    new Response(
      new ReadableStream({
        start(controller) {
          for (const part of [chunk.slice(0, 31), chunk.slice(31, 77), chunk.slice(77)])
            controller.enqueue(new TextEncoder().encode(part))
          controller.close()
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    ),
  )
  const text = await response.text()
  expect(text).toContain('"name":"execute"')
  expect(text).toContain('"content":"read execute"')
  expect(text).toContain("data: [DONE]")
  expect(text).toContain('"arguments":"{\\"code\\":\\"return 1\\"}"')
})

test("requests without execute retain their own tool names", async () => {
  expect(
    await aliasRequest(
      new Request("https://example.com", {
        method: "POST",
        body: JSON.stringify({ tools: [{ function: { name: "other" } }] }),
      }),
    ),
  ).toBeUndefined()
})

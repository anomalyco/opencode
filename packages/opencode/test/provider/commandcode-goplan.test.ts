import { expect, test } from "bun:test"
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider"
import {
  buildWireBody,
  catalog,
  collectWire,
  CommandcodeLanguageModel,
  extractXMLToolCalls,
  isOverflow,
  mapFinish,
  toolOutputText,
  toWireMessages,
  toWireTools,
} from "@/provider/commandcode-goplan"

test("extracts xml tool calls", () => {
  const input = `Let me explore! <tool_call> <function=read> <parameter=filePath>/tmp/x</parameter> </function> </tool_call>`
  const { clean, calls } = extractXMLToolCalls(input)
  expect(calls.length).toBe(1)
  expect(calls[0].name).toBe("read")
  expect(JSON.parse(calls[0].args)).toEqual({ filePath: "/tmp/x" })
  expect(clean).toBe("Let me explore!")
})

test("collects ndjson usage and fingerprint", () => {
  const collected = collectWire(
    `{"type":"text-delta","text":"hi"}\n` +
      `{"type":"finish","finishReason":"end_turn","rawFinishReason":"end_turn","totalUsage":{"inputTokens":1000,"outputTokens":10,"inputTokenDetails":{"cacheReadTokens":800,"cacheWriteTokens":200}}}\n` +
      `{"type":"provider-metadata","providerMetadata":{"gateway":{"generationId":"gen_abc","routing":{"resolvedProvider":"xiaomi"}}}}\n`,
  )
  expect(collected.text).toBe("hi")
  expect(collected.raw).toBe("end_turn")
  expect(collected.prompt).toBe(1000)
  expect(collected.cached).toBe(800)
  expect(collected.fingerprint).toBe("xiaomi:gen_abc")
})

test("maps openai messages to wire", () => {
  const wired = toWireMessages([
    { role: "system", content: "be brief" },
    { role: "user", content: [{ type: "text", text: "hi" }] },
  ])
  expect(wired.system).toBe("be brief")
  expect(wired.messages.length).toBe(1)
  const body = JSON.parse(
    buildWireBody({ model: "m", system: wired.system, messages: wired.messages, tools: [], maxTokens: 50 }),
  )
  expect(body.params.system).toBe("be brief")
  expect(body.params.max_tokens).toBe(50)
  expect(body.mode).toBe("agent")
})

test("drops tools on tool_choice none", () => {
  const { tools } = toWireTools(
    [{ type: "function", name: "read", description: "", inputSchema: { type: "object" } }],
    { type: "none" },
  )
  expect(tools).toEqual([])
})

test("maps finish and overflow", () => {
  expect(mapFinish(0, "length")).toBe("length")
  expect(mapFinish(2, "length")).toBe("tool-calls")
  expect(mapFinish(0, "end_turn")).toBe("stop")
  expect(isOverflow(400, `{"error":"prompt is too long for context window"}`)).toBe(true)
  expect(isOverflow(413, "anything")).toBe(true)
  expect(isOverflow(403, `{"error":"FORBIDDEN"}`)).toBe(false)
})

test("serializes every tool-result variant", () => {
  expect(toolOutputText({ type: "text", value: "a" })).toBe("a")
  expect(toolOutputText({ type: "json", value: { files: ["x"] } })).toBe(`{"files":["x"]}`)
  expect(toolOutputText({ type: "error-json", value: "boom" })).toBe("boom")
  expect(toolOutputText({ type: "execution-denied", reason: "no" })).toBe("no")
})

test("keeps tool results after their assistant message", () => {
  const wired = toWireMessages([
    {
      role: "assistant",
      content: [
        { type: "text", text: "reading" },
        { type: "tool-call", toolCallId: "call_1", toolName: "read", input: { filePath: "/tmp/x" } },
        {
          type: "tool-result",
          toolCallId: "call_1",
          toolName: "read",
          output: { type: "json", value: { content: "hi" } },
        },
      ],
    },
  ])
  expect(wired.messages.map((message) => message.role)).toEqual(["assistant", "tool"])
  expect(wired.messages[0].toolCalls).toEqual([{ id: "call_1", name: "read", args: `{"filePath":"/tmp/x"}` }])
  expect(wired.messages[1].text).toBe(`{"content":"hi"}`)
  expect(wired.messages[1].toolCallID).toBe("call_1")
})

test("seeds 36 models", () => {
  const provider = catalog()
  expect(provider.id).toBe("commandcode-goplan")
  expect(provider.env).toEqual(["COMMANDCODE_API_KEY"])
  expect(Object.keys(provider.models).length).toBe(36)
  expect(provider.models["xiaomi/mimo-v2.5"].limit.context).toBe(1000000)
})

test("doGenerate reposts on pause_turn with gateway headers", () => {
  const seen: Array<Record<string, string>> = []
  const first =
    `{"type":"text-delta","text":"ap"}\n` +
    `{"type":"finish","finishReason":"pause","rawFinishReason":"pause_turn","totalUsage":{"inputTokens":10,"outputTokens":1}}\n`
  const second =
    `{"type":"text-delta","text":"ple"}\n` +
    `{"type":"finish","finishReason":"end_turn","rawFinishReason":"end_turn","totalUsage":{"inputTokens":10,"outputTokens":2}}\n`
  let calls = 0
  const stub = async (url: unknown, init?: RequestInit) => {
    seen.push(Object.fromEntries(new Headers(init?.headers).entries()))
    calls++
    const body = calls === 1 ? first : second
    return new Response(body, { status: 200, headers: { "Content-Type": "application/x-ndjson" } })
  }
  const model = new CommandcodeLanguageModel("m", {
    apiKey: "k",
    baseURL: "https://example.test",
    fetch: stub as unknown as typeof fetch,
  })
  return model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }).then((result) => {
    expect(calls).toBe(2)
    expect(seen[0]["authorization"]).toBe("Bearer k")
    expect(seen[0]["user-agent"]).toBe("cli")
    expect(seen[0]["x-command-code-version"]).toBe("1.44.0")
    expect(result.content).toEqual([{ type: "text", text: "apple" }])
    expect(result.finishReason.unified).toBe("stop")
    expect(result.usage.outputTokens.total).toBe(3)
  })
})

test("doStream emits deltas then finish with usage", async () => {
  const ndjson =
    `{"type":"text-delta","text":"hi"}\n` +
    `{"type":"tool-call","toolName":"read","toolCallId":"call_1","input":{"filePath":"/tmp/x"}}\n` +
    `{"type":"finish","finishReason":"end_turn","rawFinishReason":"end_turn","totalUsage":{"inputTokens":500,"outputTokens":2,"inputTokenDetails":{"cacheReadTokens":100,"cacheWriteTokens":50}}}\n`
  const stub = async () => new Response(ndjson, { status: 200, headers: { "Content-Type": "application/x-ndjson" } })
  const model = new CommandcodeLanguageModel("m", {
    apiKey: "k",
    baseURL: "https://example.test",
    fetch: stub as unknown as typeof fetch,
  })
  const { stream } = await model.doStream({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] })
  const parts: LanguageModelV3StreamPart[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
  }
  const deltas = parts.filter((part) => part.type === "text-delta")
  expect(deltas).toEqual([{ type: "text-delta", id: "text-0", delta: "hi" }])
  const finish = parts.find((part) => part.type === "finish")
  expect(finish?.type).toBe("finish")
  if (finish?.type === "finish") {
    expect(finish.finishReason.unified).toBe("tool-calls")
    expect(finish.usage.inputTokens.cacheRead).toBe(100)
  }
  // ai-sdk executes only on tool-call; input-* alone leaves the call pending.
  expect(parts).toContainEqual({
    type: "tool-call",
    toolCallId: "call_1",
    toolName: "read",
    input: `{"filePath":"/tmp/x"}`,
  })
})

test("doGenerate keeps tool-call input stringified", () => {
  const ndjson =
    `{"type":"tool-call","toolName":"read","toolCallId":"call_1","input":{"filePath":"/tmp/x"}}\n` +
    `{"type":"finish","finishReason":"tool-calls","rawFinishReason":"tool_calls","totalUsage":{"inputTokens":5,"outputTokens":2}}\n`
  const stub = async () => new Response(ndjson, { status: 200, headers: { "Content-Type": "application/x-ndjson" } })
  const model = new CommandcodeLanguageModel("m", {
    apiKey: "k",
    baseURL: "https://example.test",
    fetch: stub as unknown as typeof fetch,
  })
  return model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }).then((result) => {
    // Stringified: ai-sdk parses generate-content tool input itself.
    expect(result.content).toEqual([
      { type: "tool-call", toolCallId: "call_1", toolName: "read", input: `{"filePath":"/tmp/x"}` },
    ])
  })
})

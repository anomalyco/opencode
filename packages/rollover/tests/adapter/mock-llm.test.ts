import { afterAll, describe, expect, test } from "bun:test"
import { startMockLlm, type MockScript } from "../../bench/mock-llm/server"

describe("mock-llm", () => {
  const servers: Array<{ stop(): Promise<void> }> = []
  afterAll(async () => {
    for (const s of servers) await s.stop()
  })

  test("autoUsage derives input tokens from the request payload size", async () => {
    const llm = await startMockLlm({
      script: [{ match: "hello", content: "Hi!", usage: { input: 42 } }],
      autoUsage: true,
    })
    servers.push(llm)
    const small = JSON.stringify({ model: "test-model", messages: [{ role: "user", content: "hello" }] })
    const big = JSON.stringify({
      model: "test-model",
      messages: [
        { role: "user", content: "hello " + "x".repeat(4000) },
        { role: "assistant", content: "y".repeat(4000) },
        { role: "user", content: "and the rest" },
      ],
    })
    const res1 = await fetch(llm.url + "/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: small,
    })
    const res2 = await fetch(llm.url + "/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: big,
    })
    const j1 = (await res1.json()) as any
    const j2 = (await res2.json()) as any
    expect(j1.usage.prompt_tokens).toBe(Math.ceil(small.length / 4))
    // scripted input (42) is ignored under autoUsage; size drives the count
    expect(j2.usage.prompt_tokens).toBe(Math.ceil(big.length / 4))
    expect(j2.usage.prompt_tokens).toBeGreaterThan(j1.usage.prompt_tokens)
    expect(llm.requests()[1].usage.input).toBe(j2.usage.prompt_tokens)
  })

  test("records non-streaming request and returns scripted content", async () => {
    const script: MockScript = [{ match: "hello", content: "Hi!", usage: { input: 42 } }]
    const llm = await startMockLlm({ script })
    servers.push(llm)
    const res = await fetch(llm.url + "/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "test-model", messages: [{ role: "user", content: "hello world" }] }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.choices[0].message.content).toBe("Hi!")
    expect(json.usage.prompt_tokens).toBe(42)
    expect(json.usage.completion_tokens).toBeGreaterThan(0)
    expect(llm.requests().length).toBe(1)
    expect(llm.requests()[0].body).toMatchObject({ model: "test-model" })
    expect(llm.requests()[0].stream).toBe(false)
  })

  test("streams SSE chunks, aggregates usage, and records the request", async () => {
    const llm = await startMockLlm({
      script: [{ content: "counting", usage: { input: 100, output: 7 } }],
    })
    servers.push(llm)
    const res = await fetch(llm.url + "/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "test-model",
        stream: true,
        messages: [{ role: "user", content: "stream please" }],
      }),
    })
    expect(res.headers.get("content-type")).toContain("text/event-stream")
    const text = await res.text()
    expect(text).toContain("[DONE]")
    expect(text).toContain('"content":"c"')
    const ll = llm.requests()
    expect(ll.length).toBe(1)
    expect(ll[0].stream).toBe(true)
    expect(ll[0].usage.input).toBe(100)
    expect(ll[0].usage.output).toBe(7)
  })

  test("scripted tool calls appear as tool_calls and are recorded", async () => {
    const llm = await startMockLlm({
      script: [
        {
          content: "",
          toolCalls: [{ id: "call_1", name: "bash", args: '{"command":"ls"}' }],
          usage: { input: 10, output: 5 },
        },
      ],
    })
    servers.push(llm)
    const res = await fetch(llm.url + "/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "run ls" }] }),
    })
    const json = (await res.json()) as any
    expect(json.choices[0].message.tool_calls[0]).toMatchObject({
      id: "call_1",
      type: "function",
      function: { name: "bash", arguments: '{"command":"ls"}' },
    })
  })

  test("default response when no script matches", async () => {
    const llm = await startMockLlm({ script: [{ match: "nomatch", content: "no" }] })
    servers.push(llm)
    const res = await fetch(llm.url + "/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "anything" }] }),
    })
    const json = (await res.json()) as any
    expect(json.choices[0].message.content).toBe("ok")
  })
})

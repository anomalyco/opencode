import { describe, expect, test } from "bun:test"
import { countTokens, renderTextToolCall, reply, startLocalServer, type ChatBody } from "./local-server"

type Chunk = {
  choices: Array<{ delta: Record<string, unknown>; finish_reason: string | null }>
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

const base: ChatBody = { model: "test-model", messages: [{ role: "user", content: "hello" }], stream: true }

function post(url: string, body: ChatBody, init?: RequestInit) {
  return fetch(`${url}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test" },
    body: JSON.stringify(body),
    ...init,
  })
}

async function stream(url: string, body: ChatBody = base) {
  const res = await post(url, body)
  const text = await res.text()
  const lines = text
    .split("\n\n")
    .filter(Boolean)
    .map((line) => line.replace(/^data: /, ""))
  const chunks: Chunk[] = lines.filter((line) => line !== "[DONE]").map((line) => JSON.parse(line))
  const deltas = chunks.flatMap((item) => item.choices.map((choice) => choice.delta))
  const field = (name: string) =>
    deltas.flatMap((delta) => (typeof delta[name] === "string" ? [delta[name]] : [])).join("")
  return {
    res,
    lines,
    chunks,
    deltas,
    content: field("content"),
    field,
    finish: chunks.flatMap((item) => item.choices.flatMap((choice) => choice.finish_reason ?? [])),
    usage: chunks.find((item) => item.usage)?.usage,
  }
}

describe("local-server", () => {
  test("streams realistic SSE: role chunk, several content deltas, finish, [DONE]; default reply is ok", async () => {
    await using server = await startLocalServer()
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/)
    server.queue(reply.text("Hello there, general Kenobi"))
    const first = await stream(server.url)
    expect(first.res.headers.get("content-type")).toContain("text/event-stream")
    expect(first.deltas[0]).toEqual({ role: "assistant", content: "" })
    expect(first.content).toBe("Hello there, general Kenobi")
    expect(first.deltas.filter((delta) => delta.content).length).toBeGreaterThan(3)
    expect(first.finish).toEqual(["stop"])
    expect(first.lines.at(-1)).toBe("[DONE]")
    expect((await stream(server.url)).content).toBe("ok")
  })

  test("stream:false returns a single chat.completion with usage", async () => {
    await using server = await startLocalServer()
    server.queue([reply.reasoning("hmm"), reply.text("done"), reply.tool_call({ name: "read", args: { path: "a" } })])
    const body = { ...base, stream: false }
    const json = await (await post(server.url, body)).json()
    expect(json.object).toBe("chat.completion")
    expect(json.choices[0].message).toEqual({
      role: "assistant",
      content: "done",
      reasoning_content: "hmm",
      tool_calls: [{ id: "call_0_read", type: "function", function: { name: "read", arguments: '{"path":"a"}' } }],
    })
    expect(json.choices[0].finish_reason).toBe("tool_calls")
    expect(json.usage.prompt_tokens).toBe(countTokens(body))
  })

  test("records method, path, headers, parsed body and chunk timestamps", async () => {
    await using server = await startLocalServer({ chunk_delay_ms: 5 })
    await stream(server.url, { ...base, prompt_cache_key: "k1" })
    const log = server.chats()[0]
    expect(log.method).toBe("POST")
    expect(log.path).toBe("/v1/chat/completions")
    expect(log.headers.authorization).toBe("Bearer test")
    expect(log.body?.prompt_cache_key).toBe("k1")
    expect(log.status).toBe(200)
    expect(log.firstByteAt).toBeGreaterThanOrEqual(log.receivedAt)
    expect(log.doneAt).toBeGreaterThanOrEqual(log.firstByteAt ?? Infinity)
    expect(log.chunks.at(-1)?.data).toBe("[DONE]")
    expect(log.chunks.at(-1)!.at - log.chunks[0].at).toBeGreaterThanOrEqual(5 * (log.chunks.length - 2))
  })

  describe("models toggle", () => {
    test.each([
      ["vllm", { max_model_len: 8192, owned_by: "vllm" }],
      ["lmstudio", { context_length: 8192 }],
      ["llamacpp", { owned_by: "llamacpp", meta: { n_ctx_train: 8192, n_vocab: 32000 } }],
    ] as const)("%s shape", async (models, expected) => {
      await using server = await startLocalServer({ models, context_window: 8192, model: "qwen" })
      const json = await (await fetch(`${server.url}/models`)).json()
      expect(json.data[0]).toMatchObject({ id: "qwen", ...expected })
    })

    test("none → 404", async () => {
      await using server = await startLocalServer({ models: "none" })
      expect((await fetch(`${server.url}/models`)).status).toBe(404)
    })
  })

  describe("usage_in_stream", () => {
    const body = { ...base, stream_options: { include_usage: true } }

    test("final usage chunk only when enabled and requested; tokens are ceil(chars/4)", async () => {
      await using server = await startLocalServer()
      server.queue(reply.text("12345678"))
      const result = await stream(server.url, body)
      expect(result.chunks.at(-1)?.choices).toEqual([])
      expect(result.usage).toEqual({
        prompt_tokens: countTokens(body),
        completion_tokens: 2,
        total_tokens: countTokens(body) + 2,
      })
      expect((await stream(server.url, base)).usage).toBeUndefined()
    })

    test("disabled → no usage chunk even when requested", async () => {
      await using server = await startLocalServer({ usage_in_stream: false })
      expect((await stream(server.url, body)).usage).toBeUndefined()
    })

    test("prompt tokens count system, tools and messages deterministically", async () => {
      await using server = await startLocalServer()
      const small = await stream(server.url, body)
      const large = await stream(server.url, {
        ...body,
        messages: [{ role: "system", content: "x".repeat(400) }, ...(body.messages ?? [])],
        tools: [{ type: "function", function: { name: "probe" } }],
      })
      expect(large.usage!.prompt_tokens - small.usage!.prompt_tokens).toBeGreaterThanOrEqual(100)
    })
  })

  describe("reasoning", () => {
    test.each(["reasoning_content", "reasoning"] as const)("reasoning_field=%s", async (field) => {
      await using server = await startLocalServer({ reasoning_field: field })
      server.queue([reply.reasoning("let me think"), reply.text("answer")])
      const result = await stream(server.url)
      expect(result.field(field)).toBe("let me think")
      expect(result.content).toBe("answer")
      const first = result.deltas.findIndex((delta) => field in delta)
      expect(first).toBeLessThan(result.deltas.findIndex((delta) => delta.content === "answ"))
    })

    test("reasoning_field=none drops reasoning", async () => {
      await using server = await startLocalServer({ reasoning_field: "none" })
      server.queue([reply.reasoning("secret"), reply.text("answer")])
      const result = await stream(server.url)
      expect(result.content).toBe("answer")
      expect(JSON.stringify(result.deltas)).not.toContain("secret")
    })

    test("think_tags puts reasoning inline, split across deltas", async () => {
      await using server = await startLocalServer({ think_tags: true, reasoning_field: "none" })
      server.queue([reply.reasoning("hmm"), reply.text("answer")])
      const result = await stream(server.url)
      expect(result.content).toBe("<think>hmm</think>answer")
      expect(result.deltas.some((delta) => delta.content === "<think>")).toBe(false)
    })

    test("reply.think is always inline", async () => {
      await using server = await startLocalServer()
      server.queue([reply.think("x"), reply.text("y")])
      expect((await stream(server.url)).content).toBe("<think>x</think>y")
    })
  })

  describe("tools", () => {
    test("native: tool_calls stream name first then arguments in pieces", async () => {
      await using server = await startLocalServer()
      server.queue([
        reply.reasoning("I should read"),
        reply.tool_call({ name: "read", args: { path: "src/index.ts", limit: 10 } }),
      ])
      const result = await stream(server.url)
      const calls = result.deltas.flatMap((delta) => (Array.isArray(delta.tool_calls) ? delta.tool_calls : []))
      expect(calls[0]).toEqual({ index: 0, id: "call_0_read", type: "function", function: { name: "read", arguments: "" } })
      expect(calls.length).toBeGreaterThan(2)
      expect(JSON.parse(calls.map((call) => call.function.arguments).join(""))).toEqual({ path: "src/index.ts", limit: 10 })
      expect(result.finish).toEqual(["tool_calls"])
    })

    test("native: several tool calls get increasing indexes", async () => {
      await using server = await startLocalServer()
      server.queue([reply.tool_call({ name: "a", args: {} }), reply.tool_call({ name: "b", args: {} })])
      const result = await stream(server.url)
      const starts = result.deltas.flatMap((delta) =>
        Array.isArray(delta.tool_calls) ? delta.tool_calls.filter((call) => call.id) : [],
      )
      expect(starts.map((call) => [call.index, call.function.name])).toEqual([
        [0, "a"],
        [1, "b"],
      ])
    })

    test.each(["fenced", "bare", "hermes"] as const)("text mode renders tool_call as %s text", async (format) => {
      await using server = await startLocalServer({ tools: "text", text_tool_format: format })
      server.queue(reply.tool_call({ name: "read", args: { path: "a" } }))
      const result = await stream(server.url, { ...base, tools: [{ type: "function", function: { name: "read" } }] })
      expect(result.deltas.some((delta) => "tool_calls" in delta)).toBe(false)
      expect(result.content).toBe(renderTextToolCall("read", { path: "a" }, format))
      expect(result.finish).toEqual(["stop"])
    })

    test("text formats", () => {
      expect(renderTextToolCall("r", { x: 1 }, "fenced")).toBe('```json\n{"tool":"r","args":{"x":1}}\n```')
      expect(renderTextToolCall("r", { x: 1 }, "bare")).toBe('{"tool":"r","args":{"x":1}}')
      expect(renderTextToolCall("r", { x: 1 }, "hermes")).toBe('<tool_call>\n{"name":"r","arguments":{"x":1}}\n</tool_call>')
    })

    test("text_tool_call and malformed_tool_call are content even in native mode", async () => {
      await using server = await startLocalServer()
      server.queue(reply.text_tool_call({ name: "r", args: {}, format: "hermes" }), reply.malformed_tool_call('{"tool": "r",'))
      expect((await stream(server.url)).content).toBe(renderTextToolCall("r", {}, "hermes"))
      expect((await stream(server.url)).content).toBe('{"tool": "r",')
    })
  })

  test("reply.finish overrides finish_reason", async () => {
    await using server = await startLocalServer()
    server.queue([reply.reasoning("long"), reply.finish("length")])
    expect((await stream(server.url)).finish).toEqual(["length"])
  })

  test("reply.error returns that status and body", async () => {
    await using server = await startLocalServer()
    server.queue(reply.error(429, { error: { message: "slow down" } }))
    const res = await post(server.url, base)
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: { message: "slow down" } })
  })

  test("reject_params: 400 names each rejected param present in the body", async () => {
    await using server = await startLocalServer({ reject_params: ["chat_template_kwargs", "reasoning_effort", "prompt_cache_key"] })
    const res = await post(server.url, { ...base, chat_template_kwargs: { enable_thinking: true }, reasoning_effort: "low" })
    expect(res.status).toBe(400)
    const message = (await res.json()).error.message
    expect(message).toContain("Unrecognized request argument supplied: chat_template_kwargs")
    expect(message).toContain("reasoning_effort")
    expect(message).not.toContain("prompt_cache_key")
    expect((await post(server.url, base)).status).toBe(200)
  })

  test("context_limit: 400 names the limit and the requested tokens", async () => {
    await using server = await startLocalServer({ context_limit: 50 })
    const body = { ...base, messages: [{ role: "user", content: "x".repeat(400) }] }
    const res = await post(server.url, body)
    expect(res.status).toBe(400)
    expect((await res.json()).error.message).toContain(
      `This model's maximum context length is 50 tokens. However, you requested ${countTokens(body)} tokens`,
    )
    expect((await post(server.url, base)).status).toBe(200)
  })

  test("fail_status: the next N requests fail, then the queued reply is served", async () => {
    await using server = await startLocalServer({ fail_status: { code: 503, times: 2 } })
    server.queue(reply.text("recovered"))
    expect((await post(server.url, base)).status).toBe(503)
    expect((await post(server.url, base)).status).toBe(503)
    expect((await stream(server.url)).content).toBe("recovered")
  })

  test("drop_after_chunks aborts the stream once and re-queues the reply", async () => {
    await using server = await startLocalServer({ drop_after_chunks: 3 })
    server.queue(reply.text("a long enough reply to need many chunks"))
    const res = await post(server.url, base)
    const text = await res.text()
    expect(text).not.toContain("[DONE]")
    expect(text).not.toContain("finish_reason\":\"stop")
    expect(server.chats()[0].chunks.length).toBe(3)
    expect(server.chats()[0].dropped).toBe(true)
    expect((await stream(server.url)).content).toBe("a long enough reply to need many chunks")
  })

  test("hang: no response until the client aborts", async () => {
    await using server = await startLocalServer({ hang: true })
    const outcome = await post(server.url, base, { signal: AbortSignal.timeout(200) }).then(
      () => "responded",
      (error: Error) => error.name,
    )
    expect(outcome).toBe("TimeoutError")
    server.set({ hang: false })
    expect((await post(server.url, base)).status).toBe(200)
  })

  test("tokenize: llama.cpp style /tokenize only when enabled", async () => {
    await using server = await startLocalServer({ tokenize: true })
    const tokenize = (content: string) =>
      fetch(`${server.origin}/tokenize`, { method: "POST", body: JSON.stringify({ content }) })
    expect((await (await tokenize("123456789")).json()).tokens).toHaveLength(3)
    server.set({ tokenize: false })
    expect((await tokenize("x")).status).toBe(404)
  })

  test("prefix_cache: repeating a prompt is at least 70% cheaper; disabled keeps full prefill", async () => {
    const body = { ...base, messages: [{ role: "system", content: "pad ".repeat(4000) }, ...(base.messages ?? [])] }
    await using server = await startLocalServer({ prefix_cache: true })
    await stream(server.url, body)
    await stream(server.url, body)
    const [first, second] = server.chats().map((item) => item.prefillMs ?? 0)
    expect(first).toBeGreaterThan(50)
    expect(second).toBeLessThanOrEqual(first * 0.3)

    await using cold = await startLocalServer({ prefix_cache: false })
    await stream(cold.url, body)
    await stream(cold.url, body)
    const [a, b] = cold.chats().map((item) => item.prefillMs ?? 0)
    expect(b).toBe(a)
    expect(cold.chats()[1].firstByteAt! - cold.chats()[1].receivedAt).toBeGreaterThanOrEqual(a - 1)
  })

  test("chunk_delay_ms spaces chunks for latency tests", async () => {
    await using server = await startLocalServer({ chunk_delay_ms: 20 })
    server.queue(reply.text("abcdefgh"))
    const started = Date.now()
    await stream(server.url)
    expect(Date.now() - started).toBeGreaterThanOrEqual(20 * 4)
  })

  test("reachable from a subprocess", async () => {
    await using server = await startLocalServer()
    server.queue(reply.text("from child"))
    const proc = Bun.spawn(
      [
        process.execPath,
        "-e",
        `const r = await fetch(process.env.BASE + "/chat/completions", {method:"POST", body: JSON.stringify({messages:[], stream:false})}); console.log((await r.json()).choices[0].message.content)`,
      ],
      { env: { ...process.env, BASE: server.url }, stdout: "pipe" },
    )
    expect((await new Response(proc.stdout).text()).trim()).toBe("from child")
  })
})

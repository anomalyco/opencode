// One test per ARCHITECTURE §10 fallback row owned by llm/ and profile/, against test/lib/local-server.ts.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Message, ToolDefinition } from "@opencode-ai/llm"
import { fallbackNotices, tokenUsage } from "../../src/llm/client"
import { cacheFile } from "../../src/llm/probe"
import { select } from "../../src/profile/profiles"
import { countTokens, reply, startLocalServer } from "../lib/local-server"
import { tmpdir } from "../lib/tmp"
import { collect, config, joined, pinned, turn, withGateway } from "./gateway"

const data = await tmpdir()
const previous = process.env.XDG_DATA_HOME
beforeAll(() => {
  process.env.XDG_DATA_HOME = data.path
})
afterAll(async () => {
  process.env.XDG_DATA_HOME = previous
  await data[Symbol.asyncDispose]()
})

const user = [Message.user("hi")]
const readTool = new ToolDefinition({ name: "read", description: "Read a file.", inputSchema: { type: "object", properties: { filePath: { type: "string" } } } })

describe("fallback ladder", () => {
  test("reasoning_field=reasoning: the fetch shim turns vLLM delta.reasoning into reasoning events", async () => {
    await using server = await startLocalServer({ reasoning_field: "reasoning" })
    server.queue([reply.reasoning("deep thought"), reply.text("hi there")], [reply.reasoning("deep thought"), reply.text("hi there")])
    const events = await withGateway(config(server, { pins: pinned({ reasoning_field: "reasoning" }) }), (gateway) =>
      Effect.gen(function* () {
        const handle = yield* gateway.resolve("local/test-model")
        return yield* collect(gateway, handle, turn({ messages: user }))
      }),
    )
    expect(joined(events, "reasoning-delta")).toBe("deep thought")
    expect(joined(events, "text-delta")).toBe("hi there")
    // Without the shim the same stream loses its reasoning (the gap the shim covers).
    const plain = await withGateway(config(server, { pins: pinned({ reasoning_field: "reasoning_content" }) }), (gateway) =>
      Effect.gen(function* () {
        return yield* collect(gateway, yield* gateway.resolve("local/test-model"), turn({ messages: user }))
      }),
    )
    expect(joined(plain, "reasoning-delta")).toBe("")
  })

  test("reasoning none + think_tags: <think> content becomes reasoning events", async () => {
    await using server = await startLocalServer({ think_tags: true, reasoning_field: "none", delta_chars: 3 })
    server.queue([reply.reasoning("inner monologue"), reply.text("final answer")])
    const cfg = config(server, { pins: pinned({ reasoning_field: "none", think_tags: true }) })
    const result = await withGateway(cfg, (gateway) =>
      Effect.gen(function* () {
        const handle = yield* gateway.resolve("local/test-model")
        return { events: yield* collect(gateway, handle, turn({ messages: user })), notices: fallbackNotices(handle) }
      }),
    )
    expect(joined(result.events, "reasoning-delta")).toBe("inner monologue")
    expect(joined(result.events, "text-delta")).toBe("final answer")
    expect(result.notices.map((item) => item.message)).toContain("reasoning: splitting <think> tags out of the text")
  })

  test("usage_in_stream=false: usage is estimated (chars/4) and marked estimated", async () => {
    await using server = await startLocalServer({ usage_in_stream: false })
    server.queue(reply.text("abcdefgh"))
    const events = await withGateway(config(server, { pins: pinned({ usage_in_stream: false }) }), (gateway) =>
      Effect.gen(function* () {
        return yield* collect(gateway, yield* gateway.resolve("local/test-model"), turn({ messages: user, tools: [readTool] }))
      }),
    )
    const finish = events.find((event) => event.type === "finish")
    const usage = tokenUsage(finish?.type === "finish" ? finish.usage : undefined)
    expect(usage.estimated).toBe(true)
    expect(usage.input).toBe(countTokens(server.chats()[0]!.body!))
    expect(usage.output).toBe(2)
    expect(server.chats()[0]!.chunks.some((chunk) => typeof chunk.data === "object" && chunk.data !== null && "usage" in chunk.data)).toBe(false)
  })

  test("usage_in_stream=false with llama.cpp /tokenize: counts come from the server tokenizer", async () => {
    await using server = await startLocalServer({ usage_in_stream: false, tokenize: true })
    server.queue(reply.text("ok"))
    const events = await withGateway(config(server, { pins: pinned({ usage_in_stream: false, tokenize: true }) }), (gateway) =>
      Effect.gen(function* () {
        return yield* collect(gateway, yield* gateway.resolve("local/test-model"), turn({ messages: user }))
      }),
    )
    const finish = events.find((event) => event.type === "finish")
    expect(finish?.type === "finish" && tokenUsage(finish.usage).input).toBe(countTokens(server.chats()[0]!.body!))
    expect(server.requests.some((item) => item.path === "/tokenize")).toBe(true)
  })

  test("usage reported by the server is not marked estimated", async () => {
    await using server = await startLocalServer({})
    server.queue(reply.text("ok"))
    const events = await withGateway(config(server, { pins: pinned() }), (gateway) =>
      Effect.gen(function* () {
        return yield* collect(gateway, yield* gateway.resolve("local/test-model"), turn({ messages: user }))
      }),
    )
    const finish = events.find((event) => event.type === "finish")
    expect(finish?.type === "finish" && tokenUsage(finish.usage)).toMatchObject({ estimated: false, input: countTokens(server.chats()[0]!.body!) })
  })

  test("reject_params: 400 naming params → stripped, persisted, retried once", async () => {
    await using server = await startLocalServer({ reject_params: ["prompt_cache_key", "reasoning_effort"] })
    server.queue(reply.text("ok"), reply.text("again"))
    const cfg = config(server, { pins: pinned({}, {}), models: { "test-model": { reasoning: true, options: { reasoning_effort: "low" } } } })
    const result = await withGateway(cfg, (gateway) =>
      Effect.gen(function* () {
        const handle = yield* gateway.resolve("local/test-model")
        const first = yield* collect(gateway, handle, turn({ messages: user, thinking: true }))
        const second = yield* collect(gateway, handle, turn({ messages: user, thinking: true }))
        return { first, second, handle }
      }),
    )
    expect(joined(result.first, "text-delta")).toBe("ok")
    expect(joined(result.second, "text-delta")).toBe("again")
    const chats = server.chats()
    expect(chats.map((item) => item.status)).toEqual([400, 200, 200])
    expect(chats.slice(1).every((item) => !("prompt_cache_key" in item.body!) && !("reasoning_effort" in item.body!))).toBe(true)
    expect(chats[1]!.body!.chat_template_kwargs).toEqual({ enable_thinking: true })
    const record = await Bun.file(cacheFile(server.url, "test-model")).json()
    expect(record.accepts).toMatchObject({ prompt_cache_key: false, reasoning_effort: false, chat_template_kwargs: true })
    expect(record.sources.accepts).toBe("error-400")
    expect(fallbackNotices(result.handle).map((item) => item.message)).toContain("request: prompt_cache_key not accepted by the server, not sent")
  })

  test("reject_params: no blind retry loop — a 400 on the retry, or one naming no param, fails", async () => {
    await using server = await startLocalServer({ context_limit: 1 })
    const exit = await withGateway(config(server, { pins: pinned() }), (gateway) =>
      Effect.gen(function* () {
        return yield* collect(gateway, yield* gateway.resolve("local/test-model"), turn({ messages: user })).pipe(Effect.exit)
      }),
    )
    expect(exit._tag).toBe("Failure")
    expect(server.chats().length).toBe(1)
  })

  test("context_window unknown → 32768 default with a one-time notice", async () => {
    await using server = await startLocalServer({ models: "none" })
    const probeReply = [reply.tool_call({ name: "probe", args: { x: 1 } })]
    server.queue(probeReply, probeReply)
    const result = await withGateway(config(server), (gateway) =>
      Effect.gen(function* () {
        const handle = yield* gateway.resolve("local/test-model")
        const notice = fallbackNotices(handle).find((item) => item.message.startsWith("context window"))!
        return { handle, notice, first: yield* gateway.notice(notice.key, notice.message), second: yield* gateway.notice(notice.key, notice.message) }
      }),
    )
    expect(result.handle.contextWindow).toBe(32768)
    expect(result.handle.capabilities.context_window).toBe(32768)
    expect(result.notice.message).toContain(`pin servers[<your base URL>].context_window for 127.0.0.1:${new URL(server.url).port}`)
    expect([result.first, result.second]).toEqual([true, false])
  })

  test("/no_think is appended only when no_think_suffix is pinned (and enable_thinking can't be sent)", async () => {
    await using server = await startLocalServer({})
    const send = (caps: Parameters<typeof pinned>[0], thinking: boolean) =>
      withGateway(config(server, { pins: pinned(caps) }), (gateway) =>
        Effect.gen(function* () {
          return yield* collect(gateway, yield* gateway.resolve("local/test-model"), turn({ messages: user, thinking }))
        }),
      )
    await send({ no_think_suffix: true, accepts: { chat_template_kwargs: false } }, false)
    await send({ no_think_suffix: false, accepts: { chat_template_kwargs: false } }, false)
    await send({ no_think_suffix: true, accepts: { chat_template_kwargs: false } }, true)
    await send({ no_think_suffix: true, accepts: { chat_template_kwargs: true } }, false)
    const last = server.chats().map((item) => String(item.body!.messages!.at(-1)!.content))
    expect(last).toEqual(["hi\n/no_think", "hi", "hi", "hi"])
    expect(server.chats()[3]!.body!.chat_template_kwargs).toEqual({ enable_thinking: false })
  })

  test("prefix_cache=false → select() gives local-min for a loopback provider", async () => {
    await using server = await startLocalServer({})
    const profile = (prefix_cache: boolean) =>
      withGateway(config(server, { pins: pinned({ prefix_cache }) }), (gateway) =>
        Effect.gen(function* () {
          const handle = yield* gateway.resolve("local/test-model")
          return { auto: select({ handle }).name, explicit: select({ handle, explicit: "local" }).name, notices: fallbackNotices(handle) }
        }),
      )
    const off = await profile(false)
    expect(off.auto).toBe("local-min")
    expect(off.explicit).toBe("local")
    expect(off.notices.map((item) => item.message)).toContain("prefix cache: none detected; auto profile is local-min")
    expect((await profile(true)).auto).toBe("local")
  })

  test("unreachable provider with every capability pinned → ConfigError at resolve (exit 2)", async () => {
    const server = await startLocalServer({})
    const cfg = config(server, { pins: pinned() })
    await server.stop()
    const error = await withGateway(cfg, (gateway) => gateway.resolve("local/test-model").pipe(Effect.flip))
    expect(error._tag).toBe("oclite/ConfigError")
    expect(error.message).toContain(`cannot reach ${server.url}`)
  })

  test("a dropped stream's error text carries the redacted base URL", async () => {
    await using server = await startLocalServer({ drop_after_chunks: 2 })
    server.queue(reply.text("cut short"))
    const secret = server.url.replace("http://", "http://someone:sekretpass1@")
    const cfg = { ...config(server, {}), provider: { local: { options: { baseURL: secret } } }, servers: { [secret]: pinned() } }
    const error = await withGateway(cfg, (gateway) =>
      Effect.gen(function* () {
        return yield* collect(gateway, yield* gateway.resolve("local/test-model"), turn({ messages: user })).pipe(Effect.flip)
      }),
    )
    expect(error.message).toContain("ended without finish_reason")
    expect(error.message).not.toContain("sekretpass1")
  })

  test("a stream that ends without finish_reason fails as a retryable drop", async () => {
    await using server = await startLocalServer({ drop_after_chunks: 3 })
    server.queue(reply.text("a long answer that gets cut"))
    const exit = await withGateway(config(server, { pins: pinned() }), (gateway) =>
      Effect.gen(function* () {
        return yield* collect(gateway, yield* gateway.resolve("local/test-model"), turn({ messages: user })).pipe(Effect.flip)
      }),
    )
    expect(exit.retryable).toBe(true)
    expect(exit.message).toContain("ended without finish_reason")
  })
})

describe("request shaping", () => {
  test("max_tokens = pin ?? model output ?? 4096, ≥ 8192 for reasoning; optional params only when accepted", async () => {
    await using server = await startLocalServer({})
    const shape = (input: Parameters<typeof config>[1], thinking?: boolean, tools = [readTool]) =>
      withGateway(config(server, input), (gateway) =>
        Effect.gen(function* () {
          const handle = yield* gateway.resolve("local/test-model")
          yield* collect(gateway, handle, turn({ messages: user, thinking, tools }))
          return handle
        }),
      ).then(() => server.chats().at(-1)!.body!)
    // A server that streams reasoning makes the model a reasoning model unless the models config says otherwise.
    expect((await shape({ pins: pinned() })).max_tokens).toBe(8192)
    expect((await shape({ pins: pinned({ reasoning_field: "none" }) })).max_tokens).toBe(4096)
    expect((await shape({ pins: pinned(), models: { "test-model": { limit: { output: 2048 }, reasoning: false } } })).max_tokens).toBe(2048)
    expect((await shape({ pins: pinned(), models: { "test-model": { limit: { output: 2048 }, reasoning: true } } })).max_tokens).toBe(8192)
    expect((await shape({ pins: pinned({}, { max_tokens: 1000 }), models: { "test-model": { reasoning: true } } })).max_tokens).toBe(1000)

    const all = await shape({ pins: pinned(), models: { "test-model": { reasoning: true } } }, false)
    expect(all).toMatchObject({ prompt_cache_key: "ses_test", parallel_tool_calls: false, chat_template_kwargs: { enable_thinking: false } })
    // reasoning_effort is opt-in per model (provider.<id>.models.<model>.options.reasoning_effort), even when accepted.
    expect("reasoning_effort" in all).toBe(false)
    const effort = await shape({ pins: pinned(), models: { "test-model": { reasoning: true, options: { reasoning_effort: "high" } } } }, true)
    expect(effort.reasoning_effort).toBe("high")
    // Keyed by ref: a copied handle (the loop copies it after overflow recovery) still sends it.
    const copied = await withGateway(config(server, { pins: pinned(), models: { "test-model": { options: { reasoning_effort: "high" } } } }), (gateway) =>
      Effect.gen(function* () {
        const handle = yield* gateway.resolve("local/test-model")
        yield* collect(gateway, { ...handle, contextWindow: 1000 }, turn({ messages: user }))
      }),
    ).then(() => server.chats().at(-1)!.body!)
    expect(copied.reasoning_effort).toBe("high")
    const refused = await shape({ pins: pinned({ accepts: { reasoning_effort: false } }), models: { "test-model": { options: { reasoning_effort: "high" } } } }, true)
    expect("reasoning_effort" in refused).toBe(false)
    const none = await shape({ pins: pinned({ accepts: { chat_template_kwargs: false, prompt_cache_key: false, reasoning_effort: false, parallel_tool_calls: false } }) }, true)
    expect(["prompt_cache_key", "parallel_tool_calls", "chat_template_kwargs", "reasoning_effort"].some((key) => key in none)).toBe(false)
    const noTools = await shape({ pins: pinned() }, undefined, [])
    expect("parallel_tool_calls" in noTools || "chat_template_kwargs" in noTools).toBe(false)
  })

  test("byte-stable prefix: two requests of one session send identical system + tools bytes", async () => {
    await using server = await startLocalServer({})
    const tools = [readTool, new ToolDefinition({ name: "bash", description: "Run.", inputSchema: { type: "object", properties: {} } })]
    await withGateway(config(server, { pins: pinned() }), (gateway) =>
      Effect.gen(function* () {
        const handle = yield* gateway.resolve("local/test-model")
        yield* collect(gateway, handle, turn({ messages: user, tools }))
        yield* collect(gateway, handle, turn({ messages: [...user, Message.assistant("ok"), Message.user("more")], tools }))
      }),
    )
    const [a, b] = server.chats().map((item) => item.body!)
    expect(JSON.stringify(a!.messages![0])).toBe(JSON.stringify(b!.messages![0]))
    expect(JSON.stringify(a!.tools)).toBe(JSON.stringify(b!.tools))
    expect([a!.prompt_cache_key, b!.prompt_cache_key]).toEqual(["ses_test", "ses_test"])
  })

  test("hosted anthropic resolves to the STATIC record without any request", async () => {
    await using server = await startLocalServer({})
    const handle = await withGateway({ ...config(server), provider: {} }, (gateway) => gateway.resolve("anthropic/claude-sonnet-5"))
    expect(handle).toMatchObject({ local: false, baseURL: "https://api.anthropic.com/v1", maxTokens: 4096, reasoning: false })
    expect(handle.capabilities.concurrency).toBe(8)
    expect(select({ handle }).name).toBe("default")
    expect(server.requests.length).toBe(0)
  })
})

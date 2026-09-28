import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { ServerPins } from "../../src/contract"
import { cacheFile, persist, probe, STATIC, staticRecord } from "../../src/llm/probe"
import { type LocalServer, reply, startLocalServer, type Toggles } from "../lib/local-server"
import { tmpdir } from "../lib/tmp"

// probe() caches under dataDir(), which reads XDG_DATA_HOME at call time.
const data = await tmpdir()
const previous = process.env.XDG_DATA_HOME
beforeAll(() => {
  process.env.XDG_DATA_HOME = data.path
})
afterAll(async () => {
  process.env.XDG_DATA_HOME = previous
  await data[Symbol.asyncDispose]()
})

const toolReply = [reply.reasoning("thinking about it"), reply.tool_call({ name: "probe", args: { x: 1 } })]

function counted(server: LocalServer) {
  return server.requests.filter((item) => item.path === "/v1/models" || item.path === "/v1/chat/completions").length
}

async function probed(toggles: Partial<Toggles>, pins?: ServerPins, reprobe = true) {
  const server = await startLocalServer({ prefill_ms_per_kchar: 40, ...toggles })
  server.queue(toolReply, toolReply)
  const record = await Effect.runPromise(probe({ baseURL: server.url, model: "test-model", pins, reprobe }))
  return { server, record }
}

describe("probe", () => {
  test("vLLM-like defaults: every field probed in ≤ 3 requests, no unknown sources", async () => {
    const { server, record } = await probed({ context_window: 16384 })
    await using _ = server
    expect(counted(server)).toBeLessThanOrEqual(3)
    expect(record).toMatchObject({
      context_window: 16384, usage_in_stream: true, reasoning_field: "reasoning_content", think_tags: false,
      tools_native: true, prefix_cache: true, concurrency: 1, tokenize: false, no_think_suffix: false,
      accepts: { chat_template_kwargs: true, prompt_cache_key: true, reasoning_effort: true, parallel_tool_calls: true },
    })
    expect(Object.keys(record.sources).sort()).toEqual(Object.keys(STATIC).sort())
    expect(Object.values(record.sources).every((source) => ["probe", "config", "default", "static", "error-400"].includes(source))).toBe(true)
    expect(record.sources.context_window).toBe("probe")
    expect(record.ttft_ms?.length).toBe(2)
    // R2 carried every optional param.
    const r2 = server.chats()[0]?.body ?? {}
    expect(r2.chat_template_kwargs).toEqual({ enable_thinking: true })
    expect(["prompt_cache_key", "reasoning_effort", "parallel_tool_calls"].every((key) => key in r2)).toBe(true)
  })

  test.each<[string, Partial<Toggles>, Record<string, unknown>]>([
    ["lmstudio context_length", { models: "lmstudio", context_window: 8192 }, { context_window: 8192, tokenize: false }],
    ["llama.cpp n_ctx_train + tokenize", { models: "llamacpp", context_window: 4096 }, { context_window: 4096, tokenize: true }],
    ["usage_in_stream=false", { usage_in_stream: false }, { usage_in_stream: false }],
    ["delta.reasoning (vLLM)", { reasoning_field: "reasoning" }, { reasoning_field: "reasoning", think_tags: false }],
    ["no reasoning field", { reasoning_field: "none" }, { reasoning_field: "none", think_tags: false }],
    ["inline <think> tags", { think_tags: true, reasoning_field: "none" }, { reasoning_field: "none", think_tags: true }],
    ["text tools", { tools: "text" }, { tools_native: false }],
    ["no prefix cache", { prefix_cache: false }, { prefix_cache: false }],
  ])("toggle: %s", async (_name, toggles, expected) => {
    const { server, record } = await probed(toggles)
    await using _ = server
    expect(record).toMatchObject(expected)
    expect(counted(server)).toBeLessThanOrEqual(3)
  })

  test("/v1/models missing → context 32768 (source default) with a notice", async () => {
    const { server, record } = await probed({ models: "none" })
    await using _ = server
    expect(record.context_window).toBe(32768)
    expect(record.sources.context_window).toBe("default")
    expect(record.notes.join("\n")).toContain("context window: unknown, using 32768")
  })

  test("reject_params: 400 naming a param marks only that param false; R3 is the canary", async () => {
    const { server, record } = await probed({ reject_params: ["prompt_cache_key"] })
    await using _ = server
    expect(record.accepts).toEqual({ chat_template_kwargs: true, prompt_cache_key: false, reasoning_effort: true, parallel_tool_calls: true })
    expect(record.tools_native).toBe(true)
    expect(record.prefix_cache).toBe(false)
    expect(record.sources.prefix_cache).toBe("default")
    expect(record.notes.join("\n")).toContain("capabilities.prefix_cache")
    expect(counted(server)).toBe(3)
    expect(server.chats()[1]?.body && "prompt_cache_key" in server.chats()[1]!.body!).toBe(false)
  })

  test("pins skip probing: fully pinned server gets only a reachability GET /models", async () => {
    const pins: ServerPins = {
      context_window: 65536,
      concurrency: 2,
      capabilities: {
        usage_in_stream: true, reasoning_field: "none", think_tags: false, tools_native: false, prefix_cache: true,
        tokenize: false, no_think_suffix: true,
        accepts: { chat_template_kwargs: false, prompt_cache_key: true, reasoning_effort: false, parallel_tool_calls: false },
      },
    }
    const { server, record } = await probed({}, pins)
    await using _ = server
    expect(server.chats().length).toBe(0)
    expect(server.requests.map((item) => item.path)).toEqual(["/v1/models"])
    expect(record).toMatchObject({ context_window: 65536, concurrency: 2, tools_native: false, no_think_suffix: true, prefix_cache: true })
    expect(Object.values(record.sources).every((source) => source === "config")).toBe(true)
  })

  test("partial pins: pinned params are not offered, pinned fields keep source config", async () => {
    const { server, record } = await probed({}, { capabilities: { accepts: { reasoning_effort: false }, tools_native: true } })
    await using _ = server
    expect(server.chats().every((item) => !("reasoning_effort" in (item.body ?? {})))).toBe(true)
    expect(record.accepts.reasoning_effort).toBe(false)
    expect(record.sources.tools_native).toBe("config")
  })

  test("cache: reused within TTL, re-probed after it, --reprobe forces", async () => {
    await using server = await startLocalServer({ context_window: 12000 })
    server.queue(toolReply, toolReply, toolReply, toolReply)
    const run = (reprobe: boolean) => Effect.runPromise(probe({ baseURL: server.url, model: "cache-model", reprobe }))
    await run(true)
    const after = server.chats().length
    const again = await run(false)
    // A cache hit sends no chat, only the reachability GET /models.
    expect(server.chats().length).toBe(after)
    expect(server.requests.at(-1)?.path).toBe("/v1/models")
    expect(again.context_window).toBe(12000)

    const file = cacheFile(server.url, "cache-model")
    expect(file).toContain(`127.0.0.1_${new URL(server.url).port}-cache-model.json`)
    const record = await Bun.file(file).json()
    await Bun.write(file, JSON.stringify({ ...record, probed_at: Date.now() - 8 * 24 * 3600 * 1000 }))
    await run(false)
    expect(server.chats().length).toBeGreaterThan(after)

    const before = server.chats().length
    await run(true)
    expect(server.chats().length).toBeGreaterThan(before)
  })

  test("persist merges a runtime finding with its source", async () => {
    await using server = await startLocalServer({})
    server.queue(toolReply, toolReply)
    await Effect.runPromise(probe({ baseURL: server.url, model: "persist-model", reprobe: true }))
    await Effect.runPromise(persist(server.url, "persist-model", { context_window: 9000, accepts: { reasoning_effort: false } }, "error-400"))
    const record = await Effect.runPromise(probe({ baseURL: server.url, model: "persist-model", reprobe: false }))
    expect(record.context_window).toBe(9000)
    expect(record.accepts.reasoning_effort).toBe(false)
    expect(record.accepts.prompt_cache_key).toBe(true)
    expect(record.sources.context_window).toBe("error-400")
  })

  test("unreachable server → ConfigError naming the base URL", async () => {
    const exit = await Effect.runPromiseExit(probe({ baseURL: "http://127.0.0.1:9/v1", model: "x", reprobe: true }))
    expect(exit._tag).toBe("Failure")
    expect(String(exit)).toContain("cannot reach http://127.0.0.1:9/v1")
  })

  test("secrets in the baseURL never reach error text or the cache file", async () => {
    await using server = await startLocalServer({})
    const secret = `http://someone:sekretpass1@127.0.0.1:${new URL(server.url).port}/v1?api_key=topsecret99`
    const record = await Effect.runPromise(probe({ baseURL: secret, model: "secret-model", reprobe: true }))
    const cached = await Bun.file(cacheFile(secret, "secret-model")).text()
    const down = await Effect.runPromiseExit(probe({ baseURL: "http://someone:sekretpass1@127.0.0.1:9/v1?api_key=topsecret99", model: "x", reprobe: true }))
    ;[JSON.stringify(record), cached, cacheFile(secret, "secret-model"), String(down)].forEach((text) => {
      expect(text).not.toContain("sekretpass1")
      expect(text).not.toContain("topsecret99")
    })
    expect(String(down)).toContain("cannot reach")
  })

  test("chat that never answers (after /models did): bounded, conservative defaults, R3 skipped", async () => {
    await using server = await startLocalServer({ hang: true })
    const started = Date.now()
    const record = await Effect.runPromise(probe({ baseURL: server.url, model: "hang-model", reprobe: true, timeouts: { chat: 200 } }))
    expect(Date.now() - started).toBeLessThan(3000)
    expect(server.chats().length).toBe(1)
    expect(record).toMatchObject({
      tools_native: true, reasoning_field: "reasoning_content", think_tags: false, usage_in_stream: true, prefix_cache: false,
      accepts: { chat_template_kwargs: false, prompt_cache_key: false, reasoning_effort: false, parallel_tool_calls: false },
    })
    ;(["tools_native", "reasoning_field", "think_tags", "usage_in_stream", "accepts", "prefix_cache"] as const)
      .forEach((key) => expect(record.sources[key]).toBe("default"))
    expect(record.notes.join("\n")).toContain(`probe timed out after 0.2 s; pin servers[<your base URL>].capabilities for 127.0.0.1:${new URL(server.url).port} to skip`)
  })

  test("slow body (slow-CPU server): chat timeout mid-stream → defaults; probe_timeout_ms raises the limit", async () => {
    await using server = await startLocalServer({ chunk_delay_ms: 60 })
    server.queue(toolReply, toolReply)
    const slow = await Effect.runPromise(probe({ baseURL: server.url, model: "slow-model", reprobe: true, timeouts: { chat: 100 } }))
    expect(slow.sources.tools_native).toBe("default")
    expect(slow.notes.join("\n")).toContain("probe timed out after 0.1 s")
    const pins = { probe_timeout_ms: 10_000 } as ServerPins
    const patient = await Effect.runPromise(probe({ baseURL: server.url, model: "slow-model", reprobe: true, pins, timeouts: { chat: 100 } }))
    expect(patient).toMatchObject({ tools_native: true, reasoning_field: "reasoning_content", usage_in_stream: true })
    expect(patient.sources.tools_native).toBe("probe")
    expect(patient.accepts.prompt_cache_key).toBe(true)
  })

  test("pin hints name the config key generically and show host:port only", async () => {
    await using server = await startLocalServer({ models: "none" })
    server.queue(toolReply, toolReply)
    const secret = server.url.replace("http://", "http://someone:sekretpass1@")
    const record = await Effect.runPromise(probe({ baseURL: secret, model: "hint-model", reprobe: true }))
    expect(record.notes.join("\n")).toContain(`pin servers[<your base URL>].context_window for 127.0.0.1:${new URL(server.url).port}`)
    expect(record.notes.join("\n")).not.toContain("sekretpass1")
  })

  test("STATIC record for hosted providers", () => {
    const record = staticRecord("https://api.anthropic.com/v1", "claude-sonnet-5", { context_window: 1_000_000 })
    expect(record.concurrency).toBe(8)
    expect(record.context_window).toBe(1_000_000)
    expect(record.sources.context_window).toBe("config")
    expect(record.sources.tools_native).toBe("static")
  })
})

import { afterEach, describe, expect, test } from "bun:test"
import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { VllmPlugin } from "../../src/plugin/vllm"

type Config = Parameters<NonNullable<Hooks["config"]>>[0]

const env = new Map<string, string | undefined>()

function setEnv(key: string, value: string | undefined) {
  if (!env.has(key)) env.set(key, process.env[key])
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

afterEach(() => {
  for (const [key, value] of env) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  env.clear()
})

function serve(handler: (request: Request) => Response) {
  const requests: Array<{ path: string; authorization: string | null }> = []
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      requests.push({ path: new URL(request.url).pathname, authorization: request.headers.get("authorization") })
      return handler(request)
    },
  })
  return { server, requests, baseURL: `${server.url}v1`, [Symbol.dispose]: () => server.stop(true) }
}

const cards = Response.json({
  object: "list",
  data: [
    { id: "Qwen/Qwen3-Coder-30B-A3B-Instruct", object: "model", owned_by: "vllm", max_model_len: 262_144 },
    { id: "checkpoint_0001500", object: "model", owned_by: "vllm", max_model_len: null },
    { id: "not-vllm", object: "model", owned_by: "openai", max_model_len: 8_192 },
  ],
})

// The SDK config type lags the runtime schema (no `interleaved`), so build expectations from a helper.
function card(id: string, context: number) {
  return { name: id, limit: { context, output: 0 }, interleaved: "reasoning_content" }
}

async function run(cfg: Config) {
  const hook = (await VllmPlugin({} as PluginInput)).config!
  await hook(cfg)
  return cfg
}

describe("VllmPlugin", () => {
  test("discovers models from the configured base URL", async () => {
    using fixture = serve(() => cards.clone())
    const cfg = await run({ provider: { vllm: { options: { baseURL: `${fixture.baseURL}/` } } } })

    expect(fixture.requests).toEqual([{ path: "/v1/models", authorization: null }])
    expect(cfg.provider?.vllm).toEqual({
      npm: "@ai-sdk/openai-compatible",
      name: "vLLM",
      env: ["VLLM_API_KEY"],
      options: { baseURL: fixture.baseURL },
      models: {
        "Qwen/Qwen3-Coder-30B-A3B-Instruct": card("Qwen/Qwen3-Coder-30B-A3B-Instruct", 262_144),
        checkpoint_0001500: card("checkpoint_0001500", 0),
      },
    })
  })

  test("reads the base URL and API key from the environment", async () => {
    using fixture = serve(() => cards.clone())
    setEnv("VLLM_BASE_URL", fixture.baseURL)
    setEnv("VLLM_API_KEY", "secret")
    const cfg = await run({})

    expect(fixture.requests).toEqual([{ path: "/v1/models", authorization: "Bearer secret" }])
    expect(cfg.provider?.vllm?.options).toEqual({ baseURL: fixture.baseURL })
    expect(Object.keys(cfg.provider?.vllm?.models ?? {})).toEqual([
      "Qwen/Qwen3-Coder-30B-A3B-Instruct",
      "checkpoint_0001500",
    ])
  })

  test("keeps declared provider and model settings on top of discovery", async () => {
    using fixture = serve(() => cards.clone())
    const cfg = await run({
      provider: {
        vllm: {
          name: "GPU box",
          options: { baseURL: fixture.baseURL, apiKey: "token", timeout: 1000 },
          models: {
            checkpoint_0001500: {
              name: "Checkpoint",
              limit: { context: 131_072, output: 16_384 },
              reasoning: true,
            },
          },
        },
      },
    })

    expect(fixture.requests[0].authorization).toBe("Bearer token")
    expect(cfg.provider?.vllm?.name).toBe("GPU box")
    expect(cfg.provider?.vllm?.options).toEqual({ baseURL: fixture.baseURL, apiKey: "token", timeout: 1000 })
    expect(cfg.provider?.vllm?.models?.checkpoint_0001500).toEqual({
      ...card("checkpoint_0001500", 0),
      name: "Checkpoint",
      limit: { context: 131_072, output: 16_384 },
      reasoning: true,
    })
    expect(cfg.provider?.vllm?.models?.["Qwen/Qwen3-Coder-30B-A3B-Instruct"]?.limit).toEqual({
      context: 262_144,
      output: 0,
    })
  })

  test("leaves config untouched when the server is unavailable", async () => {
    using fixture = serve(() => new Response(null, { status: 503 }))
    const declared = { options: { baseURL: fixture.baseURL }, models: { manual: { name: "Manual" } } }
    const cfg = await run({ provider: { vllm: structuredClone(declared) } })

    expect(cfg.provider?.vllm).toEqual(declared)
  })

  test("leaves config untouched when no vLLM model cards are served", async () => {
    using fixture = serve(() => Response.json({ object: "list", data: [{ id: "other", owned_by: "openai" }] }))
    const cfg = await run({ provider: { vllm: { options: { baseURL: fixture.baseURL } } } })

    expect(cfg.provider?.vllm?.models).toBeUndefined()
  })

  test("skips discovery for a disabled provider", async () => {
    using fixture = serve(() => cards.clone())
    const cfg = await run({
      disabled_providers: ["vllm"],
      provider: { vllm: { options: { baseURL: fixture.baseURL } } },
    })

    expect(fixture.requests).toEqual([])
    expect(cfg.provider?.vllm?.models).toBeUndefined()
  })
})

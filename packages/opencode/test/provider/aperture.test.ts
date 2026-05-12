import { test, expect, describe, afterEach } from "bun:test"
import path from "path"

import { ProviderID } from "../../src/provider/schema"
import { tmpdir } from "../fixture/fixture"
import { WithInstance } from "../../src/project/with-instance"
import { Provider } from "@/provider/provider"
import { Env } from "../../src/env"
import { Effect } from "effect"
import { AppRuntime } from "../../src/effect/app-runtime"
import { makeRuntime } from "../../src/effect/run-service"

const env = makeRuntime(Env.Service, Env.defaultLayer)
const set = (k: string, v: string) => env.runSync((svc) => svc.set(k, v))

async function list() {
  return AppRuntime.runPromise(
    Effect.gen(function* () {
      const provider = yield* Provider.Service
      return yield* provider.list()
    }),
  )
}

const originalFetch = globalThis.fetch

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    return handler(url, init)
  }
}

function apertureModel(overrides: {
  id: string
  name?: string
  providerId?: string
  pricing?: {
    input?: string
    output?: string
    input_cache_read?: string
    input_cache_write?: string
  }
}) {
  return {
    id: overrides.id,
    name: overrides.name,
    metadata: overrides.providerId !== undefined ? { provider: { id: overrides.providerId } } : undefined,
    pricing: overrides.pricing,
  }
}

function mockModelsResponse(models: ReturnType<typeof apertureModel>[]) {
  return Response.json({ data: models })
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

async function withAperture(
  models: ReturnType<typeof apertureModel>[],
  fn: (providers: Record<string, any>) => void | Promise<void>,
  baseUrl: string | false = "http://aperture.test",
) {
  mockFetch((url) => {
    if (url.includes("/v1/models")) return mockModelsResponse(models)
    return new Response("not found", { status: 404 })
  })
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json" }))
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      if (baseUrl !== false) set("APERTURE_BASE_URL", baseUrl)
      const providers = await list()
      await fn(providers)
    },
  })
}

async function withApertureCustomFetch(
  fetchHandler: (url: string, init?: RequestInit) => Response | Promise<Response>,
  fn: (providers: Record<string, any>) => void | Promise<void>,
) {
  mockFetch(fetchHandler)
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json" }))
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      set("APERTURE_BASE_URL", "http://aperture.test")
      const providers = await list()
      await fn(providers)
    },
  })
}

describe("Aperture provider", () => {
  test("SDK mapping", async () => {
    const cases = [
      { providerId: "anthropic", modelId: "claude-haiku-4-5", expectedNpm: "@ai-sdk/anthropic" },
      { providerId: "mantle-anthropic", modelId: "claude-haiku-4-5", expectedNpm: "@ai-sdk/anthropic" },
      { providerId: "mantle", modelId: "anthropic.claude-opus-4-7", expectedNpm: "@ai-sdk/anthropic" },
      { providerId: "bedrock", modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0", expectedNpm: "@ai-sdk/anthropic" },
      { providerId: "vertex", modelId: "claude-sonnet-4-20250514", expectedNpm: "@ai-sdk/anthropic" },
      { providerId: "vertex", modelId: "gemini-2.5-pro", expectedNpm: "@ai-sdk/openai-compatible" },
      { providerId: "openai", modelId: "gpt-4o", expectedNpm: "@ai-sdk/openai" },
      { providerId: "openrouter", modelId: "meta-llama/llama-3.2-3b-instruct", expectedNpm: "@ai-sdk/openai-compatible" },
      { providerId: "some-unknown-provider", modelId: "some-model", expectedNpm: "@ai-sdk/openai-compatible" },
    ]
    for (const c of cases) {
      await withAperture([apertureModel({ id: c.modelId, providerId: c.providerId })], (providers) => {
        expect(providers[ProviderID.aperture]).toBeDefined()
        const model = providers[ProviderID.aperture].models[c.modelId]
        expect(model).toBeDefined()
        expect(model.api.npm).toBe(c.expectedNpm)
      })
    }
  })

  test("normal pricing values", async () => {
    await withAperture(
      [apertureModel({ id: "test-model", providerId: "anthropic", pricing: { input: "0.00000100", output: "0.00000500", input_cache_read: "0.00000050", input_cache_write: "0.00000200" } })],
      (providers) => {
        const model = providers[ProviderID.aperture].models["test-model"]
        expect(model.cost.input).toBe(0.000001)
        expect(model.cost.output).toBe(0.000005)
        expect(model.cost.cache.read).toBe(0.0000005)
        expect(model.cost.cache.write).toBe(0.000002)
      },
    )
  })

  test("missing pricing defaults to zero", async () => {
    await withAperture([apertureModel({ id: "no-price-model", providerId: "anthropic" })], (providers) => {
      const model = providers[ProviderID.aperture].models["no-price-model"]
      expect(model.cost.input).toBe(0)
      expect(model.cost.output).toBe(0)
      expect(model.cost.cache.read).toBe(0)
      expect(model.cost.cache.write).toBe(0)
    })
  })

  test("malformed pricing (NaN) defaults to zero", async () => {
    await withAperture(
      [apertureModel({ id: "free-model", providerId: "openai", pricing: { input: "free", output: "also-free" } })],
      (providers) => {
        const model = providers[ProviderID.aperture].models["free-model"]
        expect(model.cost.input).toBe(0)
        expect(model.cost.output).toBe(0)
      },
    )
  })

  test("partial cache pricing", async () => {
    await withAperture(
      [apertureModel({ id: "partial-cache", providerId: "anthropic", pricing: { input: "0.001", output: "0.002", input_cache_read: "0.0005" } })],
      (providers) => {
        const model = providers[ProviderID.aperture].models["partial-cache"]
        expect(model.cost.cache.read).toBe(0.0005)
        expect(model.cost.cache.write).toBe(0)
      },
    )
  })

  test("capability detection", async () => {
    const cases = [
      { id: "claude-sonnet-4", providerId: "anthropic", attachment: true, image: true },
      { id: "gpt-4o", providerId: "openai", attachment: false, image: true },
      { id: "gemini-2.5-pro", providerId: "vertex", attachment: false, image: false },
      { id: "unknown-model", providerId: "some-provider", attachment: false, image: false },
    ]
    for (const c of cases) {
      await withAperture([apertureModel({ id: c.id, providerId: c.providerId })], (providers) => {
        const model = providers[ProviderID.aperture].models[c.id]
        expect(model.capabilities.attachment).toBe(c.attachment)
        expect(model.capabilities.input.image).toBe(c.image)
      })
    }
    // unknown models also get toolcall and temperature
    await withAperture([apertureModel({ id: "unknown-model", providerId: "some-provider" })], (providers) => {
      const model = providers[ProviderID.aperture].models["unknown-model"]
      expect(model.capabilities.toolcall).toBe(true)
      expect(model.capabilities.temperature).toBe(true)
    })
  })

  test("context limit detection", async () => {
    const cases = [
      { id: "claude-haiku-4-5", providerId: "anthropic", context: 200000, output: 16384 },
      { id: "gpt-4o-mini", providerId: "openai", context: 128000, output: 16384 },
      { id: "gemini-2.5-flash", providerId: "vertex", context: 1000000, output: 8192 },
      { id: "mystery-model", providerId: "unknown", context: 128000, output: 4096 },
    ]
    for (const c of cases) {
      await withAperture([apertureModel({ id: c.id, providerId: c.providerId })], (providers) => {
        const model = providers[ProviderID.aperture].models[c.id]
        expect(model.limit.context).toBe(c.context)
        expect(model.limit.output).toBe(c.output)
      })
    }
  })

  test("URL normalization", async () => {
    const cases = [
      { baseUrl: "http://ai", expected: "http://ai/v1" },
      { baseUrl: "http://ai/", expected: "http://ai/v1" },
      { baseUrl: "http://ai/v1", expected: "http://ai/v1" },
      { baseUrl: "http://ai/v1/", expected: "http://ai/v1" },
    ]
    for (const c of cases) {
      await withAperture([apertureModel({ id: "m1", providerId: "anthropic" })], (providers) => {
        const model = providers[ProviderID.aperture].models["m1"]
        expect(model.api.url).toBe(c.expected)
      }, c.baseUrl)
    }
  })

  test("happy path: returns discovered models with names", async () => {
    await withAperture(
      [
        apertureModel({ id: "claude-sonnet-4", name: "Claude Sonnet 4", providerId: "anthropic" }),
        apertureModel({ id: "gpt-4o", name: "GPT-4o", providerId: "openai" }),
      ],
      (providers) => {
        expect(providers[ProviderID.aperture]).toBeDefined()
        expect(providers[ProviderID.aperture].models["claude-sonnet-4"]).toBeDefined()
        expect(providers[ProviderID.aperture].models["claude-sonnet-4"].name).toBe("Claude Sonnet 4")
        expect(providers[ProviderID.aperture].models["gpt-4o"]).toBeDefined()
        expect(providers[ProviderID.aperture].models["gpt-4o"].name).toBe("GPT-4o")
      },
    )
  })

  test("empty response removes provider", async () => {
    await withAperture([], (providers) => {
      expect(providers[ProviderID.aperture]).toBeUndefined()
    })
  })

  test("HTTP 500 error removes provider", async () => {
    await withApertureCustomFetch(
      (url) => {
        if (url.includes("/v1/models")) return new Response("Internal Server Error", { status: 500 })
        return new Response("not found", { status: 404 })
      },
      (providers) => {
        expect(providers[ProviderID.aperture]).toBeUndefined()
      },
    )
  })

  test("network error removes provider", async () => {
    await withApertureCustomFetch(
      () => { throw new TypeError("fetch failed") },
      (providers) => {
        expect(providers[ProviderID.aperture]).toBeUndefined()
      },
    )
  })

  test("model with missing metadata falls back to defaults", async () => {
    await withApertureCustomFetch(
      (url) => {
        if (url.includes("/v1/models")) return Response.json({ data: [{ id: "no-metadata-model" }] })
        return new Response("not found", { status: 404 })
      },
      (providers) => {
        const model = providers[ProviderID.aperture].models["no-metadata-model"]
        expect(model).toBeDefined()
        expect(model.name).toBe("no-metadata-model")
        expect(model.api.npm).toBe("@ai-sdk/openai-compatible")
        expect(model.limit.context).toBe(128000)
        expect(model.limit.output).toBe(4096)
        expect(model.cost.input).toBe(0)
        expect(model.cost.output).toBe(0)
      },
    )
  })

  test("model ID formats", async () => {
    const idCases = [
      { id: "claude-haiku-4-5", providerId: "anthropic" },
      { id: "claude-haiku-4-5@20251001", providerId: "anthropic" },
      { id: "us.anthropic.claude-haiku-4-5-20251001-v1:0", providerId: "bedrock" },
      { id: "meta-llama/llama-3.2-3b-instruct", providerId: "openrouter" },
      { id: "anthropic.claude-opus-4-7", providerId: "mantle" },
    ]
    for (const c of idCases) {
      await withAperture([apertureModel({ id: c.id, providerId: c.providerId })], (providers) => {
        expect(providers[ProviderID.aperture].models[c.id]).toBeDefined()
      })
    }
    // bedrock ARN-style IDs: contains "anthropic" so isClaude
    await withAperture([apertureModel({ id: "us.anthropic.claude-haiku-4-5-20251001-v1:0", providerId: "bedrock" })], (providers) => {
      const model = providers[ProviderID.aperture].models["us.anthropic.claude-haiku-4-5-20251001-v1:0"]
      expect(model.capabilities.attachment).toBe(true)
      expect(model.api.npm).toBe("@ai-sdk/anthropic")
    })
    // mantle prefixed IDs: "anthropic" in model ID so isClaude
    await withAperture([apertureModel({ id: "anthropic.claude-opus-4-7", providerId: "mantle" })], (providers) => {
      const model = providers[ProviderID.aperture].models["anthropic.claude-opus-4-7"]
      expect(model.capabilities.attachment).toBe(true)
      expect(model.api.npm).toBe("@ai-sdk/anthropic")
    })
  })

  test("aperture provider not loaded without APERTURE_BASE_URL", async () => {
    await withAperture([], (providers) => {
      expect(providers[ProviderID.aperture]).toBeUndefined()
    }, false)
  })

  test("aperture provider loaded with APERTURE_BASE_URL set", async () => {
    await withAperture([apertureModel({ id: "test-model", providerId: "anthropic" })], (providers) => {
      expect(providers[ProviderID.aperture]).toBeDefined()
      expect(providers[ProviderID.aperture].name).toBe("Aperture")
      expect(providers[ProviderID.aperture].source).toBe("env")
    })
  })

  test("model name defaults to model ID when name not provided", async () => {
    await withApertureCustomFetch(
      (url) => {
        if (url.includes("/v1/models")) return Response.json({ data: [{ id: "nameless-model", metadata: { provider: { id: "openai" } } }] })
        return new Response("not found", { status: 404 })
      },
      (providers) => {
        const model = providers[ProviderID.aperture].models["nameless-model"]
        expect(model.name).toBe("nameless-model")
      },
    )
  })

  test("model providerID is set to aperture", async () => {
    await withAperture([apertureModel({ id: "test-model", providerId: "openai" })], (providers) => {
      const model = providers[ProviderID.aperture].models["test-model"]
      expect(String(model.providerID)).toBe("aperture")
    })
  })
})

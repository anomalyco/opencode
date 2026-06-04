import { describe, expect, test } from "bun:test"
import { LiteLLMPlugin } from "../../src/plugin/litellm/litellm"
import { LiteLLMModels } from "../../src/plugin/litellm/models"

function makeServer(handler: (request: Request, url: URL) => Response | Promise<Response>) {
  return Bun.serve({
    port: 0,
    fetch: (request) => handler(request, new URL(request.url)),
  })
}

describe("plugin.litellm", () => {
  describe("LiteLLMModels.get", () => {
    test("fetches models from /v1/models and returns model records", async () => {
      using server = makeServer((_, url) => {
        if (url.pathname === "/v1/models") {
          return Response.json({
            data: [
              { id: "gpt-4o", created: 1700000000, owned_by: "openai" },
              { id: "claude-3-opus", created: 1700000000, owned_by: "anthropic" },
            ],
          })
        }
        if (url.pathname === "/model/info") {
          return Response.json({ data: [] })
        }
        return new Response("not found", { status: 404 })
      })

      const models = await LiteLLMModels.get(server.url.toString(), {})
      expect(Object.keys(models)).toEqual(["gpt-4o", "claude-3-opus"])
      expect(models["gpt-4o"].providerID).toBe("litellm")
      expect(models["gpt-4o"].api.npm).toBe("@ai-sdk/openai-compatible")
      expect(models["claude-3-opus"].providerID).toBe("litellm")
    })

    test("enriches models with /model/info metadata", async () => {
      using server = makeServer((_, url) => {
        if (url.pathname === "/v1/models") {
          return Response.json({
            data: [{ id: "gpt-4o" }],
          })
        }
        if (url.pathname === "/model/info") {
          return Response.json({
            data: [
              {
                model_name: "gpt-4o",
                model_info: {
                  max_tokens: 128000,
                  max_output_tokens: 16384,
                  input_cost_per_token: 0.000005,
                  output_cost_per_token: 0.000015,
                  supports_vision: true,
                  supports_function_calling: true,
                },
              },
            ],
          })
        }
        return new Response("not found", { status: 404 })
      })

      const models = await LiteLLMModels.get(server.url.toString(), {})
      const model = models["gpt-4o"]
      expect(model.limit.context).toBe(128000)
      expect(model.limit.output).toBe(16384)
      expect(model.cost.input).toBe(5)
      expect(model.cost.output).toBe(15)
      expect(model.capabilities.input.image).toBe(true)
      expect(model.capabilities.toolcall).toBe(true)
    })

    test("uses defaults when /model/info has no entry for a model", async () => {
      using server = makeServer((_, url) => {
        if (url.pathname === "/v1/models") {
          return Response.json({ data: [{ id: "unknown-model" }] })
        }
        if (url.pathname === "/model/info") {
          return Response.json({ data: [] })
        }
        return new Response("not found", { status: 404 })
      })

      const models = await LiteLLMModels.get(server.url.toString(), {})
      expect(models["unknown-model"].limit.context).toBe(128_000)
      expect(models["unknown-model"].limit.output).toBe(16_384)
      expect(models["unknown-model"].cost.input).toBe(0)
      expect(models["unknown-model"].cost.output).toBe(0)
    })

    test("preserves existing model data when merging", async () => {
      using server = makeServer((_, url) => {
        if (url.pathname === "/v1/models") {
          return Response.json({ data: [{ id: "gpt-4o" }] })
        }
        if (url.pathname === "/model/info") {
          return Response.json({ data: [] })
        }
        return new Response("not found", { status: 404 })
      })

      const existing = {
        "gpt-4o": {
          id: "gpt-4o",
          providerID: "litellm",
          name: "GPT-4o Custom Name",
          capabilities: { reasoning: true },
          release_date: "2024-05-13",
        } as any,
      }

      const models = await LiteLLMModels.get(server.url.toString(), {}, existing)
      expect(models["gpt-4o"].name).toBe("GPT-4o Custom Name")
      expect(models["gpt-4o"].capabilities.reasoning).toBe(true)
      expect(models["gpt-4o"].release_date).toBe("2024-05-13")
    })

    test("skips entries with empty id", async () => {
      using server = makeServer((_, url) => {
        if (url.pathname === "/v1/models") {
          return Response.json({
            data: [{ id: "" }, { id: "valid-model" }, { id: undefined }],
          })
        }
        if (url.pathname === "/model/info") {
          return Response.json({ data: [] })
        }
        return new Response("not found", { status: 404 })
      })

      const models = await LiteLLMModels.get(server.url.toString(), {})
      expect(Object.keys(models)).toEqual(["valid-model"])
    })

    test("throws on non-ok /v1/models response", async () => {
      using server = makeServer(() => new Response("unauthorized", { status: 401 }))
      await expect(LiteLLMModels.get(server.url.toString(), {})).rejects.toThrow(/401/)
    })

    test("returns existing models when /v1/models returns no data array", async () => {
      using server = makeServer((_, url) => {
        if (url.pathname === "/v1/models") {
          return Response.json({ object: "list" })
        }
        return new Response("not found", { status: 404 })
      })

      const existing = { "old-model": { id: "old-model" } as any }
      const models = await LiteLLMModels.get(server.url.toString(), {}, existing)
      expect(models).toEqual(existing)
    })

    test("gracefully handles /model/info failure", async () => {
      using server = makeServer((_, url) => {
        if (url.pathname === "/v1/models") {
          return Response.json({ data: [{ id: "gpt-4o" }] })
        }
        if (url.pathname === "/model/info") {
          return new Response("server error", { status: 500 })
        }
        return new Response("not found", { status: 404 })
      })

      const models = await LiteLLMModels.get(server.url.toString(), {})
      expect(models["gpt-4o"]).toBeDefined()
      expect(models["gpt-4o"].cost.input).toBe(0)
    })

    test("forwards authorization headers", async () => {
      const capturedHeaders: Headers[] = []
      using server = makeServer((request, url) => {
        capturedHeaders.push(request.headers)
        if (url.pathname === "/v1/models") {
          return Response.json({ data: [{ id: "m1" }] })
        }
        if (url.pathname === "/model/info") {
          return Response.json({ data: [] })
        }
        return new Response("not found", { status: 404 })
      })

      await LiteLLMModels.get(server.url.toString(), { Authorization: "Bearer sk-test" })
      expect(capturedHeaders[0].get("authorization")).toBe("Bearer sk-test")
      expect(capturedHeaders[0].get("user-agent")).toMatch(/^opencode\//)
    })
  })

  describe("LiteLLMPlugin", () => {
    test("returns provider and auth hooks", async () => {
      const hooks = await LiteLLMPlugin({} as any)
      expect(hooks.provider).toBeDefined()
      expect(hooks.provider!.id).toBe("litellm")
      expect(typeof hooks.provider!.models).toBe("function")
      expect(hooks.auth).toBeDefined()
      expect(hooks.auth!.provider).toBe("litellm")
      expect(typeof hooks.auth!.loader).toBe("function")
      expect(hooks.auth!.methods).toHaveLength(1)
      expect(hooks.auth!.methods[0].type).toBe("api")
    })

    test("auth loader returns env key when auth type is not api", async () => {
      const original = process.env["LITELLM_API_KEY"]
      process.env["LITELLM_API_KEY"] = "env-key-123"
      try {
        const hooks = await LiteLLMPlugin({} as any)
        const result = await hooks.auth!.loader!(async () => ({ type: "oauth" }) as any, {} as any)
        expect(result).toEqual({ apiKey: "env-key-123" })
      } finally {
        if (original === undefined) delete process.env["LITELLM_API_KEY"]
        else process.env["LITELLM_API_KEY"] = original
      }
    })

    test("auth loader returns api key from stored auth", async () => {
      const hooks = await LiteLLMPlugin({} as any)
      const result = await hooks.auth!.loader!(
        async () => ({ type: "api", key: "stored-key" }),
        {} as any,
      )
      expect(result).toEqual({ apiKey: "stored-key" })
    })

    test("auth loader returns empty when no key available", async () => {
      const original = process.env["LITELLM_API_KEY"]
      delete process.env["LITELLM_API_KEY"]
      try {
        const hooks = await LiteLLMPlugin({} as any)
        const result = await hooks.auth!.loader!(async () => ({ type: "oauth" }) as any, {} as any)
        expect(result).toEqual({})
      } finally {
        if (original !== undefined) process.env["LITELLM_API_KEY"] = original
      }
    })

    test("provider.models returns existing models when no baseURL configured", async () => {
      const original = process.env["LITELLM_BASE_URL"]
      delete process.env["LITELLM_BASE_URL"]
      try {
        const hooks = await LiteLLMPlugin({} as any)
        const existing = { "m1": { id: "m1" } as any }
        const result = await hooks.provider!.models!({ models: existing, options: {} } as any, {} as any)
        expect(result).toBe(existing)
      } finally {
        if (original !== undefined) process.env["LITELLM_BASE_URL"] = original
      }
    })

    test("provider.models fetches from proxy when baseURL is set", async () => {
      using server = makeServer((_, url) => {
        if (url.pathname === "/v1/models") {
          return Response.json({ data: [{ id: "proxy-model" }] })
        }
        if (url.pathname === "/model/info") {
          return Response.json({ data: [] })
        }
        return new Response("not found", { status: 404 })
      })

      const hooks = await LiteLLMPlugin({} as any)
      const result = await hooks.provider!.models!(
        { models: {}, options: { baseURL: server.url.toString() } } as any,
        {} as any,
      )
      expect(result["proxy-model"]).toBeDefined()
      expect(result["proxy-model"].providerID).toBe("litellm")
    })

    test("provider.models falls back to existing on fetch error", async () => {
      using server = makeServer(() => new Response("down", { status: 503 }))

      const hooks = await LiteLLMPlugin({} as any)
      const existing = { "fallback": { id: "fallback" } as any }
      const result = await hooks.provider!.models!(
        { models: existing, options: { baseURL: server.url.toString() } } as any,
        {} as any,
      )
      expect(result).toBe(existing)
    })

    test("provider.models uses auth context for authorization header", async () => {
      const capturedHeaders: Headers[] = []
      using server = makeServer((request, url) => {
        capturedHeaders.push(request.headers)
        if (url.pathname === "/v1/models") {
          return Response.json({ data: [{ id: "m1" }] })
        }
        if (url.pathname === "/model/info") {
          return Response.json({ data: [] })
        }
        return new Response("not found", { status: 404 })
      })

      const hooks = await LiteLLMPlugin({} as any)
      await hooks.provider!.models!(
        { models: {}, options: { baseURL: server.url.toString() } } as any,
        { auth: { type: "api", key: "ctx-key" } } as any,
      )
      expect(capturedHeaders[0].get("authorization")).toBe("Bearer ctx-key")
    })
  })
})

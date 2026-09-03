import { describe, expect, test } from "bun:test"
import type { Auth, Provider } from "@opencode-ai/sdk/v2"
import { createRhoaiMaasHooks, normalizeBaseURL, PROVIDER_ID } from "../../src/plugin/rhoai-maas"

const provider: Provider = {
  id: PROVIDER_ID,
  name: "Red Hat OpenShift AI",
  source: "custom",
  env: [],
  options: {},
  models: {},
}

const apiAuth = (metadata?: Record<string, string>): Auth => ({ type: "api", key: "test-key", metadata })

function modelsHook(hooks: ReturnType<typeof createRhoaiMaasHooks>) {
  const fn = hooks.provider?.models
  if (!fn) throw new Error("MaaS provider model hook is missing")
  return fn
}

function loader(hooks: ReturnType<typeof createRhoaiMaasHooks>) {
  const fn = hooks.auth?.loader
  if (!fn) throw new Error("MaaS auth loader is missing")
  return fn
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

describe("plugin.rhoai-maas", () => {
  test("normalizeBaseURL adds scheme, trims trailing slash, and ensures /v1", () => {
    expect(normalizeBaseURL("https://maas.example.com/v1")).toBe("https://maas.example.com/v1")
    expect(normalizeBaseURL("https://maas.example.com/v1/")).toBe("https://maas.example.com/v1")
    expect(normalizeBaseURL("maas.example.com")).toBe("https://maas.example.com/v1")
    expect(normalizeBaseURL("  https://maas.example.com  ")).toBe("https://maas.example.com/v1")
    expect(normalizeBaseURL("")).toBeUndefined()
    expect(normalizeBaseURL(undefined)).toBeUndefined()
  })

  test("exposes a single API-key method with a gateway URL prompt", () => {
    const hooks = createRhoaiMaasHooks()
    expect(hooks.auth?.provider).toBe(PROVIDER_ID)
    expect(hooks.provider?.id).toBe(PROVIDER_ID)
    expect(hooks.auth?.methods.map((m) => [m.type, m.label])).toEqual([["api", "API key"]])
    const method = hooks.auth?.methods[0]
    expect(method?.prompts?.map((p) => p.key)).toEqual(["baseURL"])
    const validate = method?.prompts?.[0].type === "text" ? method.prompts[0].validate : undefined
    expect(validate?.("")).toBe("A gateway URL is required")
    expect(validate?.("https://maas.example.com")).toBeUndefined()
  })

  test("discovers models live from <baseURL>/models", async () => {
    const requests: string[] = []
    const hooks = createRhoaiMaasHooks(async (input, init) => {
      requests.push(String(input))
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key")
      return jsonResponse({
        object: "list",
        data: [
          { id: "publishers/red-hat/models/qwen2-5-instruct", name: "Qwen 2.5 Instruct" },
          { id: "publishers/red-hat/models/granite-3-8b" },
        ],
      })
    })

    const result = await modelsHook(hooks)(provider, {
      auth: apiAuth({ baseURL: "https://maas.example.com/v1/" }),
    })

    expect(requests).toEqual(["https://maas.example.com/v1/models"])
    expect(Object.keys(result)).toEqual([
      "publishers/red-hat/models/qwen2-5-instruct",
      "publishers/red-hat/models/granite-3-8b",
    ])
    const model = result["publishers/red-hat/models/qwen2-5-instruct"]
    expect(model.name).toBe("Qwen 2.5 Instruct")
    expect(model.api).toEqual({
      id: "publishers/red-hat/models/qwen2-5-instruct",
      url: "https://maas.example.com/v1",
      npm: "@ai-sdk/openai-compatible",
    })
    expect(model.capabilities.toolcall).toBe(true)
    // Falls back to the model id when the gateway omits a display name.
    expect(result["publishers/red-hat/models/granite-3-8b"].name).toBe("publishers/red-hat/models/granite-3-8b")
  })

  test("keeps catalog models when discovery fails or is unauthenticated", async () => {
    const failing = createRhoaiMaasHooks(async () => jsonResponse({ error: "nope" }, 500))
    const catalog = { ...provider, models: { foo: {} as never } }
    expect(await modelsHook(failing)(catalog, { auth: apiAuth({ baseURL: "https://maas.example.com/v1" }) })).toBe(
      catalog.models,
    )
    // No auth at all -> untouched catalog.
    expect(await modelsHook(failing)(catalog, {})).toBe(catalog.models)
    // Missing baseURL -> untouched catalog.
    expect(await modelsHook(failing)(catalog, { auth: apiAuth() })).toBe(catalog.models)
  })

  test("loader supplies the per-cluster baseURL and key to the SDK", async () => {
    const hooks = createRhoaiMaasHooks()
    expect(await loader(hooks)(async () => apiAuth({ baseURL: "https://maas.example.com" }), provider)).toEqual({
      baseURL: "https://maas.example.com/v1",
      apiKey: "test-key",
    })
    // Without a stored baseURL the loader defers to catalog options.
    expect(await loader(hooks)(async () => apiAuth(), provider)).toEqual({})
  })
})

import { test, expect, describe, afterEach, beforeEach } from "bun:test"
import { ProviderID } from "../../src/provider/schema"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"

describe("Eden AI Provider", () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    // @ts-expect-error
    global.fetch = async (url, options) => {
      if (url === "https://api.edenai.run/v3/llm/models") {
        return new Response(JSON.stringify({
          data: [
            {
              id: "fake-provider/awesome-model",
              model_name: "Awesome Model",
              capabilities: { supports_function_calling: true },
              pricing: { input_cost_per_token: 0.00003, output_cost_per_token: 0.00006 }
            }
          ]
        }))
      }
      return originalFetch(url, options)
    }
  })

  afterEach(() => {
    global.fetch = originalFetch
    delete process.env.EDENAI_API_KEY
  })

  test("loads automatically when EDENAI_API_KEY is present", async () => {
    process.env.EDENAI_API_KEY = "test_key"
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const providers = await Provider.list()
        const edenai = providers[ProviderID.make("edenai")]
        expect(edenai).toBeDefined()
        expect(edenai.source).toBe("env")
        expect(edenai.key).toBe("test_key")
        expect(edenai.options.baseURL).toBe("https://api.edenai.run/v3/llm")
        expect(Object.keys(edenai.models).length).toBe(1)
        expect(edenai.models["fake-provider/awesome-model"].name).toBe("Awesome Model")
      },
    })
  })

  test("does not load automatically without EDENAI_API_KEY", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const providers = await Provider.list()
        const edenai = providers[ProviderID.make("edenai")]
        expect(edenai).toBeUndefined()
      },
    })
  })
})

import { test, expect, mock, beforeEach, afterEach } from "bun:test"
import path from "path"

// === Mocks ===
// Mock BunProc to prevent real package installations during tests
mock.module("../../src/bun/index", () => ({
  BunProc: {
    install: async (pkg: string) => pkg,
    run: async () => {
      throw new Error("BunProc.run should not be called in tests")
    },
    which: () => process.execPath,
    InstallFailedError: class extends Error {},
  },
}))

// Mock plugins
const mockPlugin = () => ({})
mock.module("opencode-copilot-auth", () => ({ default: mockPlugin }))
mock.module("opencode-anthropic-auth", () => ({ default: mockPlugin }))

// Import after mocks are set up
const { tmpdir } = await import("../fixture/fixture")
const { Instance } = await import("../../src/project/instance")
const { Provider } = await import("../../src/provider/provider")
const { Env } = await import("../../src/env")

// Mock fetch for Unbound API
const originalFetch = globalThis.fetch
const mockModelsResponse = {
  data: [
    {
      id: "openai/gpt-4o",
      name: "GPT-4o",
      parameters: {
        context_window: 128000,
        max_tokens: 16384,
        supports_images: true,
        supports_prompt_caching: true,
      },
      pricing: {
        input_token_price: "2.50",
        output_token_price: "10.00",
        cache_read_price: "1.25",
        cache_write_price: "2.50",
      },
    },
    {
      id: "anthropic/claude-3-5-sonnet",
      name: "Claude 3.5 Sonnet",
      parameters: {
        context_window: 200000,
        max_tokens: 8192,
        supports_images: true,
        supports_prompt_caching: true,
      },
      pricing: {
        input_token_price: "3.00",
        output_token_price: "15.00",
        cache_read_price: "0.30",
        cache_write_price: "3.75",
      },
    },
  ],
}

beforeEach(() => {
  // Reset fetch mock before each test
  globalThis.fetch = originalFetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

function mockUnboundFetch(response: any = mockModelsResponse, ok: boolean = true) {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString()
    if (url.includes("/models")) {
      return {
        ok,
        status: ok ? 200 : 401,
        statusText: ok ? "OK" : "Unauthorized",
        json: async () => response,
      } as Response
    }
    return originalFetch(input, init)
  }
}

test("Unbound: provider loaded from UNBOUND_API_KEY env variable", async () => {
  mockUnboundFetch()

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("UNBOUND_API_KEY", "test-unbound-api-key")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["unbound"]).toBeDefined()
      expect(providers["unbound"].source).toBe("custom")
    },
  })
})

test("Unbound: provider loaded from config apiKey option", async () => {
  mockUnboundFetch()

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            unbound: {
              options: {
                apiKey: "config-unbound-api-key",
              },
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["unbound"]).toBeDefined()
    },
  })
})

test("Unbound: custom baseURL from config", async () => {
  mockUnboundFetch()

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            unbound: {
              options: {
                apiKey: "test-api-key",
                baseURL: "https://custom.unbound.example.com/v1",
              },
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["unbound"]).toBeDefined()
      // Models should have the custom baseURL
      const model = Object.values(providers["unbound"].models)[0]
      expect(model?.api.url).toBe("https://custom.unbound.example.com/v1")
    },
  })
})

test("Unbound: models fetched from /models endpoint", async () => {
  mockUnboundFetch()

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("UNBOUND_API_KEY", "test-api-key")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["unbound"]).toBeDefined()

      // Check that models from mock response are present
      const models = providers["unbound"].models
      expect(models["openai/gpt-4o"]).toBeDefined()
      expect(models["anthropic/claude-3-5-sonnet"]).toBeDefined()

      // Check model properties
      const gpt4o = models["openai/gpt-4o"]
      expect(gpt4o.name).toBe("GPT-4o")
      expect(gpt4o.limit.context).toBe(128000)
      expect(gpt4o.limit.output).toBe(16384)
      expect(gpt4o.capabilities.attachment).toBe(true)
      expect(gpt4o.options.supportsPromptCaching).toBe(true)
    },
  })
})

test("Unbound: model pricing parsed correctly", async () => {
  mockUnboundFetch()

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("UNBOUND_API_KEY", "test-api-key")
    },
    fn: async () => {
      const providers = await Provider.list()
      const gpt4o = providers["unbound"].models["openai/gpt-4o"]

      expect(gpt4o.cost.input).toBe(2.5)
      expect(gpt4o.cost.output).toBe(10)
      expect(gpt4o.cost.cache.read).toBe(1.25)
      expect(gpt4o.cost.cache.write).toBe(2.5)
    },
  })
})

test("Unbound: X-Unbound-Metadata header set correctly", async () => {
  mockUnboundFetch()

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("UNBOUND_API_KEY", "test-api-key")
    },
    fn: async () => {
      const providers = await Provider.list()
      const unboundProvider = providers["unbound"]

      expect(unboundProvider.options?.headers?.["X-Unbound-Metadata"]).toBeDefined()
      const metadata = JSON.parse(unboundProvider.options?.headers?.["X-Unbound-Metadata"] as string)
      expect(metadata.labels).toContainEqual({ key: "app", value: "opencode" })
    },
  })
})

test("Unbound: not loaded without API key", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      // Explicitly clear any env variables
      Env.set("UNBOUND_API_KEY", "")
    },
    fn: async () => {
      const providers = await Provider.list()
      // Without API key, unbound should not be in the active providers list
      // (it won't have autoload: true from the custom loader)
      expect(providers["unbound"]).toBeUndefined()
    },
  })
})

test("Unbound: falls back to default model on API failure", async () => {
  // Mock a failed API response
  mockUnboundFetch({}, false)

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("UNBOUND_API_KEY", "test-api-key")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["unbound"]).toBeDefined()
      // Should still have the default model when API fails
      expect(providers["unbound"].models["default"]).toBeDefined()
    },
  })
})

test("Unbound: env variable takes precedence over config apiKey", async () => {
  let capturedAuthHeader: string | null = null

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString()
    if (url.includes("/models")) {
      capturedAuthHeader = (init?.headers as Record<string, string>)?.["Authorization"] ?? null
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => mockModelsResponse,
      } as Response
    }
    return originalFetch(input, init)
  }

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            unbound: {
              options: {
                apiKey: "config-api-key",
              },
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("UNBOUND_API_KEY", "env-api-key")
    },
    fn: async () => {
      await Provider.list()
      // Env variable should take precedence
      expect(capturedAuthHeader).toBe("Bearer env-api-key")
    },
  })
})

test("Unbound: disabled_providers excludes unbound", async () => {
  mockUnboundFetch()

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          disabled_providers: ["unbound"],
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("UNBOUND_API_KEY", "test-api-key")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["unbound"]).toBeUndefined()
    },
  })
})

import { test, expect, mock, beforeEach, afterEach } from "bun:test"
import path from "path"

import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"

let originalFetch: typeof globalThis.fetch

beforeEach(() => {
  originalFetch = globalThis.fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

interface MockModelInfo {
  model_name: string
  model_info: {
    max_tokens?: number | null
    max_input_tokens?: number | null
    max_output_tokens?: number | null
    input_cost_per_token?: number | null
    output_cost_per_token?: number | null
    cache_read_input_token_cost?: number | null
    cache_creation_input_token_cost?: number | null
    input_cost_per_token_above_200k_tokens?: number | null
    output_cost_per_token_above_200k_tokens?: number | null
    supports_vision?: boolean | null
    supports_function_calling?: boolean | null
    supports_reasoning?: boolean | null
    supports_audio_input?: boolean | null
    supports_audio_output?: boolean | null
    supports_pdf_input?: boolean | null
    supported_openai_params?: string[] | null
    mode?: string | null
  }
}

// Mock that only responds to /models (no /model/info), simulating older LiteLLM
function mockFetch(modelIds: string[]) {
  const mockFn = mock((input: any, init?: any) => {
    const url = typeof input === "string" ? input : input.toString()
    if (url.endsWith("/model/info")) {
      return Promise.resolve(new Response("Not Found", { status: 404 }))
    }
    if (url.endsWith("/models")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            object: "list",
            data: modelIds.map((id) => ({ id, object: "model" })),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
    }
    return originalFetch(input, init)
  })
  globalThis.fetch = mockFn as any
  return mockFn
}

// Mock that responds to /model/info with rich metadata
function mockFetchWithModelInfo(modelInfos: MockModelInfo[]) {
  const mockFn = mock((input: any, init?: any) => {
    const url = typeof input === "string" ? input : input.toString()
    if (url.endsWith("/model/info")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ data: modelInfos }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
    }
    // /models should not be called when /model/info succeeds
    if (url.endsWith("/models")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ object: "list", data: [] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
    }
    return originalFetch(input, init)
  })
  globalThis.fetch = mockFn as any
  return mockFn
}

function mockFetchFailure() {
  const mockFn = mock((input: any, init?: any) => {
    const url = typeof input === "string" ? input : input.toString()
    if (url.endsWith("/model/info") || url.endsWith("/models")) {
      return Promise.reject(new Error("Connection refused"))
    }
    return originalFetch(input, init)
  })
  globalThis.fetch = mockFn as any
  return mockFn
}

function mockFetchNotOk() {
  const mockFn = mock((input: any, init?: any) => {
    const url = typeof input === "string" ? input : input.toString()
    if (url.endsWith("/model/info") || url.endsWith("/models")) {
      return Promise.resolve(new Response("Internal Server Error", { status: 500 }))
    }
    return originalFetch(input, init)
  })
  globalThis.fetch = mockFn as any
  return mockFn
}

test("auto-loads models when both litellmProxy and autoload are true", async () => {
  const fetchMock = mockFetch(["anthropic/claude-sonnet-4", "openai/gpt-5", "meta/llama-4"])

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "my-proxy": {
              name: "My LiteLLM Proxy",
              npm: "@ai-sdk/openai-compatible",
              options: {
                litellmProxy: true,
                autoload: true,
                baseURL: "https://litellm.example.com/v1",
                apiKey: "sk-test-key",
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
      expect(providers["my-proxy"]).toBeDefined()
      expect(providers["my-proxy"].models["anthropic/claude-sonnet-4"]).toBeDefined()
      expect(providers["my-proxy"].models["openai/gpt-5"]).toBeDefined()
      expect(providers["my-proxy"].models["meta/llama-4"]).toBeDefined()
    },
  })
})

test("litellmProxy without autoload does not auto-load models", async () => {
  const fetchMock = mockFetch(["should-not-appear"])

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "my-proxy": {
              name: "My LiteLLM Proxy",
              npm: "@ai-sdk/openai-compatible",
              models: {
                "gpt-4": { name: "GPT-4", tool_call: true, limit: { context: 8000, output: 2000 } },
                "anthropic/claude-opus-4-6": { name: "anthropic/claude-opus-4-6", tool_call: true, limit: { context: 200000, output: 16000 } },
              },
              options: {
                litellmProxy: true,
                baseURL: "https://litellm.example.com/v1",
                apiKey: "sk-test-key",
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
      expect(providers["my-proxy"]).toBeDefined()
      // Only manually configured models should exist
      expect(providers["my-proxy"].models["gpt-4"]).toBeDefined()
      expect(providers["my-proxy"].models["anthropic/claude-opus-4-6"]).toBeDefined()
      expect(Object.keys(providers["my-proxy"].models)).toEqual(["gpt-4", "anthropic/claude-opus-4-6"])
      // Fetch should not have been called for /models or /model/info
      const litellmCalls = fetchMock.mock.calls.filter((call: any[]) => {
        const url = typeof call[0] === "string" ? call[0] : call[0].toString()
        return url.endsWith("/models") || url.endsWith("/model/info")
      })
      expect(litellmCalls.length).toBe(0)
    },
  })
})

test("auto-loads models when provider ID contains litellm and autoload is true", async () => {
  mockFetch(["model-a", "model-b"])

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "my-litellm-gateway": {
              name: "LiteLLM Gateway",
              npm: "@ai-sdk/openai-compatible",
              options: {
                autoload: true,
                baseURL: "https://gateway.example.com/v1",
                apiKey: "sk-key",
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
      expect(providers["my-litellm-gateway"]).toBeDefined()
      expect(providers["my-litellm-gateway"].models["model-a"]).toBeDefined()
      expect(providers["my-litellm-gateway"].models["model-b"]).toBeDefined()
    },
  })
})

test("provider ID contains litellm but autoload is not set does not auto-load", async () => {
  const fetchMock = mockFetch(["should-not-appear"])

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "my-litellm-gateway": {
              name: "LiteLLM Gateway",
              npm: "@ai-sdk/openai-compatible",
              models: {
                "manual-model": { name: "Manual", tool_call: true, limit: { context: 8000, output: 2000 } },
              },
              options: {
                baseURL: "https://gateway.example.com/v1",
                apiKey: "sk-key",
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
      expect(providers["my-litellm-gateway"]).toBeDefined()
      expect(Object.keys(providers["my-litellm-gateway"].models)).toEqual(["manual-model"])
      const litellmCalls = fetchMock.mock.calls.filter((call: any[]) => {
        const url = typeof call[0] === "string" ? call[0] : call[0].toString()
        return url.endsWith("/models") || url.endsWith("/model/info")
      })
      expect(litellmCalls.length).toBe(0)
    },
  })
})

test("does not override manually configured models", async () => {
  mockFetch(["custom-model", "auto-model"])

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "my-proxy": {
              name: "LiteLLM Proxy",
              npm: "@ai-sdk/openai-compatible",
              models: {
                "custom-model": {
                  name: "My Custom Model",
                  tool_call: true,
                  reasoning: true,
                  limit: { context: 200000, output: 16000 },
                  cost: { input: 3, output: 15 },
                },
              },
              options: {
                litellmProxy: true,
                autoload: true,
                baseURL: "https://proxy.example.com/v1",
                apiKey: "sk-key",
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
      const provider = providers["my-proxy"]
      expect(provider).toBeDefined()

      // Manually configured model should retain its custom properties
      const customModel = provider.models["custom-model"]
      expect(customModel.name).toBe("My Custom Model")
      expect(customModel.capabilities.reasoning).toBe(true)
      expect(customModel.limit.context).toBe(200000)
      expect(customModel.limit.output).toBe(16000)
      expect(customModel.cost.input).toBe(3)

      // Auto-loaded model should exist with defaults
      const autoModel = provider.models["auto-model"]
      expect(autoModel).toBeDefined()
      expect(autoModel.name).toBe("auto-model")
    },
  })
})

test("auto-loaded models have correct default properties", async () => {
  mockFetch(["test-model"])

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "litellm-test": {
              name: "LiteLLM Test",
              npm: "@ai-sdk/openai-compatible",
              api: "https://proxy.example.com/v1",
              options: {
                litellmProxy: true,
                autoload: true,
                baseURL: "https://proxy.example.com/v1",
                apiKey: "sk-key",
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
      const model = providers["litellm-test"].models["test-model"]
      expect(model).toBeDefined()

      // Check defaults
      expect(model.id).toBe("test-model")
      expect(model.providerID).toBe("litellm-test")
      expect(model.status).toBe("active")
      expect(model.capabilities.toolcall).toBe(true)
      expect(model.capabilities.temperature).toBe(true)
      expect(model.capabilities.reasoning).toBe(false)
      expect(model.capabilities.input.text).toBe(true)
      expect(model.capabilities.input.image).toBe(false)
      expect(model.capabilities.output.text).toBe(true)
      expect(model.cost.input).toBe(0)
      expect(model.cost.output).toBe(0)
      expect(model.cost.cache.read).toBe(0)
      expect(model.cost.cache.write).toBe(0)
      expect(model.limit.context).toBe(128000)
      expect(model.limit.output).toBe(8192)
      expect(model.api.npm).toBe("@ai-sdk/openai-compatible")
      expect(model.api.url).toBe("https://proxy.example.com/v1")
    },
  })
})

test("gracefully handles fetch failure without crashing", async () => {
  mockFetchFailure()

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "my-proxy": {
              name: "Unreachable LiteLLM",
              npm: "@ai-sdk/openai-compatible",
              models: {
                "fallback-model": {
                  name: "Fallback Model",
                  tool_call: true,
                  limit: { context: 8000, output: 2000 },
                },
              },
              options: {
                litellmProxy: true,
                autoload: true,
                baseURL: "https://unreachable.example.com/v1",
                apiKey: "sk-key",
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
      // Provider should still be available with manually configured models
      expect(providers["my-proxy"]).toBeDefined()
      expect(providers["my-proxy"].models["fallback-model"]).toBeDefined()
    },
  })
})

test("gracefully handles non-OK response from models endpoint", async () => {
  mockFetchNotOk()

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "my-proxy": {
              name: "LiteLLM 500",
              npm: "@ai-sdk/openai-compatible",
              models: {
                "existing-model": {
                  name: "Existing",
                  tool_call: true,
                  limit: { context: 8000, output: 2000 },
                },
              },
              options: {
                litellmProxy: true,
                autoload: true,
                baseURL: "https://error.example.com/v1",
                apiKey: "sk-key",
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
      expect(providers["my-proxy"]).toBeDefined()
      expect(providers["my-proxy"].models["existing-model"]).toBeDefined()
    },
  })
})

test("skips auto-load when no baseURL is configured", async () => {
  const fetchMock = mockFetch(["should-not-appear"])

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "my-proxy": {
              name: "LiteLLM No URL",
              npm: "@ai-sdk/openai-compatible",
              models: {
                "manual-model": {
                  name: "Manual Model",
                  tool_call: true,
                  limit: { context: 8000, output: 2000 },
                },
              },
              options: {
                litellmProxy: true,
                autoload: true,
                apiKey: "sk-key",
                // No baseURL
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
      expect(providers["my-proxy"]).toBeDefined()
      // Only the manually configured model should exist
      expect(Object.keys(providers["my-proxy"].models)).toEqual(["manual-model"])
    },
  })
})

test("passes correct headers to fetch including apiKey and custom headers", async () => {
  const fetchMock = mockFetch(["test-model"])

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "my-proxy": {
              name: "LiteLLM Headers",
              npm: "@ai-sdk/openai-compatible",
              options: {
                litellmProxy: true,
                autoload: true,
                baseURL: "https://proxy.example.com/v1",
                apiKey: "sk-my-key",
                headers: {
                  "X-Custom-Header": "custom-value",
                },
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
      expect(providers["my-proxy"]).toBeDefined()

      // Verify fetch was called with correct URL and headers (first call is /model/info)
      const infoCall = fetchMock.mock.calls.find((call: any[]) => {
        const url = typeof call[0] === "string" ? call[0] : call[0].toString()
        return url.includes("/model/info")
      })
      expect(infoCall).toBeDefined()

      const url = typeof infoCall![0] === "string" ? infoCall![0] : infoCall![0].toString()
      expect(url).toBe("https://proxy.example.com/v1/model/info")

      const init = infoCall![1] as RequestInit
      expect(init.headers).toBeDefined()
      const headers = init.headers as Record<string, string>
      expect(headers["Authorization"]).toBe("Bearer sk-my-key")
      expect(headers["X-Custom-Header"]).toBe("custom-value")
    },
  })
})

test("handles model IDs with slashes", async () => {
  mockFetch(["anthropic/claude-opus-4-5", "openai/gpt-5/turbo"])

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "my-proxy": {
              name: "LiteLLM Slashes",
              npm: "@ai-sdk/openai-compatible",
              options: {
                litellmProxy: true,
                autoload: true,
                baseURL: "https://proxy.example.com/v1",
                apiKey: "sk-key",
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
      expect(providers["my-proxy"]).toBeDefined()
      expect(providers["my-proxy"].models["anthropic/claude-opus-4-5"]).toBeDefined()
      expect(providers["my-proxy"].models["openai/gpt-5/turbo"]).toBeDefined()
    },
  })
})

test("non-litellm provider does not attempt auto-load", async () => {
  const fetchMock = mockFetch(["should-not-appear"])

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "regular-provider": {
              name: "Regular Provider",
              npm: "@ai-sdk/openai-compatible",
              models: {
                "my-model": {
                  name: "My Model",
                  tool_call: true,
                  limit: { context: 8000, output: 2000 },
                },
              },
              options: {
                baseURL: "https://api.example.com/v1",
                apiKey: "sk-key",
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
      expect(providers["regular-provider"]).toBeDefined()
      // Only the manually configured model should exist
      expect(Object.keys(providers["regular-provider"].models)).toEqual(["my-model"])
      // Fetch should not have been called for /models or /model/info
      const litellmCalls = fetchMock.mock.calls.filter((call: any[]) => {
        const url = typeof call[0] === "string" ? call[0] : call[0].toString()
        return url.endsWith("/models") || url.endsWith("/model/info")
      })
      expect(litellmCalls.length).toBe(0)
    },
  })
})

test("strips trailing slashes from baseURL before constructing models endpoint", async () => {
  const fetchMock = mockFetch(["model-1"])

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "my-proxy": {
              name: "LiteLLM Trailing Slash",
              npm: "@ai-sdk/openai-compatible",
              options: {
                litellmProxy: true,
                autoload: true,
                baseURL: "https://proxy.example.com/v1///",
                apiKey: "sk-key",
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
      expect(providers["my-proxy"]).toBeDefined()

      // First call should be /model/info with trailing slashes stripped
      const infoCall = fetchMock.mock.calls.find((call: any[]) => {
        const url = typeof call[0] === "string" ? call[0] : call[0].toString()
        return url.includes("/model/info")
      })
      expect(infoCall).toBeDefined()
      const infoUrl = typeof infoCall![0] === "string" ? infoCall![0] : infoCall![0].toString()
      expect(infoUrl).toBe("https://proxy.example.com/v1/model/info")

      // Falls back to /models since /model/info returns 404 in this mock
      const modelsCall = fetchMock.mock.calls.find((call: any[]) => {
        const url = typeof call[0] === "string" ? call[0] : call[0].toString()
        return url.endsWith("/models")
      })
      expect(modelsCall).toBeDefined()
      const modelsUrl = typeof modelsCall![0] === "string" ? modelsCall![0] : modelsCall![0].toString()
      expect(modelsUrl).toBe("https://proxy.example.com/v1/models")
    },
  })
})

// ---- /model/info tests ----

test("uses /model/info to populate model capabilities and costs", async () => {
  mockFetchWithModelInfo([
    {
      model_name: "claude-sonnet-4",
      model_info: {
        max_input_tokens: 200000,
        max_output_tokens: 16384,
        input_cost_per_token: 0.000003,
        output_cost_per_token: 0.000015,
        cache_read_input_token_cost: 0.0000003,
        cache_creation_input_token_cost: 0.00000375,
        supports_vision: true,
        supports_function_calling: true,
        supports_reasoning: true,
        supports_audio_input: false,
        supports_audio_output: false,
        supports_pdf_input: true,
        supported_openai_params: ["temperature", "top_p", "max_tokens"],
        mode: "chat",
      },
    },
  ])

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "my-proxy": {
              name: "LiteLLM Proxy",
              npm: "@ai-sdk/openai-compatible",
              api: "https://proxy.example.com/v1",
              options: {
                litellmProxy: true,
                autoload: true,
                baseURL: "https://proxy.example.com/v1",
                apiKey: "sk-key",
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
      const model = providers["my-proxy"].models["claude-sonnet-4"]
      expect(model).toBeDefined()

      // Capabilities from model_info
      expect(model.capabilities.reasoning).toBe(true)
      expect(model.capabilities.toolcall).toBe(true)
      expect(model.capabilities.temperature).toBe(true)
      expect(model.capabilities.attachment).toBe(true) // vision || pdf
      expect(model.capabilities.input.image).toBe(true) // supports_vision
      expect(model.capabilities.input.pdf).toBe(true)
      expect(model.capabilities.input.audio).toBe(false)
      expect(model.capabilities.output.audio).toBe(false)

      // Costs converted from per-token to per-million
      expect(model.cost.input).toBe(3) // 0.000003 * 1_000_000
      expect(model.cost.output).toBe(15) // 0.000015 * 1_000_000
      expect(model.cost.cache.read).toBeCloseTo(0.3) // 0.0000003 * 1_000_000
      expect(model.cost.cache.write).toBeCloseTo(3.75) // 0.00000375 * 1_000_000

      // Limits from model_info
      expect(model.limit.context).toBe(200000)
      expect(model.limit.output).toBe(16384)
    },
  })
})

test("model/info: maps supports_vision to image input capability", async () => {
  mockFetchWithModelInfo([
    {
      model_name: "vision-model",
      model_info: {
        max_input_tokens: 128000,
        max_output_tokens: 4096,
        supports_vision: true,
        supports_function_calling: true,
        supports_pdf_input: false,
        mode: "chat",
      },
    },
    {
      model_name: "text-only-model",
      model_info: {
        max_input_tokens: 32000,
        max_output_tokens: 2048,
        supports_vision: false,
        supports_function_calling: true,
        supports_pdf_input: false,
        mode: "chat",
      },
    },
  ])

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "my-proxy": {
              name: "LiteLLM",
              npm: "@ai-sdk/openai-compatible",
              options: {
                litellmProxy: true,
                autoload: true,
                baseURL: "https://proxy.example.com/v1",
                apiKey: "sk-key",
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
      const vision = providers["my-proxy"].models["vision-model"]
      const textOnly = providers["my-proxy"].models["text-only-model"]

      expect(vision.capabilities.input.image).toBe(true)
      expect(vision.capabilities.attachment).toBe(true)
      expect(vision.limit.context).toBe(128000)

      expect(textOnly.capabilities.input.image).toBe(false)
      expect(textOnly.capabilities.attachment).toBe(false)
      expect(textOnly.limit.context).toBe(32000)
    },
  })
})

test("model/info: handles null cost values gracefully", async () => {
  mockFetchWithModelInfo([
    {
      model_name: "free-model",
      model_info: {
        max_input_tokens: 64000,
        max_output_tokens: 4096,
        input_cost_per_token: null,
        output_cost_per_token: null,
        cache_read_input_token_cost: null,
        cache_creation_input_token_cost: null,
        supports_function_calling: true,
        mode: "chat",
      },
    },
  ])

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "my-proxy": {
              name: "LiteLLM",
              npm: "@ai-sdk/openai-compatible",
              options: {
                litellmProxy: true,
                autoload: true,
                baseURL: "https://proxy.example.com/v1",
                apiKey: "sk-key",
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
      const model = providers["my-proxy"].models["free-model"]
      expect(model).toBeDefined()
      expect(model.cost.input).toBe(0)
      expect(model.cost.output).toBe(0)
      expect(model.cost.cache.read).toBe(0)
      expect(model.cost.cache.write).toBe(0)
    },
  })
})

test("model/info: maps over-200k costs to experimentalOver200K", async () => {
  mockFetchWithModelInfo([
    {
      model_name: "long-context-model",
      model_info: {
        max_input_tokens: 1048576,
        max_output_tokens: 65535,
        input_cost_per_token: 0.00000125,
        output_cost_per_token: 0.00001,
        input_cost_per_token_above_200k_tokens: 0.0000025,
        output_cost_per_token_above_200k_tokens: 0.000015,
        supports_function_calling: true,
        mode: "chat",
      },
    },
  ])

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "my-proxy": {
              name: "LiteLLM",
              npm: "@ai-sdk/openai-compatible",
              options: {
                litellmProxy: true,
                autoload: true,
                baseURL: "https://proxy.example.com/v1",
                apiKey: "sk-key",
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
      const model = providers["my-proxy"].models["long-context-model"]
      expect(model).toBeDefined()

      expect(model.cost.input).toBeCloseTo(1.25) // 0.00000125 * 1M
      expect(model.cost.output).toBe(10) // 0.00001 * 1M
      expect(model.cost.experimentalOver200K).toBeDefined()
      expect(model.cost.experimentalOver200K!.input).toBeCloseTo(2.5) // 0.0000025 * 1M
      expect(model.cost.experimentalOver200K!.output).toBe(15) // 0.000015 * 1M

      expect(model.limit.context).toBe(1048576)
      expect(model.limit.output).toBe(65535)
    },
  })
})

test("model/info: falls back to /models when /model/info returns 404", async () => {
  const fetchMock = mockFetch(["fallback-model-a", "fallback-model-b"])

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "my-proxy": {
              name: "Old LiteLLM",
              npm: "@ai-sdk/openai-compatible",
              options: {
                litellmProxy: true,
                autoload: true,
                baseURL: "https://proxy.example.com/v1",
                apiKey: "sk-key",
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
      const provider = providers["my-proxy"]
      expect(provider).toBeDefined()

      // Models loaded via fallback /models endpoint
      expect(provider.models["fallback-model-a"]).toBeDefined()
      expect(provider.models["fallback-model-b"]).toBeDefined()

      // Fallback models should have default values (no rich metadata)
      const model = provider.models["fallback-model-a"]
      expect(model.cost.input).toBe(0)
      expect(model.cost.output).toBe(0)
      expect(model.limit.context).toBe(128000)
      expect(model.limit.output).toBe(8192)

      // Verify both endpoints were called
      const infoCalls = fetchMock.mock.calls.filter((call: any[]) => {
        const url = typeof call[0] === "string" ? call[0] : call[0].toString()
        return url.endsWith("/model/info")
      })
      const modelsCalls = fetchMock.mock.calls.filter((call: any[]) => {
        const url = typeof call[0] === "string" ? call[0] : call[0].toString()
        return url.endsWith("/models")
      })
      expect(infoCalls.length).toBe(1) // Tried /model/info first
      expect(modelsCalls.length).toBe(1) // Fell back to /models
    },
  })
})

test("model/info: does not call /models when /model/info succeeds", async () => {
  const fetchMock = mockFetchWithModelInfo([
    {
      model_name: "info-model",
      model_info: {
        max_input_tokens: 128000,
        max_output_tokens: 4096,
        supports_function_calling: true,
        mode: "chat",
      },
    },
  ])

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "my-proxy": {
              name: "LiteLLM",
              npm: "@ai-sdk/openai-compatible",
              options: {
                litellmProxy: true,
                autoload: true,
                baseURL: "https://proxy.example.com/v1",
                apiKey: "sk-key",
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
      expect(providers["my-proxy"].models["info-model"]).toBeDefined()

      // /model/info was called
      const infoCalls = fetchMock.mock.calls.filter((call: any[]) => {
        const url = typeof call[0] === "string" ? call[0] : call[0].toString()
        return url.endsWith("/model/info")
      })
      expect(infoCalls.length).toBe(1)

      // /models should NOT have been called
      const modelsCalls = fetchMock.mock.calls.filter((call: any[]) => {
        const url = typeof call[0] === "string" ? call[0] : call[0].toString()
        return url.endsWith("/models") && !url.endsWith("/model/info")
      })
      expect(modelsCalls.length).toBe(0)
    },
  })
})

test("model/info: temperature capability from supported_openai_params", async () => {
  mockFetchWithModelInfo([
    {
      model_name: "with-temp",
      model_info: {
        max_input_tokens: 64000,
        max_output_tokens: 4096,
        supported_openai_params: ["temperature", "top_p", "max_tokens"],
        mode: "chat",
      },
    },
    {
      model_name: "no-temp",
      model_info: {
        max_input_tokens: 64000,
        max_output_tokens: 4096,
        supported_openai_params: ["top_p", "max_tokens"],
        mode: "chat",
      },
    },
  ])

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "my-proxy": {
              name: "LiteLLM",
              npm: "@ai-sdk/openai-compatible",
              options: {
                litellmProxy: true,
                autoload: true,
                baseURL: "https://proxy.example.com/v1",
                apiKey: "sk-key",
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
      expect(providers["my-proxy"].models["with-temp"].capabilities.temperature).toBe(true)
      expect(providers["my-proxy"].models["no-temp"].capabilities.temperature).toBe(false)
    },
  })
})

import { test, expect, beforeEach, afterEach, mock } from "bun:test"
import path from "path"

import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"

// Mock fetch for dynamic model discovery tests
let originalFetch: typeof global.fetch
let mockFetch: ReturnType<typeof mock>

beforeEach(() => {
  originalFetch = global.fetch
  mockFetch = mock((url: string | URL | Request) =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    }),
  )
  global.fetch = mockFetch as any
})

afterEach(() => {
  global.fetch = originalFetch
  mockFetch.mockReset()
})

test("dynamic model discovery - successful", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "test-openai-compatible": {
              npm: "@ai-sdk/openai-compatible",
              options: {
                baseURL: "http://localhost:1234/v1",
              },
              dynamicModelList: true,
            },
          },
        }),
      )
    },
  })

  // Mock successful model discovery
  mockFetch.mockImplementationOnce(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            { id: "model-1", name: "Test Model 1", max_context_length: 128000 },
            { id: "model-2", name: "Test Model 2", max_context_length: 32768 },
          ],
        }),
    }),
  )

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      const provider = providers["test-openai-compatible"]

      expect(provider).toBeDefined()
      expect(provider.models["model-1"]).toBeDefined()
      expect(provider.models["model-2"]).toBeDefined()
      expect(provider.models["model-1"].limit.context).toBe(128000)
      expect(provider.models["model-2"].limit.context).toBe(32768)
    },
  })
})

test("dynamic model discovery - discoverModelsFromEndpoint with small context floor", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "test-openai-compatible": {
              npm: "@ai-sdk/openai-compatible",
              options: {
                baseURL: "http://localhost:1234/v1",
              },
              dynamicModelList: true,
            },
          },
        }),
      )
    },
  })

  // Mock response with small context length
  mockFetch.mockImplementationOnce(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ id: "small-model", max_context_length: 4096 }],
        }),
    }),
  )

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      const provider = providers["test-openai-compatible"]

      expect(provider).toBeDefined()
      expect(provider.models["small-model"]).toBeDefined()
      // Should apply 8k floor
      expect(provider.models["small-model"].limit.context).toBe(8192)
    },
  })
})

test("dynamic model discovery - discoverModelsFromEndpoint missing max_context_length uses default", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "test-openai-compatible": {
              npm: "@ai-sdk/openai-compatible",
              options: {
                baseURL: "http://localhost:1234/v1",
              },
              dynamicModelList: true,
            },
          },
        }),
      )
    },
  })

  // Mock response without context length
  mockFetch.mockImplementationOnce(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ id: "model-no-context" }],
        }),
    }),
  )

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      const provider = providers["test-openai-compatible"]

      expect(provider).toBeDefined()
      expect(provider.models["model-no-context"]).toBeDefined()
      // Should use default 8k
      expect(provider.models["model-no-context"].limit.context).toBe(131072)
    },
  })
})

test("dynamic model discovery - discoverModelsFromEndpoint handles non-200 response", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "test-openai-compatible": {
              npm: "@ai-sdk/openai-compatible",
              options: {
                baseURL: "http://localhost:1234/v1",
              },
              dynamicModelList: true,
            },
          },
        }),
      )
    },
  })

  // Mock non-200 response
  mockFetch.mockImplementationOnce(() =>
    Promise.resolve({
      ok: false,
      status: 500,
    }),
  )

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      const provider = providers["test-openai-compatible"]

      // Should not load the provider when discovery fails and no explicit models
      expect(provider).toBeUndefined()
    },
  })
})

test("dynamic model discovery - discoverModelsFromEndpoint handles invalid response format", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "test-openai-compatible": {
              npm: "@ai-sdk/openai-compatible",
              options: {
                baseURL: "http://localhost:1234/v1",
              },
              dynamicModelList: true,
            },
          },
        }),
      )
    },
  })

  // Mock invalid response format (no data array)
  mockFetch.mockImplementationOnce(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ invalid: "format" }),
    }),
  )

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      const provider = providers["test-openai-compatible"]

      // Should not load the provider when discovery fails and no explicit models
      expect(provider).toBeUndefined()
    },
  })
})

test("dynamic model discovery - endpoint request without auth when no apiKey", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "test-openai-compatible": {
              npm: "@ai-sdk/openai-compatible",
              options: {
                baseURL: "http://localhost:1234/v1",
              },
              dynamicModelList: true,
            },
          },
        }),
      )
    },
  })

  // Mock fetch to verify no auth headers
  mockFetch.mockImplementationOnce((url, init) => {
    expect(init?.headers).not.toHaveProperty("Authorization")
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ id: "model-1" }],
        }),
    })
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      const provider = providers["test-openai-compatible"]

      expect(provider).toBeDefined()
      expect(provider.models["model-1"]).toBeDefined()
    },
  })
})

test("dynamic model discovery - endpoint request includes auth headers", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "test-openai-compatible": {
              npm: "@ai-sdk/openai-compatible",
              options: {
                baseURL: "http://localhost:1234/v1",
              },
              dynamicModelList: true,
            },
          },
        }),
      )
    },
  })

  // Mock fetch to capture headers
  mockFetch.mockImplementationOnce((url, init) => {
    expect(init?.headers).toHaveProperty("Authorization")
    expect(init?.headers.Authorization).toBe("Bearer test-api-key")
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ id: "model-1" }],
        }),
    })
  })

  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      // Mock Auth.get to return API key
      const Auth = await import("../../src/auth")
      Auth.Auth.get = async () => ({ type: "api", key: "test-api-key" })
    },
    fn: async () => {
      const providers = await Provider.list()
      const provider = providers["test-openai-compatible"]

      expect(provider).toBeDefined()
      expect(provider.models["model-1"]).toBeDefined()
    },
  })
})

test("dynamic model discovery - local config API key overrides the global one", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "test-openai-compatible": {
              npm: "@ai-sdk/openai-compatible",
              options: {
                baseURL: "http://localhost:1234/v1",
                apiKey: "local-api-key",
              },
              dynamicModelList: true,
            },
          },
        }),
      )
    },
  })

  // Mock fetch to capture headers
  mockFetch.mockImplementationOnce((url, init) => {
    expect(init?.headers).toHaveProperty("Authorization")
    expect(init?.headers.Authorization).toBe("Bearer local-api-key")
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ id: "model-1" }],
        }),
    })
  })

  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      // Mock Auth.get to return API key
      const Auth = await import("../../src/auth")
      Auth.Auth.get = async () => ({ type: "api", key: "global-api-key" })
    },
    fn: async () => {
      const providers = await Provider.list()
      const provider = providers["test-openai-compatible"]

      expect(provider).toBeDefined()
      expect(provider.models["model-1"]).toBeDefined()
    },
  })
})

test("dynamic model discovery - provider doesn't load when dynamicModelList: false and no model list", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "test-openai-compatible": {
              npm: "@ai-sdk/openai-compatible",
              options: {
                baseURL: "http://localhost:1234/v1",
              },
              dynamicModelList: false,
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
      // Should not load the provider when dynamicModelList is false
      expect(providers["test-openai-compatible"]).toBeUndefined()
    },
  })
})

test("dynamic model discovery - explicitly configured models returned when specified and dynamicModelList: false", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "test-openai-compatible": {
              npm: "@ai-sdk/openai-compatible",
              options: {
                baseURL: "http://localhost:1234/v1",
              },
              dynamicModelList: false,
              models: {
                "explicit-model": {
                  name: "Explicit Model",
                },
              },
            },
          },
        }),
      )
    },
  })

  mockFetch.mockImplementationOnce(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ id: "model-1", name: "Test Model" }],
        }),
    }),
  )

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      const provider = providers["test-openai-compatible"]

      expect(provider).toBeDefined()
      expect(provider.models["explicit-model"]).toBeDefined()
      expect(mockFetch).not.toBeCalled()
    },
  })
})

test("dynamic model discovery - uses explicit models when both configured", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "test-openai-compatible": {
              npm: "@ai-sdk/openai-compatible",
              options: {
                baseURL: "http://localhost:1234/v1",
              },
              dynamicModelList: true,
              models: {
                "explicit-model": {
                  name: "Explicit Model",
                },
              },
            },
          },
        }),
      )
    },
  })

  mockFetch.mockImplementationOnce(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ id: "discovered-model" }],
        }),
    }),
  )

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      const provider = providers["test-openai-compatible"]

      // Explicit models should take precedence
      expect(provider).toBeDefined()
      expect(provider.models["explicit-model"]).toBeDefined()
      // Discovered models should not replace explicit ones,
      // and the endpoint shouldn't even be called
      expect(provider.models["discovered-model"]).toBeUndefined()
      expect(mockFetch).not.toBeCalled()
    },
  })
})

test("dynamic model discovery - provider doesn't load when no baseURL", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "test-openai-compatible": {
              npm: "@ai-sdk/openai-compatible",
              dynamicModelList: true,
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Should not load when no baseURL
      expect(Provider.list()).rejects.toThrow()
    },
  })
})

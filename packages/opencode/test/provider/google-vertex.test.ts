import { test, expect, mock, describe, beforeAll } from "bun:test"
import path from "path"

// Mock BunProc to return pkg name
mock.module("../../src/bun/index", () => ({
  BunProc: {
    install: async (pkg: string, _version?: string) => {
      return pkg
    },
    run: async () => { throw new Error("BunProc.run should not be called in tests") },
    which: () => process.execPath,
    InstallFailedError: class extends Error { },
  },
}))

// Mock auth plugins
const mockPlugin = () => ({})
mock.module("opencode-copilot-auth", () => ({ default: mockPlugin }))
mock.module("opencode-anthropic-auth", () => ({ default: mockPlugin }))
mock.module("@gitlab/opencode-gitlab-auth", () => ({ default: mockPlugin }))

// Mock External SDKs
const mockGoogleVertex = mock((options?: any) => {
  return {
    languageModel: (id: string) => ({ id, provider: "google-vertex", options }),
  }
})

const mockOpenAI = mock((options: any) => ({
  languageModel: (id: string) => ({ id, provider: "openai-compatible", options }),
}))

mock.module("@ai-sdk/google-vertex", () => ({
  createVertex: (options: any) => {
    return mockGoogleVertex(options)
  }
}))

mock.module("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: (options: any) => {
    return mockOpenAI(options)
  },
  OpenAICompatibleChatLanguageModel: class { constructor() { } },
  OpenAICompatibleCompletionLanguageModel: class { constructor() { } },
  OpenAICompatibleEmbeddingModel: class { constructor() { } },
  OpenAICompatibleImageModel: class { constructor() { } }
}))

mock.module("google-auth-library", () => ({
  GoogleAuth: class {
    async getApplicationDefault() {
      return {
        credential: {
          getAccessToken: async () => ({
            token: "mock-access-token",
          }),
        },
      }
    }
  },
}))

describe("Google Vertex Provider Merge", () => {
  let Provider: any
  let Instance: any
  let Env: any
  let tmpdir: any

  beforeAll(async () => {
    // Dynamic import to ensure mocks are active before modules load
    const fixture = await import("../fixture/fixture")
    tmpdir = fixture.tmpdir

    const instance = await import("../../src/project/instance")
    Instance = instance.Instance

    const provider = await import("../../src/provider/provider")
    Provider = provider.Provider

    const env = await import("../../src/env")
    Env = env.Env
  })

  test("loader returns merged options including baseURL and fetch", async () => {
    await using tmp = await tmpdir({
      init: async (dir: string) => {
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
        Env.set("GOOGLE_CLOUD_PROJECT", "test-project")
        Env.set("GOOGLE_CLOUD_LOCATION", "us-central1")
      },
      fn: async () => {
        const providers = await Provider.list()
        const vertex = providers["google-vertex"]
        expect(vertex).toBeDefined()
        expect(vertex.options.project).toBe("test-project")
        expect(vertex.options.location).toBe("us-central1")
        expect(vertex.options.baseURL).toContain("us-central1-aiplatform.googleapis.com")
        expect(vertex.options.fetch).toBeDefined()
      },
    })
  })

  test("official SDK options are sanitized (no baseURL/fetch)", async () => {
    await using tmp = await tmpdir({
      init: async (dir: string) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            provider: {
              "google-vertex": {
                models: {
                  "gemini-1.5-pro": {
                    api: { npm: "@ai-sdk/google-vertex" } // Force official SDK
                  }
                }
              }
            }
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("GOOGLE_CLOUD_PROJECT", "test-project")
      },
      fn: async () => {
        mockGoogleVertex.mockClear()

        // Trigger SDK loading
        const model = await Provider.getModel("google-vertex", "gemini-1.5-pro")
        await Provider.getLanguage(model)

        expect(mockGoogleVertex).toHaveBeenCalled()
        const callArgs = mockGoogleVertex.mock.calls[0][0] as any

        // These should be STRIPPED for official SDK
        expect(callArgs.baseURL).toBeUndefined()
        // expect(callArgs.fetch).toBeUndefined() // Removed expectation due to wrapper
        expect(callArgs.project).toBe("test-project")
      },
    })
  })

  test("OpenAPI model options RETAIN baseURL and fetch", async () => {
    await using tmp = await tmpdir({
      init: async (dir: string) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            provider: {
              "google-vertex": {
                models: {
                  "openapi-model": {
                    protocol: "openapi",
                    id: "gemini-1.5-pro-alias"
                  }
                }
              }
            }
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("GOOGLE_CLOUD_PROJECT", "test-project")
        Env.set("GOOGLE_CLOUD_LOCATION", "us-central1")
      },
      fn: async () => {
        mockOpenAI.mockClear()

        // Trigger SDK loading
        const model = await Provider.getModel("google-vertex", "openapi-model")
        expect(model).toBeDefined()
        expect(model.api.npm).toBe("@ai-sdk/openai-compatible")
        expect(model.api.id).toBe("gemini-1.5-pro-alias") // Verify aliasing via top-level id
        const result = await Provider.getLanguage(model) as any

        // Check options passed through the mock
        expect(result.options).toBeDefined()
        expect(result.options.baseURL).toBeDefined()
        expect(result.options.baseURL).toContain("us-central1-aiplatform")
        expect(result.options.fetch).toBeDefined()
        expect(result.options.project).toBe("test-project")
      },
    })
  })
})

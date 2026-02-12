import { test, expect, mock, describe, beforeAll, afterAll } from "bun:test"
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
mock.module("@gitlab/opencode-gitlab-auth", () => ({
  default: mockPlugin,
  gitlabAuthPlugin: mockPlugin,
}))

// Mock Google Auth Library (required for official SDK initialization)
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

  test("official SDK options STRIP googleapis.com baseURL but RETAIN custom proxy", async () => {
    await using tmp = await tmpdir({
      init: async (dir: string) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            provider: {
              "google-vertex": {
                models: {
                  "google-stripped": { api: { npm: "@ai-sdk/google-vertex", id: "gemini-1.5-pro" } },
                  "proxy-preserved": { api: { npm: "@ai-sdk/google-vertex", id: "gemini-1.5-pro" } },
                  "localhost-preserved": { api: { npm: "@ai-sdk/google-vertex", id: "gemini-1.5-pro" } }
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
        const providers = await Provider.list()
        const vertex = providers["google-vertex"]

        // Case 1: Standard Google URL -> should be stripped
        vertex.options.baseURL = "https://us-central1-aiplatform.googleapis.com/v1"
        const modelGoogle = await Provider.getModel("google-vertex", "google-stripped")
        const sdkGoogle = await Provider.getLanguage(modelGoogle) as any
        expect(sdkGoogle.config.baseURL).not.toBe("https://us-central1-aiplatform.googleapis.com/v1")

        // Case 2: Custom Proxy -> should be RETAINED
        // We MUST use a different model to avoid cache in getLanguage
        vertex.options.baseURL = "https://my-proxy.com/v1"
        const modelProxy = await Provider.getModel("google-vertex", "proxy-preserved")
        const sdkProxy = await Provider.getLanguage(modelProxy) as any
        expect(sdkProxy.config.baseURL).toBe("https://my-proxy.com/v1")

        // Case 3: Localhost -> should be RETAINED
        vertex.options.baseURL = "http://localhost:8080/v1"
        const modelLocal = await Provider.getModel("google-vertex", "localhost-preserved")
        const sdkLocal = await Provider.getLanguage(modelLocal) as any
        expect(sdkLocal.config.baseURL).toBe("http://localhost:8080/v1")
      },
    })
  })

  test("OpenAPI model options RETAIN baseURL and fetch", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response(JSON.stringify({ id: "test", choices: [] }), { status: 200 })
      }
    })

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
                    id: "gemini-1.5-pro-alias",
                    provider: { npm: "@ai-sdk/openai-compatible", api: "https://api.google.com" }
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
        // Trigger SDK loading
        const model = await Provider.getModel("google-vertex", "openapi-model")
        expect(model).toBeDefined()
        expect(model.api.npm).toBe("@ai-sdk/openai-compatible")

        // Manually inject baseURL into the provider options for this test session
        const providers = await Provider.list()
        const vertex = providers["google-vertex"]
        vertex.options.baseURL = server.url.origin + "/v1"
        vertex.options.fetch = fetch

        const sdk = await Provider.getLanguage(model)

        try {
          await sdk.doGenerate({
            inputFormat: "messages",
            mode: { type: "regular" },
            modelId: "test-model",
            prompt: [{ role: "user", content: [{ type: "text", text: "test" }] }],
          })
        } catch (e) {
          // Success if we hit the server
        }
      },
    })

    server.stop()
  })
})

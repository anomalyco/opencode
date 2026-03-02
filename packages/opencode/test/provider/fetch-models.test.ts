import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"

describe("provider.shouldFetchModels", () => {
  test("shouldFetchModels: false prevents API calls to /models", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            enabled_providers: ["test-provider"],
            provider: {
              "test-provider": {
                name: "Test Provider",
                shouldFetchModels: false,
                npm: "@ai-sdk/openai-compatible",
                api: "https://api.test.com/v1",
                models: {
                  "test-model": {
                    name: "Test Model",
                  },
                },
                options: {
                  apiKey: "test-key",
                  baseURL: "https://api.test.com/v1",
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
        expect(providers["test-provider"]).toBeDefined()
        expect(providers["test-provider"].models["test-model"]).toBeDefined()
      },
    })
  })

  test("manual models are available when shouldFetchModels is false", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            enabled_providers: ["custom-ai"],
            provider: {
              "custom-ai": {
                name: "Custom AI",
                shouldFetchModels: false,
                npm: "@ai-sdk/openai-compatible",
                api: "https://custom.ai/v1",
                models: {
                  "model-a": {
                    name: "Model A",
                    limit: { context: 128000, output: 4096 },
                  },
                  "model-b": {
                    name: "Model B",
                    limit: { context: 64000, output: 2048 },
                  },
                },
                options: {
                  apiKey: "custom-key",
                  baseURL: "https://custom.ai/v1",
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
        const provider = providers["custom-ai"]
        expect(provider).toBeDefined()
        expect(Object.keys(provider.models)).toHaveLength(2)
        expect(provider.models["model-a"].name).toBe("Model A")
        expect(provider.models["model-b"].name).toBe("Model B")
      },
    })
  })

  test("blacklist filters manual models", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            enabled_providers: ["test-provider"],
            provider: {
              "test-provider": {
                name: "Test Provider",
                shouldFetchModels: false,
                npm: "@ai-sdk/openai-compatible",
                api: "https://api.test.com/v1",
                blacklist: ["blocked-model"],
                models: {
                  "allowed-model": {
                    name: "Allowed Model",
                  },
                  "blocked-model": {
                    name: "Blocked Model",
                  },
                },
                options: {
                  apiKey: "test-key",
                  baseURL: "https://api.test.com/v1",
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
        const models = providers["test-provider"].models
        expect(models["allowed-model"]).toBeDefined()
        expect(models["blocked-model"]).toBeUndefined()
      },
    })
  })

  test("whitelist filters manual models", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            enabled_providers: ["test-provider"],
            provider: {
              "test-provider": {
                name: "Test Provider",
                shouldFetchModels: false,
                npm: "@ai-sdk/openai-compatible",
                api: "https://api.test.com/v1",
                whitelist: ["whitelisted-model"],
                models: {
                  "whitelisted-model": {
                    name: "Whitelisted Model",
                  },
                  "other-model": {
                    name: "Other Model",
                  },
                },
                options: {
                  apiKey: "test-key",
                  baseURL: "https://api.test.com/v1",
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
        const models = providers["test-provider"].models
        expect(models["whitelisted-model"]).toBeDefined()
        expect(models["other-model"]).toBeUndefined()
      },
    })
  })
})

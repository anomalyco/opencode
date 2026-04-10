import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { ProviderID } from "../../src/provider/schema"
import { DEFAULT_CONTEXT_LIMIT, DEFAULT_OUTPUT_LIMIT } from "../../src/provider/constants"

describe("custom model limit defaults", () => {
  test("model without limit.context uses DEFAULT_CONTEXT_LIMIT", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            provider: {
              "no-limit": {
                name: "No Limit Provider",
                npm: "@ai-sdk/openai-compatible",
                env: [],
                models: {
                  model: {
                    name: "Model",
                    tool_call: true,
                    // no limit specified
                  },
                },
                options: { apiKey: "test" },
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
        const model = providers[ProviderID.make("no-limit")].models["model"]
        expect(model.limit.context).toBe(DEFAULT_CONTEXT_LIMIT)
      },
    })
  })

  test("model without limit.output uses DEFAULT_OUTPUT_LIMIT", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            provider: {
              "no-limit": {
                name: "No Limit Provider",
                npm: "@ai-sdk/openai-compatible",
                env: [],
                models: {
                  model: {
                    name: "Model",
                    tool_call: true,
                    // no limit specified
                  },
                },
                options: { apiKey: "test" },
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
        const model = providers[ProviderID.make("no-limit")].models["model"]
        expect(model.limit.output).toBe(DEFAULT_OUTPUT_LIMIT)
      },
    })
  })

  test("model with explicit limit.context overrides default", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            provider: {
              "with-limit": {
                name: "With Limit Provider",
                npm: "@ai-sdk/openai-compatible",
                env: [],
                models: {
                  model: {
                    name: "Model",
                    tool_call: true,
                    limit: { context: 64000, output: 4096 },
                  },
                },
                options: { apiKey: "test" },
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
        const model = providers[ProviderID.make("with-limit")].models["model"]
        expect(model.limit.context).toBe(64000)
        expect(model.limit.output).toBe(4096)
      },
    })
  })

  test("model inheriting limit from existing database model does not use default", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            provider: {
              anthropic: {
                models: {
                  "claude-sonnet-4-20250514": {
                    name: "Custom Name",
                    // no limit - should inherit from database
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
      init: async () => {
        process.env.ANTHROPIC_API_KEY = "test-api-key"
      },
      fn: async () => {
        const providers = await Provider.list()
        const model = providers[ProviderID.anthropic].models["claude-sonnet-4-20250514"]
        // Should inherit from database, not use default
        expect(model.limit.context).toBeGreaterThan(0)
        expect(model.limit.context).not.toBe(DEFAULT_CONTEXT_LIMIT)
      },
    })
  })
})

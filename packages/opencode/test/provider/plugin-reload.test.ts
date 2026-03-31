import { test, expect } from "bun:test"
import path from "path"

import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { ProviderID } from "../../src/provider/schema"

test("plugin provider registered via config persists after instance dispose/reload", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "plugin-provider": {
              npm: "@ai-sdk/openai-compatible",
              name: "Plugin Provider",
              options: {
                baseURL: "https://api.plugin.com/v1",
                headers: {
                  "X-Custom-Header": "test-value",
                },
              },
              models: {
                "plugin-model-1": {
                  name: "Plugin Model 1",
                  id: "plugin-model-1",
                  reasoning: true,
                  tool_call: true,
                  limit: {
                    context: 128000,
                    output: 16384,
                  },
                  cost: {
                    input: 0.001,
                    output: 0.002,
                  },
                  modalities: {
                    input: ["text", "image"],
                    output: ["text"],
                  },
                },
                "plugin-model-2": {
                  name: "Plugin Model 2",
                  id: "plugin-model-2",
                  reasoning: false,
                  tool_call: true,
                  limit: {
                    context: 64000,
                    output: 8192,
                  },
                  cost: {
                    input: 0.0005,
                    output: 0.001,
                  },
                  modalities: {
                    input: ["text"],
                    output: ["text"],
                  },
                },
              },
            },
          },
        }),
      )
    },
  })

  // First instance: provider should be loaded
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      const providerID = ProviderID.make("plugin-provider")
      const provider = providers[providerID]

      // Verify provider exists
      expect(provider).toBeDefined()
      expect(provider?.id).toBe(providerID)
      expect(provider?.name).toBe("Plugin Provider")
      expect(provider?.source).toBe("config")
      expect(provider?.options.baseURL).toBe("https://api.plugin.com/v1")
      expect(provider?.options.headers?.["X-Custom-Header"]).toBe("test-value")

      // Verify models
      expect(Object.keys(provider!.models)).toHaveLength(2)
      expect(provider!.models["plugin-model-1"]).toBeDefined()
      expect(provider!.models["plugin-model-2"]).toBeDefined()

      // Verify model 1 details
      const model1 = provider!.models["plugin-model-1"]
      expect(model1.name).toBe("Plugin Model 1")
      expect(model1.api.id).toBe("plugin-model-1")
      expect(model1.api.npm).toBe("@ai-sdk/openai-compatible")
      expect(model1.capabilities.reasoning).toBe(true)
      expect(model1.capabilities.toolcall).toBe(true)
      expect(model1.limit.context).toBe(128000)
      expect(model1.limit.output).toBe(16384)
      expect(model1.cost.input).toBe(0.001)
      expect(model1.cost.output).toBe(0.002)
      expect(model1.capabilities.input.text).toBe(true)
      expect(model1.capabilities.input.image).toBe(true)
      expect(model1.capabilities.output.text).toBe(true)

      // Verify model 2 details
      const model2 = provider!.models["plugin-model-2"]
      expect(model2.name).toBe("Plugin Model 2")
      expect(model2.capabilities.reasoning).toBe(false)
      expect(model2.limit.context).toBe(64000)
    },
  })

  // Second instance: provider should persist after dispose/reload
  // This is the critical test for issue #20026 fix
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      const providerID = ProviderID.make("plugin-provider")
      const provider = providers[providerID]

      // Verify provider persisted
      expect(provider).toBeDefined()
      expect(provider?.id).toBe(providerID)
      expect(provider?.name).toBe("Plugin Provider")
      expect(provider?.source).toBe("config")

      // Verify options persisted
      expect(provider?.options.baseURL).toBe("https://api.plugin.com/v1")
      expect(provider?.options.headers?.["X-Custom-Header"]).toBe("test-value")

      // Verify models persisted
      expect(Object.keys(provider!.models)).toHaveLength(2)
      expect(provider!.models["plugin-model-1"]).toBeDefined()
      expect(provider!.models["plugin-model-2"]).toBeDefined()

      // Verify data integrity after reload
      const model1 = provider!.models["plugin-model-1"]
      expect(model1.name).toBe("Plugin Model 1")
      expect(model1.api.id).toBe("plugin-model-1")
      expect(model1.api.npm).toBe("@ai-sdk/openai-compatible")
      expect(model1.capabilities.reasoning).toBe(true)
      expect(model1.limit.context).toBe(128000)

      const model2 = provider!.models["plugin-model-2"]
      expect(model2.name).toBe("Plugin Model 2")
      expect(model2.capabilities.reasoning).toBe(false)
      expect(model2.limit.context).toBe(64000)
    },
  })
})

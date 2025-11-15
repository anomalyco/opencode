import { test, expect, describe } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import { Auth } from "../../src/auth"
import { Instance } from "../../src/project/instance"
import { Global } from "../../src/global"
import { parseModelsString } from "../../src/cli/cmd/provider"

describe("parseModelsString", () => {
  test("parses single model with single quotes", () => {
    const result = parseModelsString("llama3:'Llama 3'")
    expect(result).toEqual({
      llama3: { name: "Llama 3" }
    })
  })

  test("parses single model with double quotes", () => {
    const result = parseModelsString('llama3:"Llama 3"')
    expect(result).toEqual({
      llama3: { name: "Llama 3" }
    })
  })

  test("parses single model without quotes", () => {
    const result = parseModelsString("llama3:Llama3")
    expect(result).toEqual({
      llama3: { name: "Llama3" }
    })
  })

  test("parses multiple models", () => {
    const result = parseModelsString("llama3:'Llama 3',codegemma:'Code Gemma 7B'")
    expect(result).toEqual({
      llama3: { name: "Llama 3" },
      codegemma: { name: "Code Gemma 7B" }
    })
  })

  test("handles extra whitespace", () => {
    const result = parseModelsString("  llama3 : 'Llama 3'  ,  codegemma : 'Code Gemma'  ")
    expect(result).toEqual({
      llama3: { name: "Llama 3" },
      codegemma: { name: "Code Gemma" }
    })
  })

  test("returns empty object for empty string", () => {
    expect(parseModelsString("")).toEqual({})
    expect(parseModelsString("   ")).toEqual({})
  })

  test("throws error for invalid format", () => {
    expect(() => parseModelsString("invalid")).toThrow("Invalid model format")
    expect(() => parseModelsString("llama3")).toThrow("Invalid model format")
  })

  test("handles model names with spaces in quotes", () => {
    const result = parseModelsString("model1:'GPT 4 Turbo',model2:'Claude 3.5 Sonnet'")
    expect(result).toEqual({
      model1: { name: "GPT 4 Turbo" },
      model2: { name: "Claude 3.5 Sonnet" }
    })
  })

  test("handles model IDs with hyphens and underscores", () => {
    const result = parseModelsString("gpt-4-turbo:'GPT 4',claude_3_5:'Claude 3.5'")
    expect(result).toEqual({
      "gpt-4-turbo": { name: "GPT 4" },
      "claude_3_5": { name: "Claude 3.5" }
    })
  })

  test("handles model names with commas inside quotes", () => {
    const result = parseModelsString("model1:'GPT-4, Turbo',model2:'Claude 3.5, Sonnet'")
    expect(result).toEqual({
      model1: { name: "GPT-4, Turbo" },
      model2: { name: "Claude 3.5, Sonnet" }
    })
  })

  test("handles model names with colons", () => {
    const result = parseModelsString("model1:'GPT-4: Advanced'")
    expect(result).toEqual({
      model1: { name: "GPT-4: Advanced" }
    })
  })

  test("throws error for invalid model ID with spaces", () => {
    expect(() => parseModelsString("model with spaces:'Name'")).toThrow("Invalid model ID")
  })

  test("throws error for mismatched quotes", () => {
    expect(() => parseModelsString("model1:'incomplete")).toThrow("Mismatched quotes")
  })

  test("handles multiple commas between entries", () => {
    const result = parseModelsString("model1:'Name 1',,,model2:'Name 2'")
    expect(result).toEqual({
      model1: { name: "Name 1" },
      model2: { name: "Name 2" }
    })
  })

  test("handles mixed quote styles", () => {
    const result = parseModelsString("model1:'Single Quotes',model2:\"Double Quotes\"")
    expect(result).toEqual({
      model1: { name: "Single Quotes" },
      model2: { name: "Double Quotes" }
    })
  })

  test("allows uppercase in model IDs", () => {
    const result = parseModelsString("GPT-4:'GPT 4',Claude-3:'Claude 3'")
    expect(result).toEqual({
      "GPT-4": { name: "GPT 4" },
      "Claude-3": { name: "Claude 3" }
    })
  })
})

describe("provider add command integration", () => {
  test("adds provider to project config", async () => {
    await using tmp = await tmpdir()

    // Simulate the command logic
    const id = "test_provider"
    const name = "Test Provider"
    const url = "http://localhost:8080/v1"
    const key = "test-api-key"
    const modelsConfig = parseModelsString("model1:'Model 1'")

    // Store API key
    await Instance.provide({
      directory: tmp.path,
      async fn() {
        await Auth.set(id, {
          type: "api",
          key,
        })

        // Build and write provider config
        const providerConfig = {
          provider: {
            [id]: {
              npm: "@ai-sdk/openai-compatible",
              name: name,
              options: {
                baseURL: url,
              },
              models: modelsConfig,
            },
          },
        }

        const configPath = path.join(tmp.path, "opencode.json")
        await Bun.write(configPath, JSON.stringify(providerConfig, null, 2))

        // Verify auth file
        const authData = await Auth.get(id)
        expect(authData).toEqual({
          type: "api",
          key: "test-api-key",
        })

        // Verify config file
        const configText = await Bun.file(configPath).text()
        const config = JSON.parse(configText)
        expect(config.provider[id]).toEqual({
          npm: "@ai-sdk/openai-compatible",
          name: "Test Provider",
          options: {
            baseURL: "http://localhost:8080/v1",
          },
          models: {
            model1: { name: "Model 1" },
          },
        })
      },
    })
  })

  test("merges with existing config", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        // Create existing config with another provider
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            model: "existing/model",
            provider: {
              existing_provider: {
                npm: "@ai-sdk/openai",
                name: "Existing Provider",
              },
            },
          }, null, 2)
        )
      },
    })

    // Simulate adding a new provider
    const id = "new_provider"
    const name = "New Provider"
    const url = "http://localhost:9000/v1"
    const key = "new-api-key"

    await Instance.provide({
      directory: tmp.path,
      async fn() {
        await Auth.set(id, {
          type: "api",
          key,
        })

        // Read existing config
        const configPath = path.join(tmp.path, "opencode.json")
        const existingText = await Bun.file(configPath).text()
        const existingConfig = JSON.parse(existingText)

        // Merge new provider
        const updatedConfig = {
          ...existingConfig,
          provider: {
            ...existingConfig.provider,
            [id]: {
              npm: "@ai-sdk/openai-compatible",
              name: name,
              options: {
                baseURL: url,
              },
            },
          },
        }

        await Bun.write(configPath, JSON.stringify(updatedConfig, null, 2))

        // Verify both providers exist
        const finalText = await Bun.file(configPath).text()
        const finalConfig = JSON.parse(finalText)
        expect(finalConfig.provider.existing_provider).toBeDefined()
        expect(finalConfig.provider.new_provider).toBeDefined()
        expect(finalConfig.model).toBe("existing/model")
      },
    })
  })

  test("creates config file if it doesn't exist", async () => {
    await using tmp = await tmpdir()

    const id = "ollama"
    const name = "Ollama Local"
    const url = "http://localhost:11434/v1"
    const key = "ollama"

    await Instance.provide({
      directory: tmp.path,
      async fn() {
        await Auth.set(id, {
          type: "api",
          key,
        })

        const configPath = path.join(tmp.path, "opencode.json")
        const providerConfig = {
          provider: {
            [id]: {
              npm: "@ai-sdk/openai-compatible",
              name: name,
              options: {
                baseURL: url,
              },
            },
          },
        }

        await Bun.write(configPath, JSON.stringify(providerConfig, null, 2))

        // Verify file was created
        const exists = await Bun.file(configPath).exists()
        expect(exists).toBe(true)

        const configText = await Bun.file(configPath).text()
        const config = JSON.parse(configText)
        expect(config.provider[id]).toBeDefined()
      },
    })
  })

  test("handles config without models", async () => {
    await using tmp = await tmpdir()

    const id = "no_models_provider"
    const name = "Provider Without Models"
    const url = "http://localhost:7000/v1"
    const key = "test-key"

    await Instance.provide({
      directory: tmp.path,
      async fn() {
        await Auth.set(id, {
          type: "api",
          key,
        })

        const configPath = path.join(tmp.path, "opencode.json")
        const providerConfig = {
          provider: {
            [id]: {
              npm: "@ai-sdk/openai-compatible",
              name: name,
              options: {
                baseURL: url,
              },
            },
          },
        }

        await Bun.write(configPath, JSON.stringify(providerConfig, null, 2))

        const configText = await Bun.file(configPath).text()
        const config = JSON.parse(configText)
        expect(config.provider[id].models).toBeUndefined()
      },
    })
  })

  test("reads and updates .json files with existing content", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            model: "test/model"
          }, null, 2)
        )
      },
    })

    const id = "json_provider"
    const configPath = path.join(tmp.path, "opencode.json")

    // Read existing JSON
    const existingText = await Bun.file(configPath).text()
    const existingConfig = JSON.parse(existingText)

    // Merge new provider
    const updatedConfig = {
      ...existingConfig,
      provider: {
        [id]: {
          npm: "@ai-sdk/openai-compatible",
          name: "JSON Provider",
          options: {
            baseURL: "http://localhost:8888/v1",
          },
        },
      },
    }

    await Bun.write(configPath, JSON.stringify(updatedConfig, null, 2))

    const finalText = await Bun.file(configPath).text()
    const finalConfig = JSON.parse(finalText)
    expect(finalConfig.provider[id]).toBeDefined()
    expect(finalConfig.model).toBe("test/model")
  })
})

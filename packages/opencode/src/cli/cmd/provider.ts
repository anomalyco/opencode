import { cmd } from "./cmd"
import { Auth } from "../../auth"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import path from "path"
import { Global } from "../../global"
import { mergeDeep } from "remeda"
import { parse as parseJsonc } from "jsonc-parser"
import type { Argv } from "yargs"

export const ProviderCommand = cmd({
  command: "provider",
  describe: "manage providers",
  builder: (yargs) => yargs.command(ProviderAddCommand).demandCommand(),
  async handler() {},
})

/**
 * Parses a comma-separated string of models in the format "id:name,id2:name2"
 * into an object structure compatible with the provider config schema.
 *
 * @param modelsString - Comma-separated string like "llama3:'Llama 3',codegemma:'Code Gemma'"
 * @returns Object like { "llama3": { "name": "Llama 3" }, "codegemma": { "name": "Code Gemma" } }
 */
function parseModelsString(modelsString: string): Record<string, { name: string }> {
  if (!modelsString || modelsString.trim() === "") {
    return {}
  }

  const result: Record<string, { name: string }> = {}

  // Split by comma, but handle quoted values
  const modelPairs = modelsString.split(",").map(s => s.trim()).filter(Boolean)

  for (const pair of modelPairs) {
    // Match pattern like: id:'name' or id:name
    const match = pair.match(/^([^:]+):(.+)$/)
    if (!match) {
      throw new Error(`Invalid model format: "${pair}". Expected format: "id:name" or "id:'name'"`)
    }

    const [, modelId, modelName] = match
    const id = modelId.trim()

    // Remove quotes from name if present
    let name = modelName.trim()
    if ((name.startsWith("'") && name.endsWith("'")) || (name.startsWith('"') && name.endsWith('"'))) {
      name = name.slice(1, -1)
    }

    result[id] = { name }
  }

  return result
}

/**
 * Updates the configuration file with the new provider configuration.
 * Handles both global and project-specific configurations.
 */
async function updateProviderConfig(
  providerConfig: Record<string, any>,
  isGlobal: boolean
): Promise<string> {
  const configDir = isGlobal ? Global.Path.config : process.cwd()

  // Try both .json and .jsonc extensions
  let configPath = path.join(configDir, "opencode.json")
  let existingConfig: any = {}

  // Try to read existing config
  try {
    const text = await Bun.file(configPath).text()
    existingConfig = parseJsonc(text, undefined, { allowTrailingComma: true })
  } catch (e: any) {
    if (e.code === "ENOENT") {
      // File doesn't exist, try .jsonc
      const jsoncPath = path.join(configDir, "opencode.jsonc")
      try {
        const text = await Bun.file(jsoncPath).text()
        existingConfig = parseJsonc(text, undefined, { allowTrailingComma: true })
        configPath = jsoncPath
      } catch (e2: any) {
        if (e2.code === "ENOENT") {
          // Neither file exists, create new .json file
          existingConfig = {}
        } else {
          throw e2
        }
      }
    } else {
      throw e
    }
  }

  // Deep merge the provider config into existing config
  const updatedConfig = mergeDeep(existingConfig, {
    provider: providerConfig
  })

  // Write back to file
  await Bun.write(configPath, JSON.stringify(updatedConfig, null, 2))

  return configPath
}

export const ProviderAddCommand = cmd({
  command: "add <id>",
  describe: "add a new OpenAI-compatible provider",
  builder: (yargs: Argv) => {
    return yargs
      .positional("id", {
        describe: "unique identifier for the provider (e.g., 'my_ollama', 'groq_work')",
        type: "string",
        demandOption: true,
      })
      .option("name", {
        describe: "human-readable display name for the provider",
        type: "string",
        demandOption: true,
      })
      .option("url", {
        describe: "base URL for the provider's API endpoint",
        type: "string",
        demandOption: true,
      })
      .option("key", {
        describe: "API key for the provider",
        type: "string",
        demandOption: true,
      })
      .option("models", {
        describe: "comma-separated list of models in format 'id:name,id2:name2'",
        type: "string",
      })
      .option("global", {
        describe: "save to global config instead of project config",
        type: "boolean",
        default: false,
      })
      .example([
        [
          "$0 provider add ollama_local --name 'Ollama (local)' --url 'http://localhost:11434/v1' --key 'ollama' --models \"llama3:'Llama 3'\"",
          "Add a local Ollama provider to the project",
        ],
        [
          "$0 provider add custom_cloud --name 'Custom Cloud AI' --url 'https://api.custom-ai.com/v1' --key 'sk-xxx' --global",
          "Add a custom cloud provider globally",
        ],
      ])
  },
  handler: async (args) => {
    try {
      UI.empty()
      prompts.intro("Add provider")

      const id = args.id as string
      const name = args.name as string
      const url = args.url as string
      const key = args.key as string
      const modelsString = args.models as string | undefined
      const isGlobal = args.global as boolean

      // Validate ID format (alphanumeric, hyphens, underscores)
      if (!id.match(/^[a-z0-9_-]+$/)) {
        prompts.log.error("Provider ID must contain only lowercase letters, numbers, hyphens, and underscores")
        prompts.outro("Failed")
        return
      }

      // Validate URL format
      try {
        new URL(url)
      } catch (e) {
        prompts.log.error(`Invalid URL: ${url}`)
        prompts.outro("Failed")
        return
      }

      // Parse models if provided
      let modelsConfig: Record<string, { name: string }> = {}
      if (modelsString) {
        try {
          modelsConfig = parseModelsString(modelsString)
          prompts.log.info(`Parsed ${Object.keys(modelsConfig).length} model(s)`)
        } catch (e: any) {
          prompts.log.error(e.message)
          prompts.outro("Failed")
          return
        }
      }

      // Store API key securely
      prompts.log.step("Storing API key securely...")
      await Auth.set(id, {
        type: "api",
        key,
      })

      // Build provider configuration
      const providerConfig = {
        [id]: {
          npm: "@ai-sdk/openai-compatible",
          name: name,
          options: {
            baseURL: url,
          },
          ...(Object.keys(modelsConfig).length > 0 && { models: modelsConfig }),
        },
      }

      // Update config file
      prompts.log.step("Updating configuration...")
      const configPath = await updateProviderConfig(providerConfig, isGlobal)

      // Success message
      prompts.log.success(`Provider "${name}" (${id}) added successfully`)
      prompts.log.info(`Configuration saved to: ${configPath}`)
      if (Object.keys(modelsConfig).length > 0) {
        prompts.log.info(`Models configured: ${Object.keys(modelsConfig).join(", ")}`)
      } else {
        prompts.log.warn("No models configured. Add them manually to the config file.")
      }

      prompts.outro("Done")
    } catch (e: any) {
      prompts.log.error(`Failed to add provider: ${e.message}`)
      prompts.outro("Failed")
      throw e
    }
  },
})

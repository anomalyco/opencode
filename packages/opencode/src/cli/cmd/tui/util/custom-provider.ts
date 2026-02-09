import { Config } from "@/config/config"
import { Global } from "@/global"
import path from "path"

export interface CustomProviderConfig {
  id: string
  displayName: string
  baseURL: string
  apiKeyEnv: string
  modelId: string
  modelName: string
  contextLimit: number
  outputLimit: number
  capabilities: {
    temperature: boolean
    reasoning: boolean
    attachment: boolean
    toolCall: boolean
  }
}

/**
 * Adds a custom provider to the configuration file
 * @param data The custom provider configuration
 * @param configPath Optional path to the configuration file (defaults to project opencode.json)
 */
export async function addCustomProvider(data: CustomProviderConfig, configPath?: string) {
  // Use provided path or default to project config
  const configFilePath = configPath || path.join(process.cwd(), "opencode.json")

  let existingConfig: any = {}

  try {
    const configFile = Bun.file(configFilePath)
    if (await configFile.exists()) {
      existingConfig = await configFile.json()
    }
  } catch (e) {
    // File doesn't exist, start with empty config
  }

  // Create the new provider configuration
  const newConfig = {
    ...existingConfig,
    $schema: "https://opencode.ai/config.json",
    provider: {
      ...existingConfig.provider,
      [data.id]: {
        npm: "@ai-sdk/openai-compatible",
        name: data.displayName,
        env: [data.apiKeyEnv],
        options: {
          baseURL: data.baseURL,
        },
        models: {
          [data.modelId]: {
            name: data.modelName,
            release_date: new Date().toISOString().split("T")[0],
            attachment: data.capabilities.attachment,
            reasoning: data.capabilities.reasoning,
            temperature: data.capabilities.temperature,
            tool_call: data.capabilities.toolCall,
            limit: {
              context: data.contextLimit,
              output: data.outputLimit,
            },
            modalities: {
              input: data.capabilities.attachment ? ["text", "image"] : ["text"],
              output: ["text"],
            },
            cost: {
              input: 0, // Placeholder - user can update this manually if needed
              output: 0, // Placeholder - user can update this manually if needed
            },
          },
        },
      },
    },
  }

  // Write the configuration file
  await Bun.write(configFilePath, JSON.stringify(newConfig, null, 2))

  return configFilePath
}

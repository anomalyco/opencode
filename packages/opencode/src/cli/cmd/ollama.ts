import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { mergeDeep } from "remeda"
import { Global } from "../../global"

/**
 * Represents a single Ollama model
 */
export interface OllamaModel {
  name: string
}

/**
 * Collection of Ollama models indexed by model name
 */
export type OllamaModels = Record<string, OllamaModel>

/**
 * Ollama provider configuration structure
 */
export interface OllamaProviderConfig {
  npm: string
  name: string
  options: {
    baseURL: string
  }
  models: OllamaModels
}

/**
 * Configuration object for Ollama
 */
export interface OllamaConfig {
  $schema: string
  provider: {
    ollama: OllamaProviderConfig
  }
}

/**
 * Get the platform-appropriate command to detect ollama
 * @param platform - The platform string (typically process.platform)
 * @returns The command name to use ('where' for Windows, 'which' for Unix)
 */
export function getDetectionCommand(platform: string): string {
  if (platform === "win32") {
    return "where"
  }
  return "which"
}

/**
 * Detect if ollama is installed in PATH using platform-appropriate command
 * @param platform - The platform string (typically process.platform)
 * @returns Promise that resolves if ollama is found, rejects otherwise
 */
export async function detectOllama(platform: string = process.platform): Promise<void> {
  const command = getDetectionCommand(platform)
  await $`${command} ollama`.quiet()
}

export const OllamaCommand = cmd({
  command: "ollama",
  describe: "manage Ollama configuration",
  builder: (yargs) => yargs.command(OllamaInitCommand).demandCommand(),
  async handler() {},
})

export const OllamaInitCommand = cmd({
  command: "init [output]",
  describe: "generate Ollama provider configuration",
  builder: (yargs) =>
    yargs
      .positional("output", {
        describe: "output file path",
        type: "string",
      })
      .option("base-url", {
        describe: "Ollama base URL",
        type: "string",
        default: "http://localhost:11434/v1",
      })
      .option("global", {
        alias: "g",
        describe: "write to global config",
        type: "boolean",
        default: false,
      })
      .option("yes", {
        alias: "y",
        describe: "skip confirmation prompts",
        type: "boolean",
        default: false,
      }),
  async handler(args) {
    UI.empty()
    prompts.intro("Generate Ollama configuration")

    const onError = () => {
      prompts.log.error("Ollama not found in PATH")
      prompts.log.info(
        "Install Ollama from https://ollama.com or ensure it's in your PATH",
      )
      throw new UI.CancelledError()
    }

    // Check if ollama is installed (cross-platform)
    await detectOllama().catch(onError)

    // Get list of models from ollama
    const result = await $`ollama list`.text().catch(() => {
      prompts.log.error("Failed to query ollama models")
      prompts.log.info("Run 'ollama list' to check available models")
      throw new UI.CancelledError()
    })

    const lines = result.split("\n").slice(1) // Skip header
    const modelsList = lines
      .map((line) => line.trim().split(/\s+/)[0])
      .filter((name) => name && name.length > 0)

    if (modelsList.length === 0) {
      prompts.log.warning("No models found from 'ollama list'")
      prompts.log.info("Pull a model first: ollama pull llama2")
      throw new UI.CancelledError()
    }

    prompts.log.success(`Found ${modelsList.length} model(s)`)

    // Show preview of models
    if (!args.yes) {
      prompts.log.info(`Models: ${modelsList.join(", ")}`)

      const confirm = await prompts.confirm({
        message: `Create config with ${modelsList.length} model(s)?`,
        initialValue: true,
      })

      if (prompts.isCancel(confirm) || !confirm) {
        throw new UI.CancelledError()
      }
    }

    // Build models object
    const models: OllamaModels = {}
    for (const modelName of modelsList) {
      models[modelName] = { name: modelName }
    }

    // Determine output path
    const outputPath = args.global
      ? path.join(Global.Path.config, "opencode.json")
      : path.resolve(args.output || "opencode.json")

    // Read existing config if it exists
    const existingConfig = await Bun.file(outputPath)
      .json()
      .catch(() => ({}))

    // Build new config object
    const newConfig: OllamaConfig = {
      $schema: "https://opencode.ai/config.json",
      provider: {
        ollama: {
          npm: "@ai-sdk/openai-compatible",
          name: "Ollama (local)",
          options: {
            baseURL: args.baseUrl,
          },
          models,
        },
      },
    }

    // Merge with existing config
    const mergedConfig = mergeDeep(existingConfig, newConfig)

    // Write config file
    await fs.writeFile(outputPath, JSON.stringify(mergedConfig, null, 2) + "\n").catch((error) => {
      prompts.log.error(`Failed to write config file: ${error}`)
      throw new UI.CancelledError()
    })

    prompts.log.success(`Wrote ${outputPath} with ${modelsList.length} model(s)`)
    prompts.outro("Ollama configuration generated successfully")
  },
})

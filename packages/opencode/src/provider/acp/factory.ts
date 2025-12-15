import type { LanguageModelV2 } from "@ai-sdk/provider"
import { ACPLanguageModel } from "./model"
import type { ACPProviderConfig } from "./types"
import { Log } from "../../util/log"

const log = Log.create({ service: "acp-factory" })

/**
 * Create ACP provider models from configuration
 */
export function createACPProvider(providerID: string, config: ACPProviderConfig): Record<string, LanguageModelV2> {
  using _ = log.time("createACPProvider", { providerID })

  const models: Record<string, LanguageModelV2> = {}

  for (const [modelID, modelConfig] of Object.entries(config.models)) {
    log.info("Creating ACP model", {
      providerID,
      modelID,
      command: config.command,
      args: config.args,
    })

    models[modelID] = new ACPLanguageModel({
      modelId: modelConfig.id,
      command: config.command,
      args: config.args,
      maxTokens: modelConfig.maxTokens,
    })
  }

  return models
}

import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { Log } from "@/util/log"

const log = Log.create({ service: "plugin.model-rewrite" })

export async function ModelRewritePlugin(input: PluginInput): Promise<Hooks> {
  const targetProvider = process.env.OPENCODE_MODEL_REWRITE_PROVIDER
  const targetModel = process.env.OPENCODE_MODEL_REWRITE_MODEL

  const provider = targetProvider?.trim()
  const model = targetModel?.trim()

  if (!provider || !model) return {}

  log.info("model rewrite plugin loaded", { provider, model })

  return {
    "chat.message": async (hookInput, output) => {
      if (output.message.role !== "user") return

      output.message.model = {
        providerID: provider,
        modelID: model,
      }
    },
  }
}

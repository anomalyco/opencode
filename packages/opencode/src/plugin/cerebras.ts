import type { Hooks, PluginInput } from "@opencode-ai/plugin"

export async function CerebrasPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    "chat.params": async (input, output) => {
      if (input.model.api.npm !== "@ai-sdk/cerebras") return
      if (output.options.max_completion_tokens === undefined) return
      output.maxOutputTokens = undefined
    },
  }
}

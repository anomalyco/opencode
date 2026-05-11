import type { Plugin } from "@opencode-ai/plugin"

export const QwenJapanisationPlugin: Plugin = async () => {
  return {
    "experimental.chat.system.transform": async (input, output) => {
      if (input.model.providerID !== "qwen") {
        const LANGUAGE_INSTRUCTION = `
          IMPORTANT: You respond in the SAME LANGUAGE which the user uses. If the user asks you in JAPANESE, you MUST use Japanese. And if the user asks you in ENGLISH, you MUST use English. NEVER mix some languages in the same conversation.
        `.trim()
        if (output.system[0]) {
          output.system[0] = `${LANGUAGE_INSTRUCTION}\n\n${output.system[0]}`
          return
        }
      }
      
    },
  }
}

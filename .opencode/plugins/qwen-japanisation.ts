import type { Plugin } from "@opencode-ai/plugin"

export const QwenJapanisationPlugin: Plugin = async () => {
  return {
    "experimental.chat.system.transform": async (input, output) => {
      if (input.model.providerID !== "qwen") {
        const LANGUAGE_INSTRUCTION = `
          IMPORTANT: You response in the SAME LANGUAGE what the user use. If the user asks you in JAPANESE, you MUST use Japanese. And if the user asks you in ENGLISH, you MUST use English. NEVER mix languages in the conversation.
        `.trim()
        if (output.system[0]) {
          output.system[0] = `${LANGUAGE_INSTRUCTION}\n\n${output.system[0]}`
          return
        }
      }
      
    },
  }
}

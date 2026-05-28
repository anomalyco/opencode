import type { Plugin } from "@opencode-ai/plugin"

export const QwenJapanisationPlugin: Plugin = async () => {
  return {
    "experimental.chat.system.transform": async (input, output) => {
      if (input.model.providerID === "qwen") {
        const LANGUAGE_INSTRUCTION = `
          IMPORTANT: You MUST respond entirely in the SAME LANGUAGE as the user's message. If the user writes in Japanese, your entire response MUST be in Japanese. If the user writes in English, your entire response MUST be in English. NEVER insert Chinese characters, Chinese words, or any Chinese text into your responses unless the user is writing in Chinese. Do NOT switch languages mid-sentence or mid-response.
        `.trim()
        if (output.system[0]) {
          output.system[0] = `${LANGUAGE_INSTRUCTION}\n\n${output.system[0]}`
          return
        }
      }
      
    },
  }
}

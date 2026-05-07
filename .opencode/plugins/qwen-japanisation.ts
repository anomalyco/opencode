import type { Plugin } from "@opencode-ai/plugin"

export const MyCustomPromptPlugin: Plugin = async () => {
  return {
    "experimental.chat.system.transform": async (input, output) => {
      const myCustomInstruction = `
        IMPORTANT: You response in the SAME LANGUAGE what the user use. If the user asks you in JAPANESE, you MUST use Japanese. And if the user asks you in ENGLISH, you MUST use English. NEVER mix languages in the conversation.
      `.trim()
      if (output.system[0]) {
        output.system[0] = `${myCustomInstruction}\n\n${output.system[0]}`
        return
      }
    },
  }
}

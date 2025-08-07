import type { Plugin } from "./packages/plugin/src/index.js"

export const TestReplyLogger: Plugin = async ({ $ }) => {
  return {
    async "chat.reply"(input) {
      const logFile = "test-ai-replies.log"
      const timestamp = new Date().toISOString()
      const entry = `[${timestamp}] Session: ${input.sessionID}\nMessage ID: ${input.messageID}\nReply: ${input.text}\n${"=".repeat(80)}\n\n`

      try {
        await $`echo ${entry} >> ${logFile}`
      } catch (error) {
        // Silent error handling
      }
    },
  }
}

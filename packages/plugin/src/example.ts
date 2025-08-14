import { Plugin } from "./index"

export const ExamplePlugin: Plugin = async () => {
  return {
    async "chat.params"(_, output) {
      output.topP = 1
    },
  }
}

export const ReplyLoggerPlugin: Plugin = async ({ $ }) => {
  return {
    async "chat.reply"(input) {
      const logFile = "ai-replies.log"
      const timestamp = new Date().toISOString()
      const entry = `[${timestamp}] Session: ${input.sessionID} | Message: ${input.messageID}\n${input.text}\n${"=".repeat(80)}\n\n`

      try {
        await $`echo ${entry} >> ${logFile}`
      } catch (error) {
        console.error("Failed to append AI reply to log:", error)
      }
    },
  }
}

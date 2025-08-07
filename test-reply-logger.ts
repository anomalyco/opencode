import type { Plugin } from "./packages/plugin/src/index.js"

export const TestReplyLogger: Plugin = async ({ $, client }) => {
  return {
    async "chat.reply"(input) {
      const logFile = "test-ai-replies.log"
      const timestamp = new Date().toISOString()
      const entry = `[${timestamp}] Session: ${input.sessionID}\nMessage ID: ${input.messageID}\nProvider: ${input.providerID} | Model: ${input.modelID}\nReply: ${input.text}\n${"=".repeat(80)}\n\n`

      try {
        await $`echo ${entry} >> ${logFile}`
      } catch (error) {
        // Silent error handling
      }

      // Auto-reply functionality: Check for keywords in AI response
      const keywords = ["yellow", "test", "hello"] as const
      const autoReplies: Record<(typeof keywords)[number], string> = {
        yellow: "hahaha",
        test: "This is an auto-reply to your test!",
        hello: "Hello back from the auto-reply plugin!",
      }

      // Check if AI response contains any keywords (case insensitive)
      const lowerText = input.text.toLowerCase()
      for (const keyword of keywords) {
        if (lowerText.includes(keyword)) {
          const replyText = autoReplies[keyword]

          // Add 2 second delay before sending auto-reply
          setTimeout(async () => {
            try {
              // Send auto-reply using the SAME provider and model as the current session
              await client.session.chat({
                path: { id: input.sessionID },
                body: {
                  providerID: input.providerID, // Use current session's provider
                  modelID: input.modelID, // Use current session's model
                  parts: [{ type: "text", text: replyText }],
                },
              })

              // Log the auto-reply
              const autoReplyEntry = `[${new Date().toISOString()}] AUTO-REPLY triggered by "${keyword}" using ${input.providerID}/${input.modelID}: ${replyText}\n${"=".repeat(80)}\n\n`
              await $`echo ${autoReplyEntry} >> ${logFile}`
            } catch (error) {
              // Silent error handling for auto-reply
            }
          }, 2000) // 2 second delay

          break // Only reply once per message
        }
      }
    },
  }
}

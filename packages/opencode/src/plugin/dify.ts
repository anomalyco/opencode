import type { PluginInput, Hooks } from "@opencode-ai/plugin"
import { Session } from "../session"
import { Config } from "../config/config"
import os from "os"

export async function DifyPlugin(input: PluginInput): Promise<Hooks> {
  return {
    "chat.headers": async (input, output) => {
      // Only handle dify provider
      if (input.model.providerID !== "dify") return

      // Merge headers from config (priority: provider.options.headers > model.headers)
      const providerHeaders = input.provider.options?.headers ?? {}
      const modelHeaders = input.model.headers ?? {}
      Object.assign(output.headers, { ...providerHeaders, ...modelHeaders })

      // Use default value if user-id is not configured
      if (!output.headers["user-id"]) {
        const config = await Config.get()
        output.headers["user-id"] = config.username ?? os.userInfo().username ?? "unknown"
      }

      // Get session history messages to find conversationId
      const messages = await Session.messages({
        sessionID: input.sessionID,
        limit: 100,
      })

      // Search backwards for the last assistant message's conversation_id
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i]
        if (msg.info.role !== "assistant") continue

        for (const part of msg.parts) {
          // Only process text type parts (dify's conversationId is stored in text part's metadata)
          if (part.type !== "text" || !part.metadata) continue

          const workflowData = part.metadata["difyWorkflowData"]
          if (!workflowData || typeof workflowData !== "object") continue

          const conversationId = (workflowData as { conversationId?: string | number })
            .conversationId
          if (conversationId) {
            output.headers["chat-id"] = String(conversationId)
            return
          }
        }
      }
    },
  }
}

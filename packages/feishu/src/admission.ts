import { appendFallbackDiagnostic } from "./fallback-log"
import type { createEventLog } from "./event-log"
import { deriveGatewayIdentity } from "./identity"
import type { NormalizedFeishuMessage } from "./feishu-channel"
import type { GatewayStore, NewGatewayTask } from "./store"

export function createAdmission(input: {
  store: GatewayStore
  eventLog: ReturnType<typeof createEventLog>
  enqueue: (taskID: string) => void
  fallbackPath: string
  secrets: readonly string[]
}) {
  return {
    async receive(message: NormalizedFeishuMessage): Promise<"created" | "duplicate"> {
      const identity = await deriveGatewayIdentity({
        chatType: message.chatType,
        chatID: message.chatID,
        senderID: message.senderID,
        messageID: message.messageID,
        ...(message.threadID ? { threadID: message.threadID } : {}),
        ...(message.rootID ? { rootID: message.rootID } : {}),
      })
      const task: NewGatewayTask = {
        id: identity.taskID,
        externalMessageHash: identity.taskID,
        conversationID: identity.conversationID,
        sessionID: identity.sessionID,
        promptMessageID: identity.promptMessageID,
        turnID: identity.turnID,
        traceID: identity.traceID,
        promptText: message.promptText,
        originalText: message.originalText,
        replyTarget: message.replyTarget,
        ...(message.replyRootID ? { replyRootID: message.replyRootID } : {}),
        ...(message.chatType === "group"
          ? {
              replyMentionID: message.senderID,
              ...(message.senderName ? { replyMentionName: message.senderName } : {}),
            }
          : {}),
        state: "received",
      }
      const admit = async () =>
        input.store.admit(
          task,
          await input.eventLog.message(task, {
            eventType: "message_received",
            actor: "user",
            status: "received",
            messageID: task.promptMessageID,
            text: task.originalText,
            content: { normalizedPrompt: task.promptText },
          }),
        )

      return admit().then(
        (result) => {
          if (result.kind === "created") input.enqueue(result.task.id)
          return result.kind
        },
        async (error) => {
          await appendFallbackDiagnostic(
            input.fallbackPath,
            { stage: "receipt", traceID: task.traceID, error },
            input.secrets,
          ).catch(() => undefined)
          throw new Error("Gateway admission failed")
        },
      )
    },
  }
}

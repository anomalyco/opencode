import { Config } from "@/config/config"
import { Session } from "@/session"
import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"
import type { MessageV2 } from "./message-v2"

export type DifyPartMetadata = {
  difyWorkflowData?: { conversationId?: string }
}

function findLastCompactionIndex(msgs: MessageV2.WithParts[]): number | undefined {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const info = msgs[i].info
    if (
      info.role === "assistant" &&
      (info.summary === true || info.mode === "compaction" || info.agent === "compaction")
    ) {
      return i
    }
  }
  return undefined
}

function findConversationId(msgs: MessageV2.WithParts[]): string | undefined {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i]
    if (msg.info.role !== "assistant") continue

    for (const part of msg.parts) {
      if ("metadata" in part && part.metadata) {
        const meta = part.metadata as DifyPartMetadata
        if (meta.difyWorkflowData?.conversationId) {
          return meta.difyWorkflowData.conversationId
        }
      }
    }
  }
  return undefined
}

export type ApplyDifyHeadersOptions = {
  headers: Record<string, string>
  provider: Provider.Info
  model: Provider.Model
  agent: Agent.Info
  sessionID: string
  user: MessageV2.User
}

export async function applyDifyHeaders(opts: ApplyDifyHeadersOptions): Promise<void> {
  const { headers: h, sessionID, user } = opts
  const currentUserId = user.id
  const providerOptions = opts.provider.options?.headers
  const modelHeaders = opts.model.headers ?? {}
  const isCompactionRequest = opts.agent.name === "compaction"

  Object.assign(h, providerOptions ?? {}, modelHeaders)
  if (!h["user-id"]) {
    const config = await Config.get()
    h["user-id"] = config.username ?? "unknown"
  }

  const msgs = await Session.messages({ sessionID, limit: 100 })
  const compactionIndex = findLastCompactionIndex(msgs)
  const conversationId = findConversationId(msgs)

  if (compactionIndex === undefined || compactionIndex !== msgs.length - 3) {
    if (conversationId) h["chat-id"] = conversationId
    return
  }

  const isCurrentSynthetic = (opts.user as any).parts?.some((p: any) => p.type === "text" && p.synthetic) ?? false

  /**
   * Determines if we should reset the chat-id (start a new conversation).
   * - true: Normal request after compaction/summary with a real (non-synthetic) user message.
   *   In this case, do NOT set chat-id to avoid inheriting old conversation.
   * - false: Compaction request OR synthetic user message → preserve existing chat-id.
   */
  const shouldResetChatId = !isCompactionRequest && !isCurrentSynthetic

  if (!shouldResetChatId && conversationId) {
    h["chat-id"] = conversationId
  }
}

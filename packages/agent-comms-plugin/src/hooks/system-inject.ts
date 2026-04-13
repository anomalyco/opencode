import type { Database } from "bun:sqlite"
import { getUnreadSummary, getRegistry, getConversation, getMessages } from "../db"
import { formatSystemInject } from "../helpers"
import type { PluginConfig } from "../config"

type Deps = {
  db: Database
  config?: PluginConfig
}

export function createSystemTransformHook(deps: Deps) {
  return async (input: { sessionID?: string }, output: { system: string[] }) => {
    const sessionID = input.sessionID
    if (!sessionID) return

    const reg = getRegistry(deps.db, sessionID)
    if (reg?.is_subsession) return

    const summary = getUnreadSummary(deps.db, sessionID)
    const unread: Array<{ from_session: string; count: number; agent: string; title: string }> = []
    const conversations: Array<{ id: string; participant_count: number }> = []

    const seenConv = new Set<string>()
    for (const row of summary) {
      const fromReg = getRegistry(deps.db, row.from_session)
      unread.push({
        from_session: row.from_session,
        count: row.count,
        agent: fromReg?.last_agent ?? "unknown",
        title: "",
      })
      if (!seenConv.has(row.conversation_id)) {
        seenConv.add(row.conversation_id)
        const conv = getConversation(deps.db, row.conversation_id)
        if (conv) {
          const participants = JSON.parse(conv.participants) as string[]
          conversations.push({ id: conv.id, participant_count: participants.length })
        }
      }
    }

    const crashedMsgs = getMessages(deps.db, {
      from_session: sessionID,
      type: "message",
      status_exclude: ["delivered", "orphaned"],
    })

    const crashes: Array<{ session_id: string; agent: string; error: string; max_retry: number }> = []
    const seenCrash = new Set<string>()
    for (const msg of crashedMsgs) {
      if (seenCrash.has(msg.to_session)) continue
      seenCrash.add(msg.to_session)
      const targetReg = getRegistry(deps.db, msg.to_session)
      if (targetReg?.status === "crashed" || targetReg?.status === "error") {
        crashes.push({
          session_id: msg.to_session,
          agent: targetReg.last_agent ?? "unknown",
          error: "Session crashed",
          max_retry: deps.config?.max_retry ?? 2,
        })
      }
    }

    const inject = formatSystemInject({ unread, conversations, crashes })
    if (inject) {
      output.system.push(inject)
    }
  }
}

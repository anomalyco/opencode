import { createMemo, createResource, type Accessor } from "solid-js"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { useServer } from "@/runtime/server/current"
import type { SessionModel } from "../model"

const leadingTurnPageDelay = 200

const leadingTurnPageLimit = 3

// The store preserves the transcript array across prepends and tab switches, and replaces it on eviction.
// Remember the original turn so interrupted enrichment can resume without chasing newly prepended turns.
const enrichmentTurns = new WeakMap<SessionMessageInfo[], string>()

export function createTimelineModel(input: { session: Pick<SessionModel, "identity" | "history" | "ownership"> }) {
  const server = useServer()
  const data = server.ctx.data

  const [resource] = createResource(
    () => input.session.identity.sessionID(),
    async (id) => {
      if (!id) return
      const owner = input.session.ownership.capture()
      await Promise.all([data.session.message.sync(id), data.session.pending.sync(id)])
      await enrichLeadingTurn({
        current: owner.current,
        messages: () => data.session.message.list(id),
        more: () => data.session.message.more(id),
        loading: () => data.session.message.loading(id),
        loadMore: () => data.session.message.loadMore(id),
        pause: () => new Promise((resolve) => setTimeout(resolve, leadingTurnPageDelay)),
        maxPages: leadingTurnPageLimit,
      }).catch(() => undefined)

      return id
    },
  )

  const ready = createMemo(() => {
    const id = input.session.identity.sessionID()

    if (!id || (!resource.loading && resource.latest === id)) return true

    // Enrich the partial leading group without withholding the already loaded tail. Undelivered inbox rows
    // load with the inbox, not the transcript, so alone they are no tail; a first prompt shows through its handoff.
    return (
      data.session.message.list(id).some((message) => !data.session.input.has(id, message.id)) ||
      !!server.ctx.handoff.get(id)
    )
  })

  const more = () => {
    const id = input.session.identity.sessionID()

    return id ? data.session.message.more(id) : false
  }

  return {
    history: {
      loadMore: (id: string, signal: AbortSignal) => data.session.message.loadMore(id, { signal }),
      more,
    },
    lastUserMessage: input.session.history.lastUserMessage,
    messages: input.session.history.messages,
    ready,
    resource,
    visibleUserMessages: input.session.history.visibleUserMessages,
  }
}

export async function enrichLeadingTurn(input: {
  current: Accessor<boolean>
  messages: Accessor<SessionMessageInfo[]>
  more: Accessor<boolean>
  loading: Accessor<boolean>
  loadMore: () => Promise<void>
  pause: () => Promise<void>
  maxPages: number
}) {
  const messages = input.messages()

  if (!input.current()) return
  const assistant = enrichmentTurns.get(messages) ?? messages.find((message) => message.type === "assistant")?.id

  if (!assistant) return
  enrichmentTurns.set(messages, assistant)

  const load = async (pages: number): Promise<void> => {
    if (
      !input.current() ||
      pages >= input.maxPages ||
      !leadingTurnNeedsParent(input.messages(), assistant) ||
      !input.more()
    )
      return
    await input.pause()

    if (!input.current() || !leadingTurnNeedsParent(input.messages(), assistant) || !input.more()) return

    if (input.loading()) return load(pages)
    await input.loadMore()

    return load(pages + 1)
  }

  return load(0)
}

function leadingTurnNeedsParent(messages: SessionMessageInfo[], id: string) {
  // Older pages can start mid-turn too; only complete the turn that was visible on entry.
  const assistant = messages.findIndex((message) => message.id === id)

  if (assistant === -1) return false
  const boundary = messages.findIndex((message) => message.type === "user" || message.type === "shell")

  return boundary === -1 || assistant < boundary
}

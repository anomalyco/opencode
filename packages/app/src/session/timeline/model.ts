import type { SessionMessageInfo } from "@opencode-ai/client/promise"
import { createMemo, createResource, type Accessor } from "solid-js"
import { useData } from "@/context/server"
import type { SessionModel } from "../model"

export {
  selectSessionUserMessages as selectUserMessages,
  selectVisibleSessionUserMessages as selectVisibleUserMessages,
} from "../session-domain"

export function createTimelineModel(input: { session: Pick<SessionModel, "identity" | "history"> }) {
  const data = useData()

  const [resource] = createResource(
    () => input.session.identity.sessionID(),
    (id) => (id ? data.session.message.sync(id) : undefined),
  )
  const ready = createMemo(() => !input.session.identity.sessionID() || !resource.loading)
  const more = () => {
    const id = input.session.identity.sessionID()
    return id ? data.session.message.more(id) : false
  }
  const loading = () => {
    const id = input.session.identity.sessionID()
    return id ? data.session.message.loading(id) : false
  }
  const loadOlder = async (options?: { before?: () => void; after?: (done: boolean) => void }) => {
    return loadOlderTimeline({
      sessionID: input.session.identity.sessionID,
      more,
      loading,
      loadMore: data.session.message.loadMore,
      before: options?.before,
      after: options?.after,
    })
  }

  return {
    history: { loadOlder, loading, more },
    lastUserMessage: input.session.history.lastUserMessage,
    messages: input.session.history.messages,
    ready,
    resource,
    userMessages: input.session.history.userMessages,
    visibleUserMessages: input.session.history.visibleUserMessages,
  }
}

export function isTimelineReady(messages: SessionMessageInfo[] | undefined, loading: boolean) {
  return (
    messages !== undefined &&
    (messages.some((message) => message.type === "user" || message.type === "shell") || !loading)
  )
}

export async function loadOlderTimeline(input: {
  sessionID: Accessor<string | undefined>
  more: Accessor<boolean>
  loading: Accessor<boolean>
  loadMore: (sessionID: string) => Promise<void>
  before?: () => void
  after?: (done: boolean) => void
}) {
  const id = input.sessionID()
  if (!id || !input.more() || input.loading()) return

  input.before?.()
  await input.loadMore(id).catch((error) => {
    if (input.sessionID() === id) input.after?.(true)
    throw error
  })
  if (input.sessionID() !== id) return
  input.after?.(true)
}

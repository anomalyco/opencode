import type { Message, UserMessage } from "@opencode-ai/sdk/v2"
import { createMemo, createResource, onCleanup, untrack, type Accessor } from "solid-js"
import { getSessionPrefetch, SESSION_PREFETCH_TTL } from "@/context/global-sync/session-prefetch"
import { useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { useSync } from "@/context/sync"
import { same } from "@/utils/same"

const emptyUserMessages: UserMessage[] = []

export function createTimelineModel(input: {
  sessionID: Accessor<string | undefined>
  revertMessageID: Accessor<string | undefined>
}) {
  const sdk = useSDK()
  const serverSDK = useServerSDK()
  const sync = useSync()
  let refreshFrame: number | undefined
  let refreshTimer: number | undefined

  const [resource] = createResource(
    () => [sdk().directory, input.sessionID()] as const,
    ([directory, id]) => {
      clearRefresh()
      if (!id) return

      const cached = untrack(() => sync().data.message[id] !== undefined)
      const stale = cached
        ? (() => {
            const info = getSessionPrefetch(serverSDK().scope, directory, id)
            if (!info) return true
            return Date.now() - info.at > SESSION_PREFETCH_TTL
          })()
        : false

      refreshFrame = requestAnimationFrame(() => {
        refreshFrame = undefined
        refreshTimer = window.setTimeout(() => {
          refreshTimer = undefined
          if (input.sessionID() !== id) return
          untrack(() => {
            if (stale) void sync().session.sync(id, { force: true })
          })
        }, 0)
      })

      return sync().session.sync(id)
    },
  )
  const messages = createMemo(() => {
    const id = input.sessionID()
    return id ? (sync().data.message[id] ?? []) : []
  })
  const ready = createMemo(() => {
    const id = input.sessionID()
    return !id || sync().data.message[id] !== undefined
  })
  const userMessages = createMemo(() => selectUserMessages(messages()), emptyUserMessages, { equals: same })
  const visibleUserMessages = createMemo(
    () => {
      return selectVisibleUserMessages(userMessages(), input.revertMessageID())
    },
    emptyUserMessages,
    { equals: same },
  )
  const more = createMemo(() => {
    const id = input.sessionID()
    return id ? sync().session.history.more(id) : false
  })
  const loading = createMemo(() => {
    const id = input.sessionID()
    return id ? sync().session.history.loading(id) : false
  })
  const loadOlder = async (options?: { before?: () => void; after?: (done: boolean) => void }) => {
    return loadOlderTimeline({
      sessionID: input.sessionID,
      loaded: () => messages().length,
      visible: () => visibleUserMessages().length,
      more,
      loading,
      loadMore: (sessionID) => sync().session.history.loadMore(sessionID),
      before: options?.before,
      after: options?.after,
    })
  }

  onCleanup(clearRefresh)

  return {
    history: { loadOlder, loading, more },
    lastUserMessage: createMemo(() => visibleUserMessages().at(-1)),
    messages,
    ready,
    resource,
    userMessages,
    visibleUserMessages,
  }

  function clearRefresh() {
    if (refreshFrame !== undefined) cancelAnimationFrame(refreshFrame)
    if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
    refreshFrame = undefined
    refreshTimer = undefined
  }
}

export function selectUserMessages(messages: Message[]) {
  return messages.filter((message): message is UserMessage => message.role === "user")
}

export function selectVisibleUserMessages(messages: UserMessage[], revertMessageID?: string) {
  if (!revertMessageID) return messages
  return messages.filter((message) => message.id < revertMessageID)
}

export async function loadOlderTimeline(input: {
  sessionID: Accessor<string | undefined>
  loaded: Accessor<number>
  visible: Accessor<number>
  more: Accessor<boolean>
  loading: Accessor<boolean>
  loadMore: (sessionID: string) => Promise<void>
  before?: () => void
  after?: (done: boolean) => void
}) {
  const id = input.sessionID()
  if (!id || !input.more() || input.loading()) return

  // A history page may contain only assistant messages or user turns hidden by a revert boundary.
  const beforeVisible = input.visible()
  let loaded = input.loaded()
  input.before?.()
  while (true) {
    await input.loadMore(id).catch((error) => {
      if (input.sessionID() === id) input.after?.(true)
      throw error
    })
    if (input.sessionID() !== id) return

    const nextLoaded = input.loaded()
    const growth = input.visible() - beforeVisible
    const raw = nextLoaded - loaded
    loaded = nextLoaded
    const done = growth > 0 || raw <= 0 || !input.more()
    input.after?.(done)
    if (done) return
  }
}

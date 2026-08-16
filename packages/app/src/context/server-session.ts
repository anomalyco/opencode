import { Binary } from "@opencode-ai/core/util/binary"
import { Worktree } from "@opencode-ai/schema/worktree"
import { retry } from "@opencode-ai/core/util/retry"
import type {
  FormInfo,
  OpenCodeEvent,
  SessionApi,
  SessionInfo,
  SessionInboxInfo,
  SessionMessageInfo,
} from "@opencode-ai/client/promise"
import type { Message, Part, Todo } from "@/types"
import type { FileDiffInfo, PermissionRequest, SessionStatus } from "@opencode-ai/client/promise"
import { batch } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { rootSession } from "@/utils/session-route"
import { compareMessages, messageKey, normalizeSessionMessages } from "@/utils/session-message"
import { dropSessionCaches, pickSessionCacheEvictions, SESSION_CACHE_LIMIT } from "./global-sync/session-cache"
import { createV2SessionReducer, type V2SessionReduction } from "./server-session-v2-reducer"
import type { ServerApi } from "@/utils/server"
import {
  createCommentMetadata,
  formatCommentNote,
  parseCommentNote,
  readCommentMetadata,
  type PromptComment,
} from "@/utils/comment-note"

type MessageApi = ServerApi["message"]

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const SKIP_PARTS = new Set(["patch", "step-start", "step-finish"])
const messagePageSize = 200
const sessionInfoLimit = 2_048
const emptyIDs: ReadonlySet<string> = new Set()

function needsOlderTurnRoot(source: readonly SessionMessageInfo[]) {
  const boundary = source.find(
    (message) =>
      message.type === "user" ||
      message.type === "shell" ||
      message.type === "assistant" ||
      (message.type === "synthetic" && message.description?.trim()),
  )
  return boundary?.type === "assistant"
}

type MessagePage = {
  session: Message[]
  part: { id: string; part: Part[] }[]
  source?: SessionMessageInfo[]
  sourceMode?: "latest" | "older"
  projectSource?: boolean
  cursor?: string
  complete: boolean
}

export type PromptEcho = {
  sessionID: string
  messageID: string
  text: string
  displayText: string
  agent: string
  model: { providerID: string; modelID: string; variant?: string }
  files?: { uri: string; mime: string; name?: string; mention?: { start: number; end: number; text: string } }[]
  agents?: { name: string; mention?: { start: number; end: number; text: string } }[]
  comments: PromptComment[]
}

// Most markers describe the current HTTP attempt; deltaParts persists non-durable stream state across retries.
type MessageLoadState = {
  touchedMessages: Set<string>
  removedMessages: Set<string>
  retainedMessages: Set<string>
  touchedParts: Map<string, Set<string>>
  deltaParts: Map<string, Set<string>>
  carriedDeltaParts: Map<string, Set<string>>
  removedParts: Map<string, Set<string>>
  orphanParents: Set<string>
  clearedMessageParts: Set<string>
  touchedSource: Set<string>
}

type MessageLoadBaseline = Pick<
  MessageLoadState,
  "touchedMessages" | "retainedMessages" | "touchedParts" | "clearedMessageParts"
>

function runInflight(map: Map<string, Promise<void>>, key: string, task: () => Promise<void>) {
  const pending = map.get(key)
  if (pending) return pending
  const promise = task().finally(() => {
    if (map.get(key) === promise) map.delete(key)
  })
  map.set(key, promise)
  return promise
}

function merge<T extends { id: string }>(a: readonly T[], b: readonly T[]) {
  const items = new Map(a.map((item) => [item.id, item] as const))
  for (const item of b) items.set(item.id, item)
  return [...items.values()].sort((x, y) => cmp(x.id, y.id))
}

function reconcileFetched<T extends { id: string }>(
  fetched: T[],
  current: readonly T[],
  options: {
    touched?: ReadonlySet<string>
    retained?: ReadonlySet<string>
    removed?: ReadonlySet<string>
    preserveUnfetched?: boolean | ((item: T) => boolean)
    compare?: (a: T, b: T) => number
  } = {},
) {
  const result = new Map(fetched.map((item) => [item.id, item]))
  const live = new Map(current.map((item) => [item.id, item]))
  if (options.preserveUnfetched) {
    for (const item of current) {
      if (!result.has(item.id) && (options.preserveUnfetched === true || options.preserveUnfetched(item)))
        result.set(item.id, item)
    }
  }
  for (const id of options.retained ?? emptyIDs) {
    if (result.has(id)) continue
    const item = live.get(id)
    if (item) result.set(id, item)
  }
  // Events observed while the request is pending are the freshest client state for those identities.
  for (const id of options.touched ?? emptyIDs) {
    const item = live.get(id)
    if (item) result.set(id, item)
    if (!item) result.delete(id)
  }
  for (const id of options.removed ?? emptyIDs) result.delete(id)
  const items = [...result.values()]
  return options.compare ? items.sort(options.compare) : items
}

type ServerSessionOptions = { retry?: typeof retry }
type ServerSessionApis = { session: SessionApi; message: MessageApi }

export function createServerSession(
  api: SessionApi | ServerSessionApis,
  messageApiOrOptions?: MessageApi | ServerSessionOptions,
  currentOptions?: ServerSessionOptions,
) {
  const bundled = "session" in api
  const sessionApi = bundled ? api.session : api
  const messageApi = bundled ? api.message : (messageApiOrOptions as MessageApi)
  const options = bundled ? (messageApiOrOptions as ServerSessionOptions | undefined) : currentOptions
  const [data, setData] = createStore({
    info: {} as Record<string, SessionInfo | undefined>,
    session_status: {} as Record<string, SessionStatus>,
    session_diff: {} as Record<string, FileDiffInfo[]>,
    todo: {} as Record<string, Todo[]>,
    permission: {} as Record<string, PermissionRequest[]>,
    form: {} as Record<string, FormInfo[]>,
    pending: {} as Record<string, SessionInboxInfo[]>,
    input: {} as Record<string, string[]>,
    message: {} as Record<string, Message[]>,
    session_message: {} as Record<string, SessionMessageInfo[]>,
    // Part order is semantic and follows SessionMessageAssistant.content; IDs identify parts only.
    part: {} as Record<string, Part[]>,
    part_text_accum_delta: {} as Record<string, string>,
    session_working(id: string) {
      return (this.session_status[id]?.type ?? "idle") !== "idle"
    },
  })
  const requests = new Map<string, Promise<SessionInfo>>()
  const inflight = new Map<string, Promise<void>>()
  const inflightTodo = new Map<string, Promise<void>>()
  const v2 = createV2SessionReducer()
  const pendingRevision = new Map<string, number>()
  const formRevision = new Map<string, number>()
  const messageHydrationRevision = new Map<string, number>()
  const invalidated = new Set<string>()
  let invalidationRevision = 0
  const messageLoads = new Map<string, MessageLoadState>()
  const pendingParts = new Map<string, Map<string, Set<string>>>()
  const orphanParts = new Map<string, Set<string>>()
  const removedMessages = new Map<string, Set<string>>()
  const echoes = new Map<string, Map<string, "sending" | "admitted">>()
  const messageSnapshots = new Map<string, Set<string>>()
  const settledInputs = new Map<string, Set<string>>()
  const deltaBases = new Map<string, { base: string; sessionID: string }>()
  const markEcho = (sessionID: string, messageID: string) => {
    const messages = echoes.get(sessionID) ?? new Map<string, "sending" | "admitted">()
    messages.set(messageID, "sending")
    echoes.set(sessionID, messages)
  }
  const confirmEcho = (sessionID: string, messageID: string) => {
    const messages = echoes.get(sessionID)
    if (!messages?.has(messageID)) return false
    messages.set(messageID, "admitted")
    return true
  }
  const releaseEcho = (sessionID: string, messageID: string) => {
    const messages = echoes.get(sessionID)
    const state = messages?.get(messageID)
    if (!messages || !state) return
    messages.delete(messageID)
    if (messages.size === 0) echoes.delete(sessionID)
    return state
  }
  const present = (messageID: string, parts: Part[]) => {
    const local = data.part[messageID] ?? []
    const comments = local.filter(
      (part) =>
        part.type === "text" &&
        part.synthetic &&
        (readCommentMetadata(part.metadata) !== undefined || parseCommentNote(part.text) !== undefined),
    )
    if (!comments.length) return parts
    const text = local.find((part) => part.type === "text" && !part.synthetic)
    const projected = parts.flatMap((part) => {
      if (part.id !== `${messageID}:text:0` || part.type !== "text") return [part]
      return text?.type === "text" && text.text ? [{ ...part, text: text.text }] : []
    })
    return [...projected, ...comments]
  }
  const deleteMessageParts = (
    cache: { part: Record<string, Part[] | undefined>; part_text_accum_delta: Record<string, string | undefined> },
    messageID: string,
  ) => {
    for (const part of cache.part[messageID] ?? []) {
      delete cache.part_text_accum_delta[part.id]
      deltaBases.delete(part.id)
    }
    delete cache.part[messageID]
  }
  const seen = new Set<string>()
  const infoSeen = new Set<string>()
  const pinned = new Map<string, number>()
  const generations = new Map<string, object>()
  const generation = (sessionID: string) => {
    const current = generations.get(sessionID)
    if (current) return current
    const created = {}
    generations.set(sessionID, created)
    return created
  }
  const [meta, setMeta] = createStore({
    cursor: {} as Record<string, string | undefined>,
    complete: {} as Record<string, boolean | undefined>,
    loading: {} as Record<string, boolean | undefined>,
    at: {} as Record<string, number | undefined>,
  })

  const remember = (session: SessionInfo) => {
    setData("info", session.id, reconcile(session))
    infoSeen.delete(session.id)
    infoSeen.add(session.id)
    if (infoSeen.size > sessionInfoLimit) {
      const preserve = new Set([
        ...pinned.keys(),
        ...requests.keys(),
        ...inflight.keys(),
        ...inflightTodo.keys(),
        ...messageLoads.keys(),
        ...echoes.keys(),
        ...Object.entries(data.permission)
          .filter(([, items]) => items.length > 0)
          .map(([sessionID]) => sessionID),
        ...Object.entries(data.form)
          .filter(([, items]) => items.length > 0)
          .map(([sessionID]) => sessionID),
        ...Object.entries(data.session_status)
          .filter(([, status]) => status.type !== "idle")
          .map(([sessionID]) => sessionID),
      ])
      for (const sessionID of preserve) {
        let current = data.info[sessionID]
        while (current) {
          preserve.add(current.id)
          current = current.parentID ? data.info[current.parentID] : undefined
        }
      }
      const stale: string[] = []
      for (const sessionID of infoSeen) {
        if (infoSeen.size - stale.length <= sessionInfoLimit) break
        if (!preserve.has(sessionID)) stale.push(sessionID)
      }
      stale.forEach((sessionID) => infoSeen.delete(sessionID))
      stale.forEach((sessionID) => generations.delete(sessionID))
      setData(
        "info",
        produce((draft) => stale.forEach((sessionID) => delete draft[sessionID])),
      )
    }
    return session
  }

  const resolve = (sessionID: string, options?: { force?: boolean }) => {
    const cached = data.info[sessionID]
    if (cached && !options?.force) return Promise.resolve(cached)
    const pending = requests.get(sessionID)
    if (pending) return pending
    const active = generation(sessionID)
    const request = sessionApi.get({ sessionID })
    const resolved = request.then((result) => {
      if (generations.get(sessionID) !== active) return result
      return remember(result)
    })
    requests.set(sessionID, resolved)
    const cleanup = () => {
      if (requests.get(sessionID) === resolved) requests.delete(sessionID)
      if (
        generations.get(sessionID) === active &&
        !data.info[sessionID] &&
        !requests.has(sessionID) &&
        !messageLoads.has(sessionID) &&
        !inflight.has(sessionID) &&
        !inflightTodo.has(sessionID)
      )
        generations.delete(sessionID)
    }
    void resolved.then(cleanup, cleanup)
    return resolved
  }

  const peekLineage = (sessionID: string) => {
    const session = data.info[sessionID]
    if (!session) return
    const seen = new Set([session.id])
    let root = session
    while (root.parentID) {
      if (seen.has(root.parentID)) throw new Error(`Session parent cycle: ${root.parentID}`)
      seen.add(root.parentID)
      const parent = data.info[root.parentID]
      if (!parent) return
      root = parent
    }
    return { session, root }
  }

  const trackPartChange = (sessionID: string, messageID: string, partID: string) => {
    const load = messageLoads.get(sessionID)
    if (!load) return
    // A part event keeps an existing parent when the fetched page omits it without overriding fetched metadata.
    const messages = data.message[sessionID]
    if (messages?.some((message) => message.id === messageID)) load.retainedMessages.add(messageID)
    const parts = load.touchedParts.get(messageID)
    if (parts) {
      parts.add(partID)
      return
    }
    load.touchedParts.set(messageID, new Set([partID]))
  }

  const resetMessageLoad = (sessionID: string, load: MessageLoadState, baseline?: MessageLoadBaseline) => {
    load.touchedMessages.clear()
    load.retainedMessages.clear()
    load.touchedParts.clear()
    load.carriedDeltaParts.clear()
    load.clearedMessageParts.clear()
    for (const messageID of load.removedMessages) {
      load.touchedMessages.add(messageID)
      load.clearedMessageParts.add(messageID)
    }
    for (const [messageID, parts] of load.deltaParts) {
      load.touchedParts.set(messageID, new Set(parts))
      load.carriedDeltaParts.set(messageID, new Set(parts))
      const messages = data.message[sessionID]
      if (messages?.some((message) => message.id === messageID)) load.retainedMessages.add(messageID)
    }
    for (const [messageID, parts] of load.removedParts) {
      const touched = load.touchedParts.get(messageID) ?? new Set<string>()
      parts.forEach((partID) => touched.add(partID))
      load.touchedParts.set(messageID, touched)
      const messages = data.message[sessionID]
      if (messages?.some((message) => message.id === messageID)) load.retainedMessages.add(messageID)
    }
    baseline?.touchedMessages.forEach((messageID) => load.touchedMessages.add(messageID))
    baseline?.retainedMessages.forEach((messageID) => load.retainedMessages.add(messageID))
    baseline?.clearedMessageParts.forEach((messageID) => load.clearedMessageParts.add(messageID))
    baseline?.touchedParts.forEach((parts, messageID) => {
      const touched = load.touchedParts.get(messageID) ?? new Set<string>()
      parts.forEach((partID) => touched.add(partID))
      load.touchedParts.set(messageID, touched)
    })
  }

  const messageLoadBaseline = (load: MessageLoadState, exclude: string): MessageLoadBaseline => ({
    touchedMessages: new Set([...load.touchedMessages].filter((messageID) => messageID !== exclude)),
    retainedMessages: new Set([...load.retainedMessages].filter((messageID) => messageID !== exclude)),
    touchedParts: new Map(
      [...load.touchedParts]
        .filter(([messageID]) => messageID !== exclude)
        .map(([messageID, parts]) => [messageID, new Set(parts)]),
    ),
    clearedMessageParts: new Set([...load.clearedMessageParts].filter((messageID) => messageID !== exclude)),
  })

  const evict = (sessionIDs: string[]) => {
    if (sessionIDs.length === 0) return
    const evicted = new Set(sessionIDs)
    for (const [partID, item] of deltaBases) {
      if (evicted.has(item.sessionID)) deltaBases.delete(partID)
    }
    sessionIDs.forEach((sessionID) => {
      messageHydrationRevision.set(sessionID, (messageHydrationRevision.get(sessionID) ?? 0) + 1)
      generations.delete(sessionID)
      echoes.delete(sessionID)
      messageSnapshots.delete(sessionID)
      settledInputs.delete(sessionID)
      requests.delete(sessionID)
      inflight.delete(sessionID)
      inflightTodo.delete(sessionID)
      messageLoads.delete(sessionID)
      v2.clear(sessionID)
      pendingParts.delete(sessionID)
      orphanParts.delete(sessionID)
      removedMessages.delete(sessionID)
    })
    setData(
      produce((draft) => {
        dropSessionCaches(draft, sessionIDs)
      }),
    )
    setMeta(
      produce((draft) => {
        for (const sessionID of sessionIDs) {
          delete draft.cursor[sessionID]
          delete draft.complete[sessionID]
          delete draft.loading[sessionID]
          delete draft.at[sessionID]
        }
      }),
    )
  }

  const protectedSessions = () =>
    new Set([
      ...pinned.keys(),
      ...requests.keys(),
      ...inflight.keys(),
      ...inflightTodo.keys(),
      ...messageLoads.keys(),
      ...echoes.keys(),
      ...Object.entries(data.permission)
        .filter(([, items]) => items.length > 0)
        .map(([sessionID]) => sessionID),
      ...Object.entries(data.form)
        .filter(([, items]) => items.length > 0)
        .map(([sessionID]) => sessionID),
      ...Object.entries(data.session_status)
        .filter(([, status]) => status.type !== "idle")
        .map(([sessionID]) => sessionID),
    ])

  const touch = (sessionID: string) =>
    evict(
      pickSessionCacheEvictions({ seen, keep: sessionID, limit: SESSION_CACHE_LIMIT, preserve: protectedSessions() }),
    )

  const fetchMessages = async (sessionID: string, before?: string, onAttempt?: () => void) => {
    const request = (cursor?: string) =>
      (options?.retry ?? retry)(() => {
        onAttempt?.()
        return messageApi.list(
          cursor ? { sessionID, limit: messagePageSize, cursor } : { sessionID, limit: messagePageSize, order: "desc" },
        )
      })
    const first = await request(before)
    const pages = [first]
    while (pages.at(-1)?.cursor.next && needsOlderTurnRoot(pages.flatMap((page) => page.data).toReversed())) {
      const response = await request(pages.at(-1)!.cursor.next ?? undefined)
      pages.push(response)
      if (!response.data.length) break
    }
    const response = pages.at(-1)!
    const source = pages.flatMap((page) => page.data).toReversed()
    const normalized = normalizeSessionMessages(sessionID, source)
    return {
      session: normalized.messages.sort(compareMessages),
      part: [...normalized.parts.entries()].map(([id, part]) => ({ id, part })).sort((a, b) => cmp(a.id, b.id)),
      source,
      sourceMode: before ? ("older" as const) : ("latest" as const),
      projectSource: true,
      cursor: response.cursor.next ?? undefined,
      complete: !response.cursor.next,
    }
  }

  const fetchMessage = async (sessionID: string, messageID: string, onAttempt?: () => void) => {
    const response = await (options?.retry ?? retry)(() => {
      onAttempt?.()
      return sessionApi.message({ sessionID, messageID })
    })
    const normalized = normalizeSessionMessages(sessionID, [response])
    const message = normalized.messages[0]
    if (!message) throw new Error(`Message not found: ${messageID}`)
    return { message, parts: normalized.parts.get(messageID) ?? [] }
  }

  const replaceMessages = (sessionID: string, messages: Message[]) => {
    const messageIDs = new Set(messages.map((message) => message.id))
    const dropped = (data.message[sessionID] ?? []).filter((message) => !messageIDs.has(message.id))
    setData("message", sessionID, reconcile(messages, { key: "id" }))
    setData(
      produce((draft) => {
        for (const message of dropped) deleteMessageParts(draft, message.id)
      }),
    )
    return messageIDs
  }

  const replaceParts = (
    sessionID: string,
    items: MessagePage["part"],
    messageIDs: Set<string>,
    load?: MessageLoadState,
  ) => {
    for (const item of items) {
      if (!messageIDs.has(item.id)) continue
      const fetched = present(
        item.id,
        load?.clearedMessageParts.has(item.id) ? [] : item.part.filter((part) => !SKIP_PARTS.has(part.type)),
      )
      const fetchedIDs = new Set(fetched.map((part) => part.id))
      const pending = pendingParts.get(sessionID)?.get(item.id)
      const touched = new Set([...(load?.touchedParts.get(item.id) ?? []), ...(pending ?? [])])
      for (const part of fetched) {
        const accumulated = data.part_text_accum_delta[part.id]
        const base = deltaBases.get(part.id)?.base
        const preserveDelta =
          base !== undefined &&
          accumulated !== undefined &&
          "text" in part &&
          typeof part.text === "string" &&
          part.text.startsWith(base) &&
          accumulated.startsWith(part.text) &&
          accumulated !== part.text
        if (preserveDelta) touched.add(part.id)
        if (load?.carriedDeltaParts.get(item.id)?.has(part.id) && !preserveDelta) touched.delete(part.id)
      }
      for (const partID of load?.carriedDeltaParts.get(item.id) ?? []) {
        if (!fetchedIDs.has(partID)) touched.delete(partID)
      }
      const parts = reconcileFetched(fetched, data.part[item.id] ?? [], { touched })
      if (!parts.length) {
        orphanParts.get(sessionID)?.delete(item.id)
        setData(produce((draft) => deleteMessageParts(draft, item.id)))
        continue
      }
      const partIDs = new Set(parts.map((part) => part.id))
      setData(
        "part_text_accum_delta",
        produce((draft) => {
          for (const part of data.part[item.id] ?? []) {
            if (!partIDs.has(part.id) || !touched.has(part.id)) {
              delete draft[part.id]
              deltaBases.delete(part.id)
            }
          }
        }),
      )
      setData("part", item.id, reconcile(parts, { key: "id" }))
      orphanParts.get(sessionID)?.delete(item.id)
    }
  }

  const applyMessagePage = (
    sessionID: string,
    page: MessagePage,
    load: MessageLoadState | undefined,
    preserveUnfetched: boolean | ((message: Message) => boolean),
    cleanupOrphans: boolean,
  ) => {
    if (page.sourceMode === "latest")
      messageSnapshots.set(sessionID, new Set((page.source ?? []).map((message) => message.id)))
    page.source?.forEach((message) => releaseEcho(sessionID, message.id))
    const source = page.source
      ? (() => {
          const incoming = new Map(page.source.map((message) => [message.id, message]))
          const existing = data.session_message[sessionID] ?? []
          const boundary = Math.min(...page.source.map((message) => message.time.created))
          const inbox = new Set(data.input[sessionID] ?? [])
          const current = existing.filter(
            (message) =>
              !incoming.has(message.id) &&
              !inbox.has(message.id) &&
              (page.sourceMode === "older" ||
                load?.touchedSource.has(message.id) ||
                (!page.complete && message.time.created < boundary)),
          )
          // message.list never returns admitted-but-undelivered inbox entries; keep them after the
          // fetched history until a delivered or cancelled event resolves them.
          const admitted = existing.filter((message) => !incoming.has(message.id) && inbox.has(message.id))
          const combined =
            page.sourceMode === "older"
              ? [...page.source, ...current, ...admitted]
              : [...current, ...page.source, ...admitted]
          const live = new Map(existing.map((message) => [message.id, message]))
          return combined.map((message) =>
            load?.touchedSource.has(message.id) ? (live.get(message.id) ?? message) : message,
          )
        })()
      : undefined
    const merged =
      page.projectSource && source
        ? (() => {
            const normalized = normalizeSessionMessages(sessionID, source)
            return {
              ...page,
              session: normalized.messages.sort(compareMessages),
              part: [...normalized.parts.entries()].map(([id, part]) => ({ id, part })).sort((a, b) => cmp(a.id, b.id)),
            }
          })()
        : page
    const touchedMessages = new Set([...(load?.touchedMessages ?? []), ...(removedMessages.get(sessionID) ?? [])])
    const messages = reconcileFetched(merged.session, data.message[sessionID] ?? [], {
      touched: touchedMessages,
      retained: load?.retainedMessages,
      removed: load?.removedMessages,
      preserveUnfetched: (message) =>
        echoes.get(sessionID)?.has(message.id) === true ||
        preserveUnfetched === true ||
        (typeof preserveUnfetched === "function" && preserveUnfetched(message)),
      compare: compareMessages,
    })
    batch(() => {
      if (source) setData("session_message", sessionID, reconcile(source))
      const messageIDs = replaceMessages(sessionID, messages)
      replaceParts(sessionID, merged.part, messageIDs, load)
      const orphans = orphanParts.get(sessionID)
      if (cleanupOrphans && page.complete && orphans) {
        for (const messageID of orphans) {
          if (!messageIDs.has(messageID)) setData(produce((draft) => deleteMessageParts(draft, messageID)))
        }
        orphanParts.delete(sessionID)
      }
      setMeta("cursor", sessionID, merged.cursor)
      setMeta("complete", sessionID, merged.complete)
      setMeta("at", sessionID, Date.now())
    })
  }

  const loadMessages = async (sessionID: string, before?: string, mode?: "replace" | "prepend") => {
    if (meta.loading[sessionID]) return
    const active = generation(sessionID)
    const load: MessageLoadState = {
      touchedMessages: new Set(),
      removedMessages: new Set(),
      retainedMessages: new Set(),
      touchedParts: new Map(),
      deltaParts: new Map(),
      carriedDeltaParts: new Map(),
      removedParts: new Map(),
      orphanParents: new Set(),
      clearedMessageParts: new Set(),
      touchedSource: new Set(),
    }
    messageLoads.set(sessionID, load)
    setMeta("loading", sessionID, true)
    let applied = false
    try {
      const page = await fetchMessages(sessionID, before, () => resetMessageLoad(sessionID, load))
      const first = page.session.reduce<Message | undefined>(
        (oldest, message) => (!oldest || compareMessages(message, oldest) < 0 ? message : oldest),
        undefined,
      )
      if (generations.get(sessionID) !== active) return

      const parents = [] as Awaited<ReturnType<typeof fetchMessage>>[]
      if (mode !== "prepend") {
        const users = new Set([
          ...page.session.filter((message) => message.role === "user").map((message) => message.id),
          ...(data.message[sessionID] ?? [])
            .filter((message) => message.role === "user" && load.touchedMessages.has(message.id))
            .map((message) => message.id),
        ])
        const parentIDs = [
          ...new Set(
            page.session.flatMap((message) =>
              message.role === "assistant" && !users.has(message.parentID) ? [message.parentID] : [],
            ),
          ),
        ]
        for (const parentID of parentIDs) {
          if (generations.get(sessionID) !== active) break
          const parent = await fetchMessage(sessionID, parentID, () =>
            resetMessageLoad(sessionID, load, messageLoadBaseline(load, parentID)),
          ).catch((error) => {
            const cause = error instanceof Error && typeof error.cause === "object" ? error.cause : undefined
            if (cause && "status" in cause && cause.status === 404) {
              load.removedMessages.add(parentID)
              return
            }
            throw error
          })
          if (!parent) continue
          if (parent.message.role !== "user") throw new Error(`Assistant parent is not a user message: ${parentID}`)
          parents.push(parent)
        }
      }
      if (generations.get(sessionID) !== active) return
      const result =
        mode === "prepend"
          ? page
          : {
              ...page,
              session: merge(
                page.session,
                parents.map((parent) => parent.message),
              ).sort(compareMessages),
              part: merge(
                page.part,
                parents.map((parent) => ({ id: parent.message.id, part: parent.parts })),
              ),
            }
      const preserveUnfetched =
        mode === "prepend" ||
        (!result.complete && (!first || ((message: Message) => compareMessages(message, first) < 0)))
      applyMessagePage(
        sessionID,
        result,
        messageLoads.get(sessionID) === load ? load : undefined,
        preserveUnfetched,
        mode !== "prepend",
      )
      applied = true
    } finally {
      if (!applied && generations.get(sessionID) === active && messageLoads.get(sessionID) === load) {
        for (const messageID of load.orphanParents) {
          if (!orphanParts.get(sessionID)?.has(messageID)) continue
          setData(produce((draft) => deleteMessageParts(draft, messageID)))
          orphanParts.get(sessionID)?.delete(messageID)
        }
        if (orphanParts.get(sessionID)?.size === 0) orphanParts.delete(sessionID)
      }
      if (messageLoads.get(sessionID) === load) messageLoads.delete(sessionID)
      if (generations.get(sessionID) === active) setMeta("loading", sessionID, false)
    }
  }

  const sync = (sessionID: string, options?: { force?: boolean }) => {
    touch(sessionID)
    return runInflight(inflight, sessionID, async () => {
      const cached = data.message[sessionID] !== undefined && meta.complete[sessionID] !== undefined
      const invalid = invalidated.has(sessionID)
      const revision = invalidationRevision
      if (cached && data.info[sessionID] && !invalid && !options?.force) return
      await Promise.all([
        resolve(sessionID, invalid ? { ...options, force: true } : options),
        cached && !invalid && !options?.force ? Promise.resolve() : loadMessages(sessionID),
      ])
      if (invalid && invalidationRevision === revision) invalidated.delete(sessionID)
    })
  }

  const prefetch = async (sessionID: string, messageCount: number) => {
    touch(sessionID)
    await inflight.get(sessionID)
    if (
      Date.now() - (meta.at[sessionID] ?? 0) <= 15_000 &&
      (meta.complete[sessionID] || (data.message[sessionID]?.length ?? 0) >= messageCount)
    )
      return
    await runInflight(inflight, sessionID, () => loadMessages(sessionID))
  }

  const eventSessionID = (event: { type: string; properties?: unknown }) => {
    const properties = event.properties
    if (!properties || typeof properties !== "object") return
    if ("sessionID" in properties && typeof properties.sessionID === "string") return properties.sessionID
    if (
      "info" in properties &&
      properties.info &&
      typeof properties.info === "object" &&
      "sessionID" in properties.info &&
      typeof properties.info.sessionID === "string"
    )
      return properties.info.sessionID
    if (
      "part" in properties &&
      properties.part &&
      typeof properties.part === "object" &&
      "sessionID" in properties.part &&
      typeof properties.part.sessionID === "string"
    )
      return properties.part.sessionID
  }

  const projectV2 = (reduction: V2SessionReduction) => {
    reduction.touched.forEach((messageID) => messageLoads.get(reduction.sessionID)?.touchedSource.add(messageID))
    setData("session_message", reduction.sessionID, reconcile(reduction.messages))
    if (reduction.touched.length === 0 && !reduction.removed?.length) return

    const touched = new Set(reduction.touched)
    let parentID: string | undefined
    for (const message of reduction.messages) {
      if (message.type === "user" || (message.type === "synthetic" && message.description?.trim()))
        parentID = message.id
      if (message.type === "shell") {
        if (touched.has(message.id)) touched.add(`${message.id}:assistant`)
        parentID = undefined
      }
      if (message.type === "assistant" && touched.has(message.id) && parentID) touched.add(parentID)
      if (message.type === "compaction" && touched.has(message.id) && parentID) touched.add(parentID)
    }

    const normalized = normalizeSessionMessages(reduction.sessionID, reduction.messages)
    batch(() => {
      for (const messageID of reduction.removed ?? []) {
        apply({ type: "message.removed", properties: { sessionID: reduction.sessionID, messageID } })
      }
      for (const message of normalized.messages) {
        if (!touched.has(message.id)) continue
        apply({ type: "message.updated", properties: { sessionID: reduction.sessionID, info: message } })
      }
      for (const messageID of touched) {
        const next = present(messageID, normalized.parts.get(messageID) ?? [])
        const nextIDs = new Set(next.map((part) => part.id))
        for (const part of next) {
          apply({ type: "message.part.updated", properties: { sessionID: reduction.sessionID, part } })
        }
        for (const part of [...(data.part[messageID] ?? [])]) {
          if (nextIDs.has(part.id)) continue
          apply({
            type: "message.part.removed",
            properties: { sessionID: reduction.sessionID, messageID, partID: part.id },
          })
        }
      }
    })
  }

  const hydrateV2Message = (sessionID: string, messageID: string) => {
    if (!sessionApi) return
    const active = generation(sessionID)
    const revision = messageHydrationRevision.get(sessionID) ?? 0
    void sessionApi
      .message({ sessionID, messageID })
      .then((message) => {
        if (generations.get(sessionID) !== active) return
        if ((messageHydrationRevision.get(sessionID) ?? 0) !== revision) return
        if (removedMessages.get(sessionID)?.has(message.id)) return
        const current = data.session_message[sessionID] ?? []
        const messages = [...current.filter((item) => item.id !== message.id), message].sort(compareMessages)
        projectV2({ sessionID, messages, touched: [message.id] })
      })
      .catch(() => {})
  }

  const removeEcho = (sessionID: string, messageID: string) => {
    if (!releaseEcho(sessionID, messageID)) return false
    pendingRevision.set(sessionID, (pendingRevision.get(sessionID) ?? 0) + 1)
    const load = messageLoads.get(sessionID)
    load?.touchedMessages.add(messageID)
    load?.removedMessages.add(messageID)
    load?.clearedMessageParts.add(messageID)
    batch(() => {
      setData("pending", sessionID, (items) => items?.filter((item) => item.id !== messageID))
      setData("input", sessionID, (items) => items?.filter((id) => id !== messageID))
      setData("message", sessionID, (messages) => messages?.filter((message) => message.id !== messageID))
      setData(produce((draft) => deleteMessageParts(draft, messageID)))
    })
    return true
  }

  const confirmInbox = (item: SessionInboxInfo) => {
    if (!confirmEcho(item.sessionID, item.id)) return false
    v2.confirm(item)
    pendingRevision.set(item.sessionID, (pendingRevision.get(item.sessionID) ?? 0) + 1)
    const current = data.pending[item.sessionID] ?? []
    const index = current.findIndex((entry) => entry.id === item.id)
    if (index < 0) setData("pending", item.sessionID, [...current, item])
    if (index >= 0) setData("pending", item.sessionID, index, reconcile(item))
    return true
  }

  const reconcileInbox = (sessionID: string) => {
    const pending = new Set((data.pending[sessionID] ?? []).map((item) => item.id))
    const fetched = messageSnapshots.get(sessionID) ?? new Set<string>()
    const removed = [...(settledInputs.get(sessionID) ?? [])].filter(
      (messageID) => !pending.has(messageID) && !fetched.has(messageID),
    )
    settledInputs.delete(sessionID)
    if (removed.length) {
      const ids = new Set(removed)
      const source = data.session_message[sessionID] ?? []
      projectV2({
        sessionID,
        messages: source.filter((message) => !ids.has(message.id)),
        touched: [],
        removed: source.filter((message) => ids.has(message.id)).map((message) => message.id),
      })
    }

    const messages = echoes.get(sessionID)
    if (!messages) return
    const projected = new Set((data.session_message[sessionID] ?? []).map((message) => message.id))
    for (const [messageID, state] of messages) {
      if (projected.has(messageID)) {
        releaseEcho(sessionID, messageID)
        continue
      }
      if (pending.has(messageID)) {
        confirmEcho(sessionID, messageID)
        continue
      }
      if (state === "admitted") removeEcho(sessionID, messageID)
    }
  }

  const applyV2 = (event: OpenCodeEvent) => {
    if (event.type === "form.created") {
      formRevision.set(event.data.form.sessionID, (formRevision.get(event.data.form.sessionID) ?? 0) + 1)
      const current = data.form[event.data.form.sessionID] ?? []
      if (!current.some((form) => form.id === event.data.form.id))
        setData("form", event.data.form.sessionID, [...current, event.data.form])
      return
    }
    if (event.type === "form.replied" || event.type === "form.cancelled") {
      formRevision.set(event.data.sessionID, (formRevision.get(event.data.sessionID) ?? 0) + 1)
      setData("form", event.data.sessionID, (forms) => forms?.filter((form) => form.id !== event.data.id))
      return
    }
    if (event.type === "worktree.resolved") {
      Object.values(data.info).forEach((info) => {
        if (!info) return
        const adopted = Worktree.adopt({ projectID: info.projectID, directory: info.location.directory }, event.data)
        if (adopted) remember({ ...info, ...adopted })
      })
      return
    }
    if (!("data" in event) || !("sessionID" in event.data) || typeof event.data.sessionID !== "string") return
    const sessionID = event.data.sessionID
    if (event.type === "session.inbox.enqueued" || event.type === "session.inbox.delivered")
      releaseEcho(sessionID, event.data.inboxID)
    if (event.type === "session.inbox.cancelled") removeEcho(sessionID, event.data.inboxID)
    if (
      event.type === "session.inbox.enqueued" ||
      event.type === "session.inbox.delivery.changed" ||
      event.type === "session.inbox.cancelled" ||
      event.type === "session.inbox.delivered" ||
      event.type === "session.compaction.started" ||
      event.type === "session.compaction.failed"
    )
      pendingRevision.set(sessionID, (pendingRevision.get(sessionID) ?? 0) + 1)
    if (event.type === "session.inbox.enqueued") {
      const current = data.pending[sessionID] ?? []
      const item = { id: event.data.inboxID, sessionID, timeCreated: event.created, ...event.data.item }
      const index = current.findIndex((entry) => entry.id === event.data.inboxID)
      if (index < 0) setData("pending", sessionID, [...current, item])
      if (index >= 0) setData("pending", sessionID, index, reconcile(item))
      if (event.data.item.type !== "compaction" && !data.input[sessionID]?.includes(event.data.inboxID))
        setData("input", sessionID, [...(data.input[sessionID] ?? []), event.data.inboxID])
    }
    if (event.type === "session.inbox.delivery.changed")
      setData("pending", sessionID, (items) =>
        items?.map((item) => (item.id === event.data.inboxID ? { ...item, delivery: event.data.delivery } : item)),
      )
    if (event.type === "session.inbox.cancelled" || event.type === "session.inbox.delivered") {
      setData("pending", sessionID, (items) => items?.filter((item) => item.id !== event.data.inboxID))
      setData("input", sessionID, (items) => items?.filter((id) => id !== event.data.inboxID))
    }
    if (event.type === "session.compaction.started" || event.type === "session.compaction.failed") {
      setData("pending", sessionID, (items) => items?.filter((item) => item.id !== event.data.inputID))
      setData("input", sessionID, (items) => items?.filter((id) => id !== event.data.inputID))
    }
    const info = data.info[sessionID]
    const reduction = v2.reduce(data.session_message[sessionID] ?? [], event, info)
    if (reduction) {
      projectV2(reduction)
      if (reduction.missing) hydrateV2Message(sessionID, reduction.missing)
    }

    if (event.type === "session.agent.selected" && info) remember({ ...info, agent: event.data.agent })
    if (event.type === "session.model.selected") {
      if (info) remember({ ...info, model: event.data.model })
      if (data.session_message[sessionID]) hydrateV2Message(sessionID, event.id.replace(/^evt_/, "msg_"))
    }
    if (event.type === "session.renamed" && info)
      remember({ ...info, title: event.data.title, time: { ...info.time, updated: event.created } })
    if (event.type === "session.renamed" && !info)
      void resolve(sessionID)
        .then((current) =>
          remember({ ...current, title: event.data.title, time: { ...current.time, updated: event.created } }),
        )
        .catch(() => undefined)
    if (event.type === "session.moved" && info)
      remember({
        ...info,
        projectID: event.data.projectID,
        location: event.data.location,
        subpath: event.data.subpath,
        time: { ...info.time, updated: event.created },
      })
    if (event.type === "session.usage.updated" && info)
      remember({ ...info, cost: event.data.cost, tokens: event.data.tokens })
    // if (event.type === "session.archived") {
    //   if (info) remember({ ...info, time: { ...info.time, archived: event.created, updated: event.created } })
    //   evict([sessionID])
    // }
    if (event.type === "session.execution.started") setData("session_status", sessionID, { type: "busy" })
    if (
      event.type === "session.execution.succeeded" ||
      event.type === "session.execution.failed" ||
      event.type === "session.execution.interrupted"
    )
      setData("session_status", sessionID, { type: "idle" })
    if (event.type === "session.retry.scheduled")
      setData("session_status", sessionID, {
        type: "retry",
        attempt: event.data.attempt,
        message: event.data.error.message,
        next: event.data.at,
      })
    if (event.type === "session.forked") void resolve(sessionID, { force: true }).catch(() => {})
    if (event.type === "session.revert.staged" && info) remember({ ...info, revert: event.data.revert })
    if (event.type === "session.revert.cleared" && info) remember({ ...info, revert: undefined })
    if (event.type === "session.revert.committed") {
      messageHydrationRevision.set(sessionID, (messageHydrationRevision.get(sessionID) ?? 0) + 1)
      if (info) remember({ ...info, revert: undefined })
      setData("input", sessionID, (items) => items?.filter((id) => id < event.data.to))
      const source = data.session_message[sessionID] ?? []
      const removed = source.filter((message) => message.id >= event.data.to).map((message) => message.id)
      removedMessages.set(sessionID, new Set([...(removedMessages.get(sessionID) ?? []), ...removed]))
      projectV2({
        sessionID,
        messages: source.filter((message) => message.id < event.data.to),
        touched: [],
        removed,
      })
    }
    if (
      event.type === "session.revert.staged" ||
      event.type === "session.revert.cleared" ||
      event.type === "session.revert.committed"
    )
      void resolve(sessionID, { force: true }).catch(() => {})
    if (event.type === "session.revert.committed") void sync(sessionID, { force: true }).catch(() => {})
  }

  const apply = (event: { type: string; properties?: unknown }) => {
    const eventID = eventSessionID(event)
    if (eventID) {
      touch(eventID)
      if (
        !data.info[eventID] &&
        event.type !== "session.created" &&
        event.type !== "session.updated" &&
        event.type !== "session.deleted"
      )
        void resolve(eventID).catch(() => {})
    }
    switch (event.type) {
      case "session.created":
        if ((event.properties as { info?: SessionInfo }).info)
          remember((event.properties as { info: SessionInfo }).info)
        return
      case "session.updated": {
        const info = (event.properties as { info: SessionInfo }).info
        remember(info)
        if (info.time.archived) evict([info.id])
        return
      }
      case "session.deleted": {
        const properties = event.properties as { sessionID?: string; info?: SessionInfo }
        const sessionID = properties.info?.id ?? properties.sessionID
        if (!sessionID) return
        infoSeen.delete(sessionID)
        setData(
          "info",
          produce((draft) => void delete draft[sessionID]),
        )
        evict([sessionID])
        return
      }
      case "todo.updated": {
        const props = event.properties as { sessionID: string; todos: Todo[] }
        setData("todo", props.sessionID, reconcile(props.todos, { key: "id" }))
        return
      }
      case "session.status": {
        const props = event.properties as { sessionID: string; status: SessionStatus }
        setData("session_status", props.sessionID, reconcile(props.status))
        return
      }
      case "message.updated": {
        const info = (event.properties as { info: Message }).info
        const load = messageLoads.get(info.sessionID)
        load?.touchedMessages.add(info.id)
        load?.removedMessages.delete(info.id)
        const orphans = orphanParts.get(info.sessionID)
        orphans?.delete(info.id)
        if (orphans?.size === 0) orphanParts.delete(info.sessionID)
        const removedMessagesForSession = removedMessages.get(info.sessionID)
        removedMessagesForSession?.delete(info.id)
        if (removedMessagesForSession?.size === 0) removedMessages.delete(info.sessionID)
        const messages = data.message[info.sessionID]
        if (!messages) {
          setData("message", info.sessionID, [info])
          return
        }
        const result = Binary.search(messages, messageKey(info), messageKey)
        if (result.found) {
          setData("message", info.sessionID, result.index, reconcile(info))
          return
        }
        // Delivery rewrites time.created, changing the sort key; reposition instead of duplicating.
        setData("message", info.sessionID, (value = []) => {
          const next = value.slice()
          const moved = next.findIndex((message) => message.id === info.id)
          if (moved >= 0) next.splice(moved, 1)
          next.splice(moved >= 0 && moved < result.index ? result.index - 1 : result.index, 0, info)
          return next
        })
        return
      }
      case "message.removed": {
        const props = event.properties as { sessionID: string; messageID: string }
        setData("session_message", props.sessionID, (messages) =>
          messages?.filter((message) => message.id !== props.messageID),
        )
        const load = messageLoads.get(props.sessionID)
        load?.touchedMessages.add(props.messageID)
        load?.removedMessages.add(props.messageID)
        load?.clearedMessageParts.add(props.messageID)
        load?.deltaParts.delete(props.messageID)
        load?.carriedDeltaParts.delete(props.messageID)
        load?.removedParts.delete(props.messageID)
        pendingParts.get(props.sessionID)?.delete(props.messageID)
        if (pendingParts.get(props.sessionID)?.size === 0) pendingParts.delete(props.sessionID)
        const removedMessagesForSession = removedMessages.get(props.sessionID) ?? new Set<string>()
        removedMessagesForSession.add(props.messageID)
        removedMessages.set(props.sessionID, removedMessagesForSession)
        setData(
          produce((draft) => {
            const messages = draft.message[props.sessionID]
            if (messages) {
              const index = messages.findIndex((message) => message.id === props.messageID)
              if (index >= 0) messages.splice(index, 1)
            }
            deleteMessageParts(draft, props.messageID)
          }),
        )
        return
      }
      case "message.part.updated": {
        const part = (event.properties as { part: Part }).part
        if (SKIP_PARTS.has(part.type)) return
        const messages = data.message[part.sessionID]
        const load = messageLoads.get(part.sessionID)
        const missing = !messages?.some((message) => message.id === part.messageID)
        // Outside a page load, accepting a part without its ordered parent event would create an unbounded orphan.
        if (
          missing &&
          (!load ||
            load.clearedMessageParts.has(part.messageID) ||
            removedMessages.get(part.sessionID)?.has(part.messageID))
        )
          return
        if (missing) {
          const orphans = orphanParts.get(part.sessionID) ?? new Set<string>()
          orphans.add(part.messageID)
          orphanParts.set(part.sessionID, orphans)
          load?.orphanParents.add(part.messageID)
        }
        const deltas = load?.deltaParts.get(part.messageID)
        deltas?.delete(part.id)
        if (deltas?.size === 0) load?.deltaParts.delete(part.messageID)
        const carried = load?.carriedDeltaParts.get(part.messageID)
        carried?.delete(part.id)
        if (carried?.size === 0) load?.carriedDeltaParts.delete(part.messageID)
        const removed = load?.removedParts.get(part.messageID)
        removed?.delete(part.id)
        if (removed?.size === 0) load?.removedParts.delete(part.messageID)
        const pending = pendingParts.get(part.sessionID)?.get(part.messageID)
        pending?.delete(part.id)
        if (pending?.size === 0) pendingParts.get(part.sessionID)?.delete(part.messageID)
        if (pendingParts.get(part.sessionID)?.size === 0) pendingParts.delete(part.sessionID)
        deltaBases.delete(part.id)
        trackPartChange(part.sessionID, part.messageID, part.id)
        setData(
          "part_text_accum_delta",
          produce((draft) => void delete draft[part.id]),
        )
        const parts = data.part[part.messageID]
        if (!parts) {
          setData("part", part.messageID, [part])
          return
        }
        const index = parts.findIndex((item) => item.id === part.id)
        if (index >= 0) setData("part", part.messageID, index, reconcile(part))
        if (index < 0) setData("part", part.messageID, (value = []) => [...value, part])
        return
      }
      case "message.part.removed": {
        const props = event.properties as { sessionID: string; messageID: string; partID: string }
        // Part removal is event-only on the server, so its tombstone lasts until a later update or eviction.
        const pending = pendingParts.get(props.sessionID) ?? new Map<string, Set<string>>()
        const parts = pending.get(props.messageID) ?? new Set<string>()
        parts.add(props.partID)
        pending.set(props.messageID, parts)
        pendingParts.set(props.sessionID, pending)
        const deltas = messageLoads.get(props.sessionID)?.deltaParts.get(props.messageID)
        deltas?.delete(props.partID)
        if (deltas?.size === 0) messageLoads.get(props.sessionID)?.deltaParts.delete(props.messageID)
        const load = messageLoads.get(props.sessionID)
        const carried = load?.carriedDeltaParts.get(props.messageID)
        carried?.delete(props.partID)
        if (carried?.size === 0) load?.carriedDeltaParts.delete(props.messageID)
        if (load) {
          const parts = load.removedParts.get(props.messageID) ?? new Set<string>()
          parts.add(props.partID)
          load.removedParts.set(props.messageID, parts)
        }
        trackPartChange(props.sessionID, props.messageID, props.partID)
        setData(
          produce((draft) => {
            delete draft.part_text_accum_delta[props.partID]
            deltaBases.delete(props.partID)
            const parts = draft.part[props.messageID]
            if (!parts) return
            const index = parts.findIndex((part) => part.id === props.partID)
            if (index >= 0) parts.splice(index, 1)
            if (parts.length === 0) delete draft.part[props.messageID]
          }),
        )
        return
      }
      case "message.part.delta": {
        const props = event.properties as {
          sessionID: string
          messageID: string
          partID: string
          field: string
          delta: string
        }
        const parts = data.part[props.messageID]
        if (!parts) return
        const index = parts.findIndex((part) => part.id === props.partID)
        if (index < 0) return
        trackPartChange(props.sessionID, props.messageID, props.partID)
        const load = messageLoads.get(props.sessionID)
        if (load) {
          const parts = load.deltaParts.get(props.messageID) ?? new Set<string>()
          parts.add(props.partID)
          load.deltaParts.set(props.messageID, parts)
          const carried = load.carriedDeltaParts.get(props.messageID)
          carried?.delete(props.partID)
          if (carried?.size === 0) load.carriedDeltaParts.delete(props.messageID)
        }
        const field = props.field as keyof (typeof parts)[number]
        const current = parts[index]?.[field]
        if (!deltaBases.has(props.partID) && typeof current === "string")
          deltaBases.set(props.partID, { base: current, sessionID: props.sessionID })
        setData(
          "part_text_accum_delta",
          props.partID,
          (value) => (value ?? (typeof current === "string" ? current : "")) + props.delta,
        )
        setData(
          "part",
          props.messageID,
          produce((draft) => {
            if (!draft) return
            const part = draft[index]
            const field = props.field as keyof typeof part
            ;(part[field] as string) = ((part[field] as string | undefined) ?? "") + props.delta
          }),
        )
        return
      }
      case "permission.asked": {
        const permission = event.properties as PermissionRequest
        const permissions = data.permission[permission.sessionID]
        if (!permissions) {
          setData("permission", permission.sessionID, [permission])
          return
        }
        const result = Binary.search(permissions, permission.id, (item) => item.id)
        if (result.found) setData("permission", permission.sessionID, result.index, reconcile(permission))
        if (!result.found)
          setData(
            "permission",
            permission.sessionID,
            produce((draft) => void draft.splice(result.index, 0, permission)),
          )
        return
      }
      case "permission.replied": {
        const props = event.properties as { sessionID: string; requestID: string }
        setData(
          "permission",
          props.sessionID,
          produce((draft) => {
            if (!draft) return
            const result = Binary.search(draft, props.requestID, (item) => item.id)
            if (result.found) draft.splice(result.index, 1)
          }),
        )
        return
      }
    }
  }

  return {
    data,
    set: setData,
    get: (sessionID: string) => data.info[sessionID],
    peek: (sessionID: string) => data.info[sessionID],
    remember,
    resolve,
    lineage: {
      peek: peekLineage,
      async resolve(sessionID: string) {
        const session = await resolve(sessionID)
        return { session, root: await rootSession(session, resolve) }
      },
    },
    sync,
    async hydrateTransient(sessionID: string, load: () => Promise<{ pending: SessionInboxInfo[]; forms: FormInfo[] }>) {
      while (true) {
        const pendingAt = pendingRevision.get(sessionID) ?? 0
        const formAt = formRevision.get(sessionID) ?? 0
        const previous = new Set(data.input[sessionID] ?? [])
        const result = await load()
        const pendingStable = (pendingRevision.get(sessionID) ?? 0) === pendingAt
        const formStable = (formRevision.get(sessionID) ?? 0) === formAt
        if (pendingStable) {
          const current = new Set(result.pending.filter((item) => item.type !== "compaction").map((item) => item.id))
          const settled = settledInputs.get(sessionID) ?? new Set<string>()
          previous.forEach((messageID) => {
            if (!current.has(messageID)) settled.add(messageID)
          })
          if (settled.size) settledInputs.set(sessionID, settled)
          result.pending.forEach(v2.confirm)
          setData("pending", sessionID, reconcile(result.pending))
          setData("input", sessionID, reconcile([...current]))
        }
        if (formStable) setData("form", sessionID, reconcile(result.forms))
        if (pendingStable && formStable) return
      }
    },
    refreshPinned(hydrateTransient: (sessionID: string) => Promise<void>) {
      const sessions = [...pinned.keys()]
      return Promise.all(
        sessions.flatMap((sessionID) => [sync(sessionID, { force: true }), hydrateTransient(sessionID)]),
      ).then(() => sessions.forEach(reconcileInbox))
    },
    invalidate() {
      invalidationRevision += 1
      Object.keys(data.info).forEach((sessionID) => invalidated.add(sessionID))
      Object.keys(data.message).forEach((sessionID) => invalidated.add(sessionID))
      setMeta("at", {})
    },
    prefetch,
    shouldPrefetch(sessionID: string, messageCount: number) {
      if (data.message[sessionID] === undefined) return true
      if (Date.now() - (meta.at[sessionID] ?? 0) > 15_000) return true
      if (meta.complete[sessionID]) return false
      return (data.message[sessionID]?.length ?? 0) <= messageCount
    },
    fresh(sessionID: string, ttl: number) {
      return Date.now() - (meta.at[sessionID] ?? 0) <= ttl
    },
    inbox: {
      echo(input: PromptEcho) {
        const created = Date.now()
        const files = input.files?.map((file) => ({
          data: "",
          mime: file.mime,
          source: { type: "uri" as const, uri: file.uri },
          name: file.name,
          mention: file.mention,
        }))
        const item: SessionInboxInfo = {
          id: input.messageID,
          sessionID: input.sessionID,
          timeCreated: created,
          type: "user",
          delivery: "steer",
          payload: { text: input.text, files, agents: input.agents },
        }
        const projected = normalizeSessionMessages(input.sessionID, [
          { id: `${input.messageID}:agent`, type: "agent-switched", agent: input.agent, time: { created } },
          {
            id: `${input.messageID}:model`,
            type: "model-switched",
            model: {
              id: input.model.modelID,
              providerID: input.model.providerID,
              variant: input.model.variant,
            },
            time: { created },
          },
          {
            id: input.messageID,
            type: "user",
            text: input.displayText,
            files,
            agents: input.agents,
            time: { created },
          },
        ])
        const message = projected.messages[0]!
        const comments: Part[] = input.comments.map((comment, index) => ({
          id: `${input.messageID}:comment:${index}`,
          sessionID: input.sessionID,
          messageID: input.messageID,
          type: "text",
          text: formatCommentNote(comment),
          synthetic: true,
          metadata: createCommentMetadata(comment),
        }))
        const parts = [...(projected.parts.get(input.messageID) ?? []), ...comments]
        removedMessages.get(input.sessionID)?.delete(input.messageID)
        markEcho(input.sessionID, input.messageID)
        pendingRevision.set(input.sessionID, (pendingRevision.get(input.sessionID) ?? 0) + 1)
        batch(() => {
          setData("pending", input.sessionID, (items = []) => [...items.filter((entry) => entry.id !== item.id), item])
          if (!data.input[input.sessionID]?.includes(input.messageID))
            setData("input", input.sessionID, [...(data.input[input.sessionID] ?? []), input.messageID])
          setData("message", input.sessionID, (messages = []) => merge(messages, [message]).sort(compareMessages))
          setData("part", input.messageID, parts)
        })
      },
      confirm: confirmInbox,
      reconcile: reconcileInbox,
      clearEcho(input: { sessionID: string; messageID: string }) {
        if (echoes.get(input.sessionID)?.get(input.messageID) !== "sending") return false
        return removeEcho(input.sessionID, input.messageID)
      },
    },
    async todo(sessionID: string, request?: { force?: boolean }) {
      touch(sessionID)
      if (data.todo[sessionID] !== undefined && !request?.force) return
      // TODO: Restore todos when the V2 client exposes a session todo API.
      setData("todo", sessionID, [])
    },
    history: {
      more: (sessionID: string) =>
        data.message[sessionID] !== undefined &&
        meta.complete[sessionID] !== undefined &&
        !meta.complete[sessionID] &&
        !!meta.cursor[sessionID],
      loading: (sessionID: string) => meta.loading[sessionID] ?? false,
      async loadMore(sessionID: string) {
        touch(sessionID)
        if (meta.loading[sessionID] || meta.complete[sessionID] || !meta.cursor[sessionID]) return
        await loadMessages(sessionID, meta.cursor[sessionID], "prepend")
      },
    },
    evict(sessionID: string) {
      if (protectedSessions().has(sessionID)) return
      seen.delete(sessionID)
      evict([sessionID])
    },
    pin(sessionID: string) {
      pinned.set(sessionID, (pinned.get(sessionID) ?? 0) + 1)
      touch(sessionID)
    },
    unpin(sessionID: string) {
      const count = pinned.get(sessionID)
      if (!count || count === 1) pinned.delete(sessionID)
      if (count && count > 1) pinned.set(sessionID, count - 1)
    },
    apply,
    applyV2,
  }
}

export type ServerSession = ReturnType<typeof createServerSession>

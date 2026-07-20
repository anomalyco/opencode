import { Binary } from "@opencode-ai/core/util/binary"
import { retry } from "@opencode-ai/core/util/retry"
import type {
  Message,
  OpencodeClient,
  Part,
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
  SnapshotFileDiff,
  Todo,
} from "@opencode-ai/sdk/v2/client"
import { batch } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { diffs as cleanDiffs, message as cleanMessage } from "@/utils/diffs"
import { sessionNotFoundError } from "@/utils/server-errors"
import { rootSession } from "@/utils/session-route"
import { dropSessionCaches, pickSessionCacheEvictions, SESSION_CACHE_LIMIT } from "./global-sync/session-cache"

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const cmpMessage = (a: Message, b: Message) => a.time.created - b.time.created || cmp(a.id, b.id)
const SKIP_PARTS = new Set(["patch", "step-start", "step-finish"])
const initialMessagePageSize = 20
const historyMessagePageSize = 200
const sessionInfoLimit = 2_048
const emptyIDs: ReadonlySet<string> = new Set()

type OptimisticItem = {
  message: Message
  parts: Part[]
  confirmedParts?: Part[]
  confirmedMessage?: boolean
}

type MessagePage = {
  session: Message[]
  part: { id: string; part: Part[] }[]
  cursor?: string
  complete: boolean
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
  optimisticParts: Map<string, Set<string>>
  orphanParents: Set<string>
  clearedMessageParts: Set<string>
}

type MessageLoadBaseline = Pick<
  MessageLoadState,
  "touchedMessages" | "retainedMessages" | "touchedParts" | "clearedMessageParts"
>

function mergeOptimisticPage(page: MessagePage, items: OptimisticItem[]) {
  if (items.length === 0) return { ...page, observed: [] as { messageID: string; parts: Part[] }[] }
  const session = [...page.session]
  const part = new Map(page.part.map((item) => [item.id, item.part]))
  const observed: { messageID: string; parts: Part[] }[] = []
  for (const item of items) {
    const result = Binary.search(session, item.message.id, (message) => message.id)
    if (!result.found) session.splice(result.index, 0, item.message)
    const current = part.get(item.message.id)
    const confirmed = result.found
      ? item.parts.filter((part) => Binary.search(current ?? [], part.id, (value) => value.id).found)
      : []
    if (result.found) observed.push({ messageID: item.message.id, parts: confirmed })
    part.set(
      item.message.id,
      merge(
        result.found ? (current ?? []) : merge(item.confirmedParts ?? [], current ?? []),
        item.parts.filter((part) => !confirmed.includes(part)),
      ),
    )
  }
  return {
    ...page,
    session,
    part: [...part.entries()].sort((a, b) => cmp(a[0], b[0])).map(([id, parts]) => ({ id, part: parts })),
    observed,
  }
}

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
  return [...result.values()].sort((a, b) => cmp(a.id, b.id))
}

export function createServerSession(client: OpencodeClient, options?: { retry?: typeof retry }) {
  const [data, setData] = createStore({
    info: {} as Record<string, Session | undefined>,
    session_status: {} as Record<string, SessionStatus>,
    session_diff: {} as Record<string, SnapshotFileDiff[]>,
    todo: {} as Record<string, Todo[]>,
    permission: {} as Record<string, PermissionRequest[]>,
    question: {} as Record<string, QuestionRequest[]>,
    message: {} as Record<string, Message[]>,
    part: {} as Record<string, Part[]>,
    part_text_accum_delta: {} as Record<string, string>,
    session_working(id: string) {
      return (this.session_status[id]?.type ?? "idle") !== "idle"
    },
  })
  const requests = new Map<string, Promise<Session>>()
  const inflight = new Map<string, Promise<void>>()
  const inflightDiff = new Map<string, Promise<void>>()
  const inflightTodo = new Map<string, Promise<void>>()
  const optimistic = new Map<string, Map<string, OptimisticItem>>()
  const messageLoads = new Map<string, MessageLoadState>()
  const pendingParts = new Map<string, Map<string, Set<string>>>()
  const orphanParts = new Map<string, Set<string>>()
  const removedMessages = new Map<string, Set<string>>()
  const deltaBases = new Map<string, { base: string; sessionID: string }>()
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
    limit: {} as Record<string, number | undefined>,
    cursor: {} as Record<string, string | undefined>,
    complete: {} as Record<string, boolean | undefined>,
    loading: {} as Record<string, boolean | undefined>,
    at: {} as Record<string, number | undefined>,
  })

  const remember = (session: Session) => {
    setData("info", session.id, reconcile(session))
    infoSeen.delete(session.id)
    infoSeen.add(session.id)
    if (infoSeen.size > sessionInfoLimit) {
      const preserve = new Set([
        ...pinned.keys(),
        ...requests.keys(),
        ...inflight.keys(),
        ...inflightDiff.keys(),
        ...inflightTodo.keys(),
        ...messageLoads.keys(),
        ...optimistic.keys(),
        ...Object.entries(data.permission)
          .filter(([, items]) => items.length > 0)
          .map(([sessionID]) => sessionID),
        ...Object.entries(data.question)
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
    const request = client.session.get({ sessionID }).then((result) => {
      if (!result.data) throw sessionNotFoundError(sessionID)
      if (generations.get(sessionID) !== active) return result.data
      return remember(result.data)
    })
    requests.set(sessionID, request)
    const cleanup = () => {
      if (requests.get(sessionID) === request) requests.delete(sessionID)
      if (
        generations.get(sessionID) === active &&
        !data.info[sessionID] &&
        !requests.has(sessionID) &&
        !messageLoads.has(sessionID) &&
        !inflight.has(sessionID) &&
        !inflightDiff.has(sessionID) &&
        !inflightTodo.has(sessionID)
      )
        generations.delete(sessionID)
    }
    void request.then(cleanup, cleanup)
    return request
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

  const clearOptimistic = (sessionID: string, messageID?: string) => {
    if (!messageID) {
      optimistic.delete(sessionID)
      return
    }
    const items = optimistic.get(sessionID)
    if (!items) return
    items.delete(messageID)
    if (items.size === 0) optimistic.delete(sessionID)
  }

  const clearOptimisticPart = (sessionID: string, messageID: string, partID: string) => {
    const items = optimistic.get(sessionID)
    const item = items?.get(messageID)
    if (!items || !item) return
    const parts = item.parts.filter((part) => part.id !== partID)
    const confirmedParts = item.confirmedParts?.filter((part) => part.id !== partID)
    if (parts.length === 0) {
      clearOptimistic(sessionID, messageID)
      return
    }
    items.set(messageID, { ...item, parts, confirmedParts, confirmedMessage: true })
  }

  const confirmOptimisticPart = (sessionID: string, messageID: string, part: Part) => {
    const items = optimistic.get(sessionID)
    const item = items?.get(messageID)
    if (!items || !item) return
    const parts = item.parts.filter((value) => value.id !== part.id)
    if (parts.length === 0) {
      clearOptimistic(sessionID, messageID)
      return
    }
    items.set(messageID, {
      ...item,
      parts,
      confirmedParts: merge(item.confirmedParts ?? [], [part]),
      confirmedMessage: true,
    })
  }

  const confirmOptimistic = (sessionID: string, messageID: string, confirmedParts: Part[]) => {
    const items = optimistic.get(sessionID)
    const item = items?.get(messageID)
    if (!items || !item) return
    const confirmed = new Set(confirmedParts.map((part) => part.id))
    const parts = item.parts.filter((part) => !confirmed.has(part.id))
    if (parts.length === 0) {
      clearOptimistic(sessionID, messageID)
      return
    }
    items.set(messageID, {
      ...item,
      parts,
      confirmedParts: merge(item.confirmedParts ?? [], confirmedParts),
      confirmedMessage: true,
    })
  }

  const trackPartChange = (sessionID: string, messageID: string, partID: string) => {
    const load = messageLoads.get(sessionID)
    if (!load) return
    // A part event keeps an existing parent when the fetched page omits it without overriding fetched metadata.
    const messages = data.message[sessionID]
    if (messages && Binary.search(messages, messageID, (message) => message.id).found)
      load.retainedMessages.add(messageID)
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
      if (messages && Binary.search(messages, messageID, (message) => message.id).found)
        load.retainedMessages.add(messageID)
    }
    for (const [messageID, parts] of load.removedParts) {
      const touched = load.touchedParts.get(messageID) ?? new Set<string>()
      parts.forEach((partID) => touched.add(partID))
      load.touchedParts.set(messageID, touched)
      const messages = data.message[sessionID]
      if (messages && Binary.search(messages, messageID, (message) => message.id).found)
        load.retainedMessages.add(messageID)
    }
    for (const [messageID, parts] of load.optimisticParts) {
      load.removedMessages.delete(messageID)
      load.clearedMessageParts.add(messageID)
      load.touchedMessages.add(messageID)
      const touched = load.touchedParts.get(messageID) ?? new Set<string>()
      parts.forEach((partID) => touched.add(partID))
      load.touchedParts.set(messageID, touched)
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
      generations.delete(sessionID)
      clearOptimistic(sessionID)
      requests.delete(sessionID)
      inflight.delete(sessionID)
      inflightDiff.delete(sessionID)
      inflightTodo.delete(sessionID)
      messageLoads.delete(sessionID)
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
          delete draft.limit[sessionID]
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
      ...inflightDiff.keys(),
      ...inflightTodo.keys(),
      ...messageLoads.keys(),
      ...optimistic.keys(),
      ...Object.entries(data.permission)
        .filter(([, items]) => items.length > 0)
        .map(([sessionID]) => sessionID),
      ...Object.entries(data.question)
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

  const fetchMessages = async (sessionID: string, limit: number, before?: string, onAttempt?: () => void) => {
    const response = await (options?.retry ?? retry)(() => {
      onAttempt?.()
      return client.session.messages({ sessionID, limit, before })
    })
    const items = (response.data ?? []).filter((item) => !!item?.info?.id)
    return {
      session: items.map((item) => cleanMessage(item.info)).sort((a, b) => cmp(a.id, b.id)),
      part: items.map((item) => ({
        id: item.info.id,
        part: item.parts.filter((part) => !!part?.id).sort((a, b) => cmp(a.id, b.id)),
      })),
      cursor: response.response.headers.get("x-next-cursor") ?? undefined,
      complete: !response.response.headers.get("x-next-cursor"),
    }
  }

  const fetchMessage = async (sessionID: string, messageID: string, onAttempt?: () => void) => {
    const response = await (options?.retry ?? retry)(() => {
      onAttempt?.()
      return client.session.message({ sessionID, messageID })
    })
    if (!response.data?.info?.id) throw new Error(`Message not found: ${messageID}`)
    return {
      message: cleanMessage(response.data.info),
      parts: response.data.parts.filter((part) => !!part?.id).sort((a, b) => cmp(a.id, b.id)),
    }
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
      const fetched = load?.clearedMessageParts.has(item.id)
        ? []
        : item.part.filter((part) => !SKIP_PARTS.has(part.type))
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
    const merged = mergeOptimisticPage(page, [...(optimistic.get(sessionID)?.values() ?? [])])
    merged.observed.forEach((item) => {
      if (!load?.clearedMessageParts.has(item.messageID)) confirmOptimistic(sessionID, item.messageID, item.parts)
    })
    const touchedMessages = new Set([...(load?.touchedMessages ?? []), ...(removedMessages.get(sessionID) ?? [])])
    const messages = reconcileFetched(merged.session, data.message[sessionID] ?? [], {
      touched: touchedMessages,
      retained: load?.retainedMessages,
      removed: load?.removedMessages,
      preserveUnfetched,
    })
    batch(() => {
      const messageIDs = replaceMessages(sessionID, messages)
      replaceParts(sessionID, merged.part, messageIDs, load)
      const orphans = orphanParts.get(sessionID)
      if (cleanupOrphans && page.complete && orphans) {
        for (const messageID of orphans) {
          if (!messageIDs.has(messageID)) setData(produce((draft) => deleteMessageParts(draft, messageID)))
        }
        orphanParts.delete(sessionID)
      }
      setMeta("limit", sessionID, messages.length)
      setMeta("cursor", sessionID, merged.cursor)
      setMeta("complete", sessionID, merged.complete)
      setMeta("at", sessionID, Date.now())
    })
  }

  const loadMessages = async (sessionID: string, limit: number, before?: string, mode?: "replace" | "prepend") => {
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
      optimisticParts: new Map(),
      orphanParents: new Set(),
      clearedMessageParts: new Set(),
    }
    messageLoads.set(sessionID, load)
    setMeta("loading", sessionID, true)
    let applied = false
    try {
      const page = await fetchMessages(sessionID, limit, before, () => resetMessageLoad(sessionID, load))
      const first = page.session.reduce<Message | undefined>(
        (oldest, message) => (!oldest || cmpMessage(message, oldest) < 0 ? message : oldest),
        undefined,
      )
      if (generations.get(sessionID) !== active) return

      const parents = [] as Awaited<ReturnType<typeof fetchMessage>>[]
      if (mode !== "prepend") {
        const users = new Set([
          ...page.session.filter((message) => message.role === "user").map((message) => message.id),
          ...(data.message[sessionID] ?? [])
            .filter((message) => {
              if (message.role !== "user") return false
              const item = optimistic.get(sessionID)?.get(message.id)
              return load.touchedMessages.has(message.id) && (!item || item.confirmedMessage === true)
            })
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
              ),
              part: merge(
                page.part,
                parents.map((parent) => ({ id: parent.message.id, part: parent.parts })),
              ),
            }
      const preserveUnfetched =
        mode === "prepend" || (!result.complete && (!first || ((message: Message) => cmpMessage(message, first) < 0)))
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

  const sync = (sessionID: string, options?: { force?: boolean; messageLimit?: number }) => {
    touch(sessionID)
    return runInflight(inflight, sessionID, async () => {
      const cached = data.message[sessionID] !== undefined && meta.limit[sessionID] !== undefined
      if (cached && data.info[sessionID] && !options?.force) return
      await Promise.all([
        resolve(sessionID, options),
        cached && !options?.force
          ? Promise.resolve()
          : loadMessages(sessionID, options?.messageLimit ?? meta.limit[sessionID] ?? initialMessagePageSize),
      ])
    })
  }

  const prefetch = async (sessionID: string, limit: number) => {
    touch(sessionID)
    await inflight.get(sessionID)
    if (
      Date.now() - (meta.at[sessionID] ?? 0) <= 15_000 &&
      (meta.complete[sessionID] || (data.message[sessionID]?.length ?? 0) >= limit)
    )
      return
    await runInflight(inflight, sessionID, () => loadMessages(sessionID, limit))
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
        remember((event.properties as { info: Session }).info)
        return
      case "session.updated": {
        const info = (event.properties as { info: Session }).info
        remember(info)
        if (info.time.archived) evict([info.id])
        return
      }
      case "session.deleted": {
        const sessionID = (event.properties as { info: Session }).info.id
        infoSeen.delete(sessionID)
        setData(
          "info",
          produce((draft) => void delete draft[sessionID]),
        )
        evict([sessionID])
        return
      }
      case "session.diff": {
        const props = event.properties as { sessionID: string; diff: SnapshotFileDiff[] }
        setData("session_diff", props.sessionID, reconcile(cleanDiffs(props.diff), { key: "file" }))
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
        const info = cleanMessage((event.properties as { info: Message }).info)
        const load = messageLoads.get(info.sessionID)
        load?.touchedMessages.add(info.id)
        load?.removedMessages.delete(info.id)
        const items = optimistic.get(info.sessionID)
        const item = items?.get(info.id)
        if (items && item) {
          if (item.parts.length === 0) clearOptimistic(info.sessionID, info.id)
          if (item.parts.length > 0) items.set(info.id, { ...item, confirmedMessage: true })
        }
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
        const result = Binary.search(messages, info.id, (message) => message.id)
        if (result.found) setData("message", info.sessionID, result.index, reconcile(info))
        if (!result.found)
          setData("message", info.sessionID, (value = []) => {
            const next = value.slice()
            next.splice(result.index, 0, info)
            return next
          })
        return
      }
      case "message.removed": {
        const props = event.properties as { sessionID: string; messageID: string }
        const load = messageLoads.get(props.sessionID)
        load?.touchedMessages.add(props.messageID)
        load?.removedMessages.add(props.messageID)
        load?.clearedMessageParts.add(props.messageID)
        load?.deltaParts.delete(props.messageID)
        load?.carriedDeltaParts.delete(props.messageID)
        load?.removedParts.delete(props.messageID)
        load?.optimisticParts.delete(props.messageID)
        pendingParts.get(props.sessionID)?.delete(props.messageID)
        if (pendingParts.get(props.sessionID)?.size === 0) pendingParts.delete(props.sessionID)
        const removedMessagesForSession = removedMessages.get(props.sessionID) ?? new Set<string>()
        removedMessagesForSession.add(props.messageID)
        removedMessages.set(props.sessionID, removedMessagesForSession)
        clearOptimistic(props.sessionID, props.messageID)
        setData(
          produce((draft) => {
            const messages = draft.message[props.sessionID]
            if (messages) {
              const result = Binary.search(messages, props.messageID, (message) => message.id)
              if (result.found) messages.splice(result.index, 1)
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
        const missing = !messages || !Binary.search(messages, part.messageID, (message) => message.id).found
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
        const optimistic = load?.optimisticParts.get(part.messageID)
        optimistic?.delete(part.id)
        if (optimistic?.size === 0) load?.optimisticParts.delete(part.messageID)
        deltaBases.delete(part.id)
        trackPartChange(part.sessionID, part.messageID, part.id)
        confirmOptimisticPart(part.sessionID, part.messageID, part)
        setData(
          "part_text_accum_delta",
          produce((draft) => void delete draft[part.id]),
        )
        const parts = data.part[part.messageID]
        if (!parts) {
          setData("part", part.messageID, [part])
          return
        }
        const result = Binary.search(parts, part.id, (item) => item.id)
        if (result.found) setData("part", part.messageID, result.index, reconcile(part))
        if (!result.found)
          setData("part", part.messageID, (value = []) => {
            const next = value.slice()
            next.splice(result.index, 0, part)
            return next
          })
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
          const optimistic = load.optimisticParts.get(props.messageID)
          optimistic?.delete(props.partID)
          if (optimistic?.size === 0) load.optimisticParts.delete(props.messageID)
        }
        trackPartChange(props.sessionID, props.messageID, props.partID)
        clearOptimisticPart(props.sessionID, props.messageID, props.partID)
        setData(
          produce((draft) => {
            delete draft.part_text_accum_delta[props.partID]
            deltaBases.delete(props.partID)
            const parts = draft.part[props.messageID]
            if (!parts) return
            const result = Binary.search(parts, props.partID, (part) => part.id)
            if (result.found) parts.splice(result.index, 1)
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
        const result = Binary.search(parts, props.partID, (part) => part.id)
        if (!result.found) return
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
        const current = parts[result.index]?.[field]
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
            const part = draft[result.index]
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
      case "question.asked": {
        const question = event.properties as QuestionRequest
        const questions = data.question[question.sessionID]
        if (!questions) {
          setData("question", question.sessionID, [question])
          return
        }
        const result = Binary.search(questions, question.id, (item) => item.id)
        if (result.found) setData("question", question.sessionID, result.index, reconcile(question))
        if (!result.found)
          setData(
            "question",
            question.sessionID,
            produce((draft) => void draft.splice(result.index, 0, question)),
          )
        return
      }
      case "question.replied":
      case "question.rejected": {
        const props = event.properties as { sessionID: string; requestID: string }
        setData(
          "question",
          props.sessionID,
          produce((draft) => {
            if (!draft) return
            const result = Binary.search(draft, props.requestID, (item) => item.id)
            if (result.found) draft.splice(result.index, 1)
          }),
        )
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
    prefetch,
    shouldPrefetch(sessionID: string, limit: number) {
      if (data.message[sessionID] === undefined) return true
      if (Date.now() - (meta.at[sessionID] ?? 0) > 15_000) return true
      if (meta.complete[sessionID]) return false
      return (meta.limit[sessionID] ?? 0) <= limit
    },
    fresh(sessionID: string, ttl: number) {
      return Date.now() - (meta.at[sessionID] ?? 0) <= ttl
    },
    optimistic: {
      add(input: { sessionID: string; message: Message; parts: Part[] }) {
        const parts = input.parts
          .filter((part) => !!part?.id && !SKIP_PARTS.has(part.type))
          .sort((a, b) => cmp(a.id, b.id))
        const load = messageLoads.get(input.sessionID)
        if (load?.clearedMessageParts.has(input.message.id)) {
          const touched = load.touchedParts.get(input.message.id) ?? new Set<string>()
          parts.forEach((part) => touched.add(part.id))
          load.touchedParts.set(input.message.id, touched)
        }
        if (load) {
          load.removedMessages.delete(input.message.id)
          load.optimisticParts.set(input.message.id, new Set(parts.map((part) => part.id)))
        }
        const items = optimistic.get(input.sessionID)
        const removedMessagesForSession = removedMessages.get(input.sessionID)
        removedMessagesForSession?.delete(input.message.id)
        if (removedMessagesForSession?.size === 0) removedMessages.delete(input.sessionID)
        if (items) items.set(input.message.id, { ...input, parts, confirmedParts: [] })
        if (!items)
          optimistic.set(input.sessionID, new Map([[input.message.id, { ...input, parts, confirmedParts: [] }]]))
        setData("message", input.sessionID, (messages = []) => merge(messages, [input.message]))
        setData(
          "part_text_accum_delta",
          produce((draft) => {
            for (const part of [...(data.part[input.message.id] ?? []), ...parts]) {
              delete draft[part.id]
              deltaBases.delete(part.id)
            }
          }),
        )
        setData("part", input.message.id, parts)
      },
      remove(input: { sessionID: string; messageID: string }) {
        const item = optimistic.get(input.sessionID)?.get(input.messageID)
        if (!item) return
        messageLoads.get(input.sessionID)?.optimisticParts.delete(input.messageID)
        clearOptimistic(input.sessionID, input.messageID)
        if (item.confirmedMessage) {
          const partIDs = new Set(item.parts.map((part) => part.id))
          setData(
            produce((draft) => {
              for (const part of item.parts) {
                delete draft.part_text_accum_delta[part.id]
                deltaBases.delete(part.id)
              }
              const parts = draft.part[input.messageID]
              if (!parts) return
              draft.part[input.messageID] = parts.filter((part) => !partIDs.has(part.id))
              if (draft.part[input.messageID]?.length === 0) delete draft.part[input.messageID]
            }),
          )
          return
        }
        setData("message", input.sessionID, (messages) => messages?.filter((message) => message.id !== input.messageID))
        setData(produce((draft) => deleteMessageParts(draft, input.messageID)))
      },
    },
    diff(sessionID: string, options?: { force?: boolean }) {
      touch(sessionID)
      if (data.session_diff[sessionID] !== undefined && !options?.force) return Promise.resolve()
      return runInflight(inflightDiff, sessionID, () => {
        const active = generation(sessionID)
        return retry(() => client.session.diff({ sessionID })).then((result) => {
          if (generations.get(sessionID) !== active) return
          setData("session_diff", sessionID, reconcile(cleanDiffs(result.data), { key: "file" }))
        })
      })
    },
    todo(sessionID: string, options?: { force?: boolean }) {
      touch(sessionID)
      if (data.todo[sessionID] !== undefined && !options?.force) return Promise.resolve()
      return runInflight(inflightTodo, sessionID, () => {
        const active = generation(sessionID)
        return retry(() => client.session.todo({ sessionID })).then((result) => {
          if (generations.get(sessionID) !== active) return
          setData("todo", sessionID, reconcile(result.data ?? [], { key: "id" }))
        })
      })
    },
    history: {
      more: (sessionID: string) =>
        data.message[sessionID] !== undefined &&
        meta.limit[sessionID] !== undefined &&
        !meta.complete[sessionID] &&
        !!meta.cursor[sessionID],
      loading: (sessionID: string) => meta.loading[sessionID] ?? false,
      async loadMore(sessionID: string, count = historyMessagePageSize) {
        touch(sessionID)
        if (meta.loading[sessionID] || meta.complete[sessionID] || !meta.cursor[sessionID]) return
        await loadMessages(sessionID, count, meta.cursor[sessionID], "prepend")
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
  }
}

export type ServerSession = ReturnType<typeof createServerSession>

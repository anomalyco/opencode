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
import { rootSession } from "@/utils/session-route"
import { dropSessionCaches, pickSessionCacheEvictions, SESSION_CACHE_LIMIT } from "./global-sync/session-cache"

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const SKIP_PARTS = new Set(["patch", "step-start", "step-finish"])
const initialMessagePageSize = 2
const historyMessagePageSize = 200
const sessionInfoLimit = 2_048

type OptimisticItem = {
  message: Message
  parts: Part[]
}

const hasParts = (parts: Part[] | undefined, want: Part[]) => {
  if (!parts) return want.length === 0
  return want.every((part) => Binary.search(parts, part.id, (item) => item.id).found)
}

function mergeOptimisticPage(
  page: { session: Message[]; part: { id: string; part: Part[] }[]; cursor?: string; complete: boolean },
  items: OptimisticItem[],
) {
  if (items.length === 0) return { ...page, confirmed: [] as string[] }
  const session = [...page.session]
  const part = new Map(page.part.map((item) => [item.id, item.part]))
  const confirmed: string[] = []
  for (const item of items) {
    const result = Binary.search(session, item.message.id, (message) => message.id)
    if (!result.found) session.splice(result.index, 0, item.message)
    const current = part.get(item.message.id)
    if (result.found && hasParts(current, item.parts)) {
      confirmed.push(item.message.id)
      continue
    }
    part.set(item.message.id, merge(current ?? [], item.parts))
  }
  return {
    ...page,
    session,
    part: [...part.entries()].sort((a, b) => cmp(a[0], b[0])).map(([id, parts]) => ({ id, part: parts })),
    confirmed,
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

export function createServerSession(client: OpencodeClient) {
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
  const seen = new Set<string>()
  const infoSeen = new Set<string>()
  const pinned = new Map<string, number>()
  const generations = new Map<string, number>()
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
    const generation = generations.get(sessionID) ?? 0
    const request = client.session.get({ sessionID }).then((result) => {
      if (!result.data) throw new Error(`Session not found: ${sessionID}`)
      if ((generations.get(sessionID) ?? 0) !== generation) return result.data
      return remember(result.data)
    })
    requests.set(sessionID, request)
    void request.then(
      () => {
        if (requests.get(sessionID) === request) requests.delete(sessionID)
      },
      () => {
        if (requests.get(sessionID) === request) requests.delete(sessionID)
      },
    )
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

  const evict = (sessionIDs: string[]) => {
    if (sessionIDs.length === 0) return
    sessionIDs.forEach((sessionID) => {
      generations.set(sessionID, (generations.get(sessionID) ?? 0) + 1)
      clearOptimistic(sessionID)
      requests.delete(sessionID)
      inflight.delete(sessionID)
      inflightDiff.delete(sessionID)
      inflightTodo.delete(sessionID)
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

  const fetchMessages = async (sessionID: string, limit: number, before?: string) => {
    const response = await retry(() => client.session.messages({ sessionID, limit, before }))
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

  const loadMessages = async (sessionID: string, limit: number, before?: string, mode?: "replace" | "prepend") => {
    if (meta.loading[sessionID]) return
    const generation = generations.get(sessionID) ?? 0
    setMeta("loading", sessionID, true)
    await fetchMessages(sessionID, limit, before)
      .then((page) => {
        if ((generations.get(sessionID) ?? 0) !== generation) return
        const next = mergeOptimisticPage(page, [...(optimistic.get(sessionID)?.values() ?? [])])
        next.confirmed.forEach((messageID) => clearOptimistic(sessionID, messageID))
        const messages = mode === "prepend" ? merge(data.message[sessionID] ?? [], next.session) : next.session
        batch(() => {
          setData("message", sessionID, reconcile(messages, { key: "id" }))
          for (const item of next.part) {
            const parts = item.part.filter((part) => !SKIP_PARTS.has(part.type))
            if (parts.length) setData("part", item.id, reconcile(parts, { key: "id" }))
          }
          setMeta("limit", sessionID, messages.length)
          setMeta("cursor", sessionID, next.cursor)
          setMeta("complete", sessionID, next.complete)
          setMeta("at", sessionID, Date.now())
        })
      })
      .finally(() => {
        if ((generations.get(sessionID) ?? 0) === generation) setMeta("loading", sessionID, false)
      })
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
      if (!data.info[eventID]) void resolve(eventID).catch(() => {})
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
        setData(
          produce((draft) => {
            const messages = draft.message[props.sessionID]
            if (messages) {
              const result = Binary.search(messages, props.messageID, (message) => message.id)
              if (result.found) messages.splice(result.index, 1)
            }
            for (const part of draft.part[props.messageID] ?? []) delete draft.part_text_accum_delta[part.id]
            delete draft.part[props.messageID]
          }),
        )
        return
      }
      case "message.part.updated": {
        const part = (event.properties as { part: Part }).part
        if (SKIP_PARTS.has(part.type)) return
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
        const props = event.properties as { messageID: string; partID: string }
        setData(
          produce((draft) => {
            delete draft.part_text_accum_delta[props.partID]
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
        const props = event.properties as { messageID: string; partID: string; field: string; delta: string }
        const parts = data.part[props.messageID]
        if (!parts) return
        const result = Binary.search(parts, props.partID, (part) => part.id)
        if (!result.found) return
        const field = props.field as keyof (typeof parts)[number]
        const current = parts[result.index]?.[field]
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
        const permissions = data.permission[permission.sessionID] ?? []
        const result = Binary.search(permissions, permission.id, (item) => item.id)
        if (result.found) setData("permission", permission.sessionID, result.index, reconcile(permission))
        if (!result.found)
          setData(
            "permission",
            permission.sessionID,
            produce((draft = []) => void draft.splice(result.index, 0, permission)),
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
        const questions = data.question[question.sessionID] ?? []
        const result = Binary.search(questions, question.id, (item) => item.id)
        if (result.found) setData("question", question.sessionID, result.index, reconcile(question))
        if (!result.found)
          setData(
            "question",
            question.sessionID,
            produce((draft = []) => void draft.splice(result.index, 0, question)),
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
        const items = optimistic.get(input.sessionID)
        if (items) items.set(input.message.id, input)
        if (!items) optimistic.set(input.sessionID, new Map([[input.message.id, input]]))
        setData("message", input.sessionID, (messages = []) => merge(messages, [input.message]))
        setData(
          "part",
          input.message.id,
          input.parts.filter((part) => !!part?.id).sort((a, b) => cmp(a.id, b.id)),
        )
      },
      remove(input: { sessionID: string; messageID: string }) {
        clearOptimistic(input.sessionID, input.messageID)
        setData("message", input.sessionID, (messages) => messages?.filter((message) => message.id !== input.messageID))
        setData(
          "part",
          produce((draft) => void delete draft[input.messageID]),
        )
      },
    },
    diff(sessionID: string, options?: { force?: boolean }) {
      touch(sessionID)
      if (data.session_diff[sessionID] !== undefined && !options?.force) return Promise.resolve()
      return runInflight(inflightDiff, sessionID, () => {
        const generation = generations.get(sessionID) ?? 0
        return retry(() => client.session.diff({ sessionID })).then((result) => {
          if ((generations.get(sessionID) ?? 0) !== generation) return
          setData("session_diff", sessionID, reconcile(cleanDiffs(result.data), { key: "file" }))
        })
      })
    },
    todo(sessionID: string, options?: { force?: boolean }) {
      touch(sessionID)
      if (data.todo[sessionID] !== undefined && !options?.force) return Promise.resolve()
      return runInflight(inflightTodo, sessionID, () => {
        const generation = generations.get(sessionID) ?? 0
        return retry(() => client.session.todo({ sessionID })).then((result) => {
          if ((generations.get(sessionID) ?? 0) !== generation) return
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

import { batch, createMemo } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { Binary } from "@opencode-ai/util/binary"
import { retry } from "@opencode-ai/util/retry"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useGlobalSync } from "./global-sync"
import { useSDK } from "./sdk"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"

function sortParts(parts: Part[]) {
  return parts.filter((part) => !!part?.id).sort((a, b) => cmp(a.id, b.id))
}

function runInflight(map: Map<string, Promise<void>>, key: string, task: () => Promise<void>) {
  const pending = map.get(key)
  if (pending) return pending
  const promise = task().finally(() => {
    map.delete(key)
  })
  map.set(key, promise)
  return promise
}

const keyFor = (directory: string, id: string) => `${directory}\n${id}`

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

type OptimisticStore = {
  message: Record<string, Message[] | undefined>
  part: Record<string, Part[] | undefined>
}

type OptimisticAddInput = {
  sessionID: string
  message: Message
  parts: Part[]
}

type OptimisticRemoveInput = {
  sessionID: string
  messageID: string
}

export function applyOptimisticAdd(draft: OptimisticStore, input: OptimisticAddInput) {
  const messages = draft.message[input.sessionID]
  if (!messages) {
    draft.message[input.sessionID] = [input.message]
  }
  if (messages) {
    const result = Binary.search(messages, input.message.id, (m) => m.id)
    messages.splice(result.index, 0, input.message)
  }
  draft.part[input.message.id] = sortParts(input.parts)
}

export function applyOptimisticRemove(draft: OptimisticStore, input: OptimisticRemoveInput) {
  const messages = draft.message[input.sessionID]
  if (messages) {
    const result = Binary.search(messages, input.messageID, (m) => m.id)
    if (result.found) messages.splice(result.index, 1)
  }
  delete draft.part[input.messageID]
}

function setOptimisticAdd(setStore: (...args: unknown[]) => void, input: OptimisticAddInput) {
  setStore("message", input.sessionID, (messages: Message[] | undefined) => {
    if (!messages) return [input.message]
    const result = Binary.search(messages, input.message.id, (m) => m.id)
    const next = [...messages]
    next.splice(result.index, 0, input.message)
    return next
  })
  setStore("part", input.message.id, sortParts(input.parts))
}

function setOptimisticRemove(setStore: (...args: unknown[]) => void, input: OptimisticRemoveInput) {
  setStore("message", input.sessionID, (messages: Message[] | undefined) => {
    if (!messages) return messages
    const result = Binary.search(messages, input.messageID, (m) => m.id)
    if (!result.found) return messages
    const next = [...messages]
    next.splice(result.index, 1)
    return next
  })
  setStore("part", (part: Record<string, Part[] | undefined>) => {
    if (!(input.messageID in part)) return part
    const next = { ...part }
    delete next[input.messageID]
    return next
  })
}

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const globalSync = useGlobalSync()
    const sdk = useSDK()

    type Child = ReturnType<(typeof globalSync)["child"]>
    type Setter = Child[1]

    const current = createMemo(() => globalSync.child(sdk.directory))
    const target = (directory?: string) => {
      if (!directory || directory === sdk.directory) return current()
      return globalSync.child(directory)
    }
    const absolute = (path: string) => (current()[0].path.directory + "/" + path).replace("//", "/")
    const messageInitialSize = 50
    const messagePageSize = 400
    const inflight = new Map<string, Promise<void>>()
    const inflightDiff = new Map<string, Promise<void>>()
    const inflightTodo = new Map<string, Promise<void>>()
    const [meta, setMeta] = createStore({
      limit: {} as Record<string, number>,
      complete: {} as Record<string, boolean>,
      loading: {} as Record<string, boolean>,
    })

    const getSession = (sessionID: string) => {
      const store = current()[0]
      const match = Binary.search(store.session, sessionID, (s) => s.id)
      if (match.found) return store.session[match.index]
      return undefined
    }

    const fetchMessages = async (input: { client: typeof sdk.client; sessionID: string; limit: number }) => {
      const messages = await retry(() =>
        input.client.session.messages({ sessionID: input.sessionID, limit: input.limit }),
      )
      const items = (messages.data ?? []).filter((x) => !!x?.info?.id)
      const session = items
        .map((x) => x.info)
        .filter((m) => !!m?.id)
        .sort((a, b) => cmp(a.id, b.id))
      const part = items.map((message) => ({ id: message.info.id, part: sortParts(message.parts) }))
      return {
        session,
        part,
        complete: session.length < input.limit,
      }
    }

    const loadMessages = async (input: {
      directory: string
      client: typeof sdk.client
      setStore: Setter
      sessionID: string
      limit: number
      fresh?: boolean
    }) => {
      const key = keyFor(input.directory, input.sessionID)
      if (meta.loading[key]) return

      setMeta("loading", key, true)
      await fetchMessages(input)
        .then((next) => {
          // Phase 1: set messages + metadata (triggers timeline render)
          batch(() => {
            if (input.fresh) {
              input.setStore("message", input.sessionID, next.session)
            } else {
              input.setStore("message", input.sessionID, reconcile(next.session, { key: "id" }))
            }
            setMeta("limit", key, input.limit)
            setMeta("complete", key, next.complete)
          })

          // Phase 2: load parts in chunks with frame/task yielding so the UI can paint between batches
          const chunkSize = 50
          const parts = next.part
          const scheduler = typeof globalThis.requestAnimationFrame === "function"
            ? ("raf" as const)
            : ("timeout" as const)
          let i = 0
          const scheduleChunk = (task: () => void) => {
            const hidden = typeof globalThis.document !== "undefined" && globalThis.document.visibilityState === "hidden"
            if (scheduler === "raf" && !hidden) {
              globalThis.requestAnimationFrame(() => task())
              return
            }
            globalThis.setTimeout(task, 0)
          }
          const loadPartChunk = () => {
            batch(() => {
              const end = Math.min(i + chunkSize, parts.length)
              for (; i < end; i++) {
                input.setStore("part", parts[i].id, parts[i].part)
              }
            })
            if (i < parts.length) {
              scheduleChunk(loadPartChunk)
              return
            }
          }
          if (parts.length > 0) {
            scheduleChunk(loadPartChunk)
            return
          }
        })
        .finally(() => {
          setMeta("loading", key, false)
        })
    }

    return {
      get data() {
        return current()[0]
      },
      get set(): Setter {
        return current()[1]
      },
      get status() {
        return current()[0].status
      },
      get ready() {
        return current()[0].status !== "loading"
      },
      get project() {
        const store = current()[0]
        const match = Binary.search(globalSync.data.project, store.project, (p) => p.id)
        if (match.found) return globalSync.data.project[match.index]
        return undefined
      },
      session: {
        get: getSession,
        optimistic: {
          add(input: { directory?: string; sessionID: string; message: Message; parts: Part[] }) {
            const [, setStore] = target(input.directory)
            setOptimisticAdd(setStore as (...args: unknown[]) => void, input)
          },
          remove(input: { directory?: string; sessionID: string; messageID: string }) {
            const [, setStore] = target(input.directory)
            setOptimisticRemove(setStore as (...args: unknown[]) => void, input)
          },
        },
        addOptimisticMessage(input: {
          sessionID: string
          messageID: string
          parts: Part[]
          agent: string
          model: { providerID: string; modelID: string }
        }) {
          const message: Message = {
            id: input.messageID,
            sessionID: input.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: input.agent,
            model: input.model,
          }
          const [, setStore] = target()
          setOptimisticAdd(setStore as (...args: unknown[]) => void, {
            sessionID: input.sessionID,
            message,
            parts: input.parts,
          })
        },
        async sync(sessionID: string) {
          const directory = sdk.directory
          const client = sdk.client
          const [store, setStore] = globalSync.child(directory)
          const key = keyFor(directory, sessionID)
          const hasSession = (() => {
            const match = Binary.search(store.session, sessionID, (s) => s.id)
            return match.found
          })()

          const hasMessages = store.message[sessionID] !== undefined
          const hydrated = meta.limit[key] !== undefined
          if (hasSession && hasMessages && hydrated) return

          const cached = store.message[sessionID] ?? []
          const count = cached.length
          const hasParts = cached.every((message) => store.part[message.id] !== undefined)
          // "Warm" means we already have enough local messages + parts to render
          // immediately, so we can skip a blocking message fetch on switch.
          const warm = hasMessages && !hydrated && count >= messageInitialSize && hasParts
          const limit = hydrated
            ? (meta.limit[key] ?? messagePageSize)
            : warm
              ? Math.max(count, messageInitialSize)
              : messageInitialSize
          if (warm) {
            setMeta("limit", key, limit)
            setMeta("complete", key, count < messageInitialSize)
          }

          const sessionReq = hasSession
            ? Promise.resolve()
            : retry(() => client.session.get({ sessionID })).then((session) => {
                const data = session.data
                if (!data) return
                setStore(
                  "session",
                  produce((draft) => {
                    const match = Binary.search(draft, sessionID, (s) => s.id)
                    if (match.found) {
                      draft[match.index] = data
                      return
                    }
                    draft.splice(match.index, 0, data)
                  }),
                )
              })

          const messagesReq =
            hasMessages && (hydrated || warm)
              ? Promise.resolve()
              : loadMessages({
                  directory,
                  client,
                  setStore,
                  sessionID,
                  limit,
                  fresh: !hasMessages,
                })

          return runInflight(inflight, key, () => Promise.all([sessionReq, messagesReq]).then(() => {}))
        },
        async diff(sessionID: string) {
          const directory = sdk.directory
          const client = sdk.client
          const [store, setStore] = globalSync.child(directory)
          if (store.session_diff[sessionID] !== undefined) return

          const key = keyFor(directory, sessionID)
          return runInflight(inflightDiff, key, () =>
            retry(() => client.session.diff({ sessionID })).then((diff) => {
              const files = diff.data ?? []
              setStore("session_diff", sessionID, reconcile(files, { key: "file" }))
            }),
          )
        },
        async todo(sessionID: string) {
          const directory = sdk.directory
          const client = sdk.client
          const [store, setStore] = globalSync.child(directory)
          const key = keyFor(directory, sessionID)
          const existing = store.todo[sessionID]
          const cached = globalSync.data.session_todo[sessionID]
          if (existing !== undefined) {
            if (globalSync.data.session_todo[sessionID] === undefined) {
              globalSync.todo.set(sessionID, existing)
            }
            return
          }

          if (cached !== undefined) {
            setStore("todo", sessionID, reconcile(cached, { key: "id" }))
          }

          return runInflight(inflightTodo, key, () =>
            retry(() => client.session.todo({ sessionID })).then((todo) => {
              const list = todo.data ?? []
              setStore("todo", sessionID, reconcile(list, { key: "id" }))
              globalSync.todo.set(sessionID, list)
            }),
          )
        },
        history: {
          more(sessionID: string) {
            const store = current()[0]
            const key = keyFor(sdk.directory, sessionID)
            if (store.message[sessionID] === undefined) return false
            if (meta.limit[key] === undefined) return false
            if (meta.complete[key]) return false
            return true
          },
          loading(sessionID: string) {
            const key = keyFor(sdk.directory, sessionID)
            return meta.loading[key] ?? false
          },
          async loadMore(sessionID: string, count = messagePageSize) {
            const directory = sdk.directory
            const client = sdk.client
            const [, setStore] = globalSync.child(directory)
            const key = keyFor(directory, sessionID)
            if (meta.loading[key]) return
            if (meta.complete[key]) return

            const currentLimit = meta.limit[key] ?? messagePageSize
            const nextLimit = currentLimit + count
            await loadMessages({
              directory,
              client,
              setStore,
              sessionID,
              limit: nextLimit,
            })
          },
        },
        fetch: async (count = 10) => {
          const directory = sdk.directory
          const client = sdk.client
          const [store, setStore] = globalSync.child(directory)
          setStore("limit", (x) => x + count)
          await client.session.list().then((x) => {
            const sessions = (x.data ?? [])
              .filter((s) => !!s?.id)
              .sort((a, b) => cmp(a.id, b.id))
              .slice(0, store.limit)
            setStore("session", reconcile(sessions, { key: "id" }))
          })
        },
        more: createMemo(() => current()[0].session.length >= current()[0].limit),
        archive: async (sessionID: string) => {
          const directory = sdk.directory
          const client = sdk.client
          const [, setStore] = globalSync.child(directory)
          await client.session.update({ sessionID, time: { archived: Date.now() } })
          setStore(
            produce((draft) => {
              const match = Binary.search(draft.session, sessionID, (s) => s.id)
              if (match.found) draft.session.splice(match.index, 1)
            }),
          )
        },
      },
      absolute,
      get directory() {
        return current()[0].path.directory
      },
    }
  },
})

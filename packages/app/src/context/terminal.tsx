import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { batch, createMemo, createRoot, onCleanup } from "solid-js"
import { useParams } from "@solidjs/router"
import { useSDK } from "./sdk"
import { Persist, persisted } from "@/utils/persist"

export type LocalPTY = {
  id: string
  title: string
  titleNumber: number
  rows?: number
  cols?: number
  buffer?: string
  scrollY?: number
  status?: "running" | "error"
  retryCount?: number
  lastError?: {
    code?: string
    requestId?: string
    message?: string
  }
}

const WORKSPACE_KEY = "__workspace__"
const MAX_TERMINAL_SESSIONS = 20

type TerminalSession = ReturnType<typeof createTerminalSession>

type TerminalCacheEntry = {
  value: TerminalSession
  dispose: VoidFunction
}

type PtyErrorDetails = {
  code?: string
  requestId?: string
  message?: string
}

const getPtyErrorDetails = (error: unknown): PtyErrorDetails => {
  if (error && typeof error === "object") {
    const payload = error as Record<string, unknown>
    const code = typeof payload.code === "string" ? payload.code : undefined
    const requestId = typeof payload.requestId === "string" ? payload.requestId : undefined
    const message =
      typeof payload.error === "string"
        ? payload.error
        : typeof payload.message === "string"
          ? payload.message
          : undefined
    return { code, requestId, message }
  }
  if (typeof error === "string") {
    return { message: error }
  }
  if (error instanceof Error) {
    return { message: error.message }
  }
  return {}
}

function createTerminalSession(sdk: ReturnType<typeof useSDK>, dir: string, id: string | undefined) {
  const legacy = `${dir}/terminal${id ? "/" + id : ""}.v1`

  const [store, setStore, _, ready] = persisted(
    Persist.scoped(dir, id, "terminal", [legacy]),
    createStore<{
      active?: string
      all: LocalPTY[]
    }>({
      all: [],
    }),
  )

  const removeLocal = (id: string) => {
    batch(() => {
      const current = store.all
      const index = current.findIndex((item) => item.id === id)
      setStore(
        "all",
        current.filter((x) => x.id !== id),
      )
      if (store.active === id) {
        const next = index >= 0 ? current[index + 1] : undefined
        const previous = index > 0 ? current[index - 1] : undefined
        setStore("active", next?.id ?? previous?.id)
      }
    })
  }

  const markError = (id: string, details?: PtyErrorDetails) => {
    setStore("all", (items) =>
      items.map((item) =>
        item.id === id
          ? {
              ...item,
              status: "error",
              lastError: details,
            }
          : item,
      ),
    )
  }

  return {
    ready,
    all: createMemo(() => Object.values(store.all)),
    active: createMemo(() => store.active),
    removeLocal,
    markError,
    new() {
      const existingTitleNumbers = new Set(
        store.all.map((pty) => {
          const match = pty.titleNumber
          return match
        }),
      )

      let nextNumber = 1
      while (existingTitleNumbers.has(nextNumber)) {
        nextNumber++
      }

      sdk.client.pty
        .create({ title: `Terminal ${nextNumber}` })
        .then((pty) => {
          const id = pty.data?.id
          if (!id) return
          setStore("all", [
            ...store.all,
            {
              id,
              title: pty.data?.title ?? "Terminal",
              titleNumber: nextNumber,
              status: "running",
              retryCount: 0,
            },
          ])
          setStore("active", id)
        })
        .catch((e) => {
          const details = getPtyErrorDetails(e)
          console.error("Failed to create terminal", {
            error: details.message ?? e,
            code: details.code,
            requestId: details.requestId,
          })
        })
    },
    update(pty: Partial<LocalPTY> & { id: string }) {
      setStore("all", (x) => x.map((x) => (x.id === pty.id ? { ...x, ...pty } : x)))
      sdk.client.pty
        .update({
          ptyID: pty.id,
          title: pty.title,
          size: pty.cols && pty.rows ? { rows: pty.rows, cols: pty.cols } : undefined,
        })
        .catch((e) => {
          console.error("Failed to update terminal", e)
        })
    },
    async clone(id: string) {
      const index = store.all.findIndex((x) => x.id === id)
      const pty = store.all[index]
      if (!pty) return
      const clone = await sdk.client.pty
        .create({
          title: pty.title,
        })
        .catch((e) => {
          const details = getPtyErrorDetails(e)
          console.error("Failed to clone terminal", {
            error: details.message ?? e,
            code: details.code,
            requestId: details.requestId,
          })
          return undefined
        })
      if (!clone?.data) return
      setStore("all", index, {
        ...pty,
        ...clone.data,
        status: "running",
        lastError: undefined,
        retryCount: 0,
      })
      if (store.active === pty.id) {
        setStore("active", clone.data.id)
      }
    },
    async reconnect(id: string, details?: PtyErrorDetails) {
      const index = store.all.findIndex((x) => x.id === id)
      const pty = store.all[index]
      if (!pty) return

      const retryCount = pty.retryCount ?? 0
      if (retryCount >= 1) {
        setStore("all", index, {
          ...pty,
          status: "error",
          lastError: details,
          retryCount,
        })
        return
      }

      setStore("all", index, {
        ...pty,
        status: "error",
        lastError: details,
        retryCount: retryCount + 1,
      })

      const created = await sdk.client.pty
        .create({
          title: pty.title,
        })
        .catch((e) => {
          const errorDetails = getPtyErrorDetails(e)
          console.error("Failed to recover terminal", {
            error: errorDetails.message ?? e,
            code: errorDetails.code,
            requestId: errorDetails.requestId,
          })
          setStore("all", index, {
            ...pty,
            status: "error",
            lastError: errorDetails,
            retryCount: retryCount + 1,
          })
          return undefined
        })
      if (!created?.data) return

      setStore("all", index, {
        ...pty,
        ...created.data,
        status: "running",
        lastError: undefined,
        retryCount: 0,
      })
      if (store.active === pty.id) {
        setStore("active", created.data.id)
      }
    },
    open(id: string) {
      setStore("active", id)
    },
    async close(id: string) {
      removeLocal(id)
      await sdk.client.pty.remove({ ptyID: id }).catch((e) => {
        console.error("Failed to close terminal", e)
      })
    },
    closeLocal(id: string) {
      removeLocal(id)
    },
    move(id: string, to: number) {
      const index = store.all.findIndex((f) => f.id === id)
      if (index === -1) return
      setStore(
        "all",
        produce((all) => {
          all.splice(to, 0, all.splice(index, 1)[0])
        }),
      )
    },
  }
}

export const { use: useTerminal, provider: TerminalProvider } = createSimpleContext({
  name: "Terminal",
  gate: false,
  init: () => {
    const sdk = useSDK()
    const params = useParams()
    const cache = new Map<string, TerminalCacheEntry>()

    const disposeAll = () => {
      for (const entry of cache.values()) {
        entry.dispose()
      }
      cache.clear()
    }

    onCleanup(disposeAll)

    const prune = () => {
      while (cache.size > MAX_TERMINAL_SESSIONS) {
        const first = cache.keys().next().value
        if (!first) return
        const entry = cache.get(first)
        entry?.dispose()
        cache.delete(first)
      }
    }

    const load = (dir: string, id: string | undefined) => {
      const key = `${dir}:${id ?? WORKSPACE_KEY}`
      const existing = cache.get(key)
      if (existing) {
        cache.delete(key)
        cache.set(key, existing)
        return existing.value
      }

      const entry = createRoot((dispose) => ({
        value: createTerminalSession(sdk, dir, id),
        dispose,
      }))

      cache.set(key, entry)
      prune()
      return entry.value
    }

    const session = createMemo(() => load(params.dir!, params.id))

    const unsubscribe = sdk.event.listen((e) => {
      const event = e.details
      if (event.type !== "pty.exited" && event.type !== "pty.deleted") return
      const id = (event.properties as { id?: string }).id
      if (!id) return
      const existing = session().all().find((pty) => pty.id === id)
      if (!existing) return
      if (event.type === "pty.deleted") {
        session().removeLocal(id)
        return
      }
      if (event.type === "pty.exited") {
        session().markError(id, { code: "pty_closed", message: "Terminal session ended" })
      }
    })
    onCleanup(unsubscribe)

    return {
      ready: () => session().ready(),
      all: () => session().all(),
      active: () => session().active(),
      new: () => session().new(),
      update: (pty: Partial<LocalPTY> & { id: string }) => session().update(pty),
      clone: (id: string) => session().clone(id),
      reconnect: (id: string, details?: PtyErrorDetails) => session().reconnect(id, details),
      open: (id: string) => session().open(id),
      close: (id: string) => session().close(id),
      closeLocal: (id: string) => session().closeLocal(id),
      move: (id: string, to: number) => session().move(id, to),
    }
  },
})

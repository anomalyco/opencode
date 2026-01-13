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
}

const WORKSPACE_KEY = "__workspace__"
const MAX_TERMINAL_SESSIONS = 20

type TerminalSession = ReturnType<typeof createTerminalSession>

type TerminalCacheEntry = {
  value: TerminalSession
  dispose: VoidFunction
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

  return {
    ready,
    all: createMemo(() => Object.values(store.all)),
    active: createMemo(() => store.active),
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
            },
          ])
          setStore("active", id)
        })
        .catch((e) => {
          console.error("Failed to create terminal", e)
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
          console.error("Failed to clone terminal", e)
          return undefined
        })
      if (!clone?.data) return
      setStore("all", index, {
        ...pty,
        ...clone.data,
      })
      if (store.active === pty.id) {
        setStore("active", clone.data.id)
      }
    },
    open(id: string) {
      setStore("active", id)
    },
    async close(id: string) {
      batch(() => {
        setStore(
          "all",
          store.all.filter((x) => x.id !== id),
        )
        if (store.active === id) {
          const index = store.all.findIndex((f) => f.id === id)
          const previous = store.all[Math.max(0, index - 1)]
          setStore("active", previous?.id)
        }
      })
      await sdk.client.pty.remove({ ptyID: id }).catch((e) => {
        console.error("Failed to close terminal", e)
      })
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

    return {
      ready: () => session().ready(),
      all: () => session().all(),
      active: () => session().active(),
      new: () => session().new(),
      update: (pty: Partial<LocalPTY> & { id: string }) => session().update(pty),
      clone: (id: string) => session().clone(id),
      open: (id: string) => session().open(id),
      close: (id: string) => session().close(id),
      move: (id: string, to: number) => session().move(id, to),
    }
  },
})

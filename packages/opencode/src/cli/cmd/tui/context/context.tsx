import { createContext, createEffect, createSignal, onCleanup, useContext, type ParentProps } from "solid-js"
import path from "path"
import { mkdir } from "fs/promises"
import { useToast } from "../ui/toast"

export type ContextItem = {
  id: string
  name: string
  content: string
  active: boolean
  createdAt: number
}

type ContextState = {
  contexts: () => ContextItem[]
  selectedContexts: () => ContextItem[]
  activeContextIds: () => Set<string>
  selectedTokenCount: () => number
  addContext: (input: { name: string; content: string }) => string
  updateContext: (id: string, updater: (ctx: ContextItem) => ContextItem) => void
  toggleContext: (id: string) => void
  reload: () => Promise<void>
}

const ContextManager = createContext<ContextState | undefined>()

export function useContextManager(optional = false) {
  const ctx = useContext(ContextManager)
  if (!ctx && !optional) {
    throw new Error("useContextManager must be used within a ContextProvider")
  }
  return ctx
}

const estimateTokens = (value: string) => Math.ceil(value.trim().length / 4)
const persistDelay = 250

export function ContextProvider(props: ParentProps<{ sessionID: string }>) {
  const toast = useToast()
  const [contexts, setContexts] = createSignal<ContextItem[]>([])
  const [activeIds, setActiveIds] = createSignal<Set<string>>(new Set())
  const filePathFor = (sessionID: string) => path.join(process.cwd(), ".opencode", "context", `${sessionID}.json`)
  let persistTimer: ReturnType<typeof setTimeout> | undefined
  let lastSessionID: string | undefined

  const persist = async (sessionID: string, items: ContextItem[]) => {
    try {
      const targetDir = path.dirname(filePathFor(sessionID))
      await mkdir(targetDir, { recursive: true })
      await Bun.write(filePathFor(sessionID), JSON.stringify(items, null, 2))
    } catch (error) {
      console.error("[ContextProvider] Failed to persist contexts", error)
      toast.show({ variant: "error", message: "Failed to save contexts" })
    }
  }

  const schedulePersist = (sessionID: string, items: ContextItem[]) => {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = undefined
      void persist(sessionID, items)
    }, persistDelay)
  }

  const hydrate = async (sessionID: string) => {
    try {
      const file = Bun.file(filePathFor(sessionID))
      if (!(await file.exists())) {
        if (sessionID !== props.sessionID) return
        setContexts([])
        setActiveIds(new Set())
        return
      }
      const data = (await file.json()) as Array<Omit<ContextItem, "createdAt" | "active"> & { active?: boolean; createdAt?: number }>
      const normalized = data.map((item) => ({
        id: item.id,
        name: item.name,
        content: item.content ?? "",
        active: item.active !== false,
        createdAt: item.createdAt ?? Date.now(),
      }))
      if (sessionID !== props.sessionID) return
      setContexts(normalized)
      setActiveIds(new Set(normalized.filter((ctx) => ctx.active).map((ctx) => ctx.id)))
    } catch (error) {
      console.error("[ContextProvider] Failed to load contexts", error)
      toast.show({ variant: "error", message: "Failed to load contexts" })
      setContexts([])
      setActiveIds(new Set())
    }
  }

  createEffect(() => {
    const sessionID = props.sessionID
    if (!sessionID) return
    if (lastSessionID && lastSessionID !== sessionID) {
      const snapshot = contexts()
      if (persistTimer) {
        clearTimeout(persistTimer)
        persistTimer = undefined
      }
      void persist(lastSessionID, snapshot)
    }
    lastSessionID = sessionID
    setContexts([])
    setActiveIds(new Set())
    void hydrate(sessionID)
  })

  onCleanup(() => {
    const sessionID = props.sessionID
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = undefined
      if (sessionID) void persist(sessionID, contexts())
    } else if (sessionID) {
      void persist(sessionID, contexts())
    }
  })

  const updateContexts = (updater: (prev: ContextItem[]) => ContextItem[]) => {
    const sessionID = props.sessionID
    if (!sessionID) return
    setContexts((prev) => {
      const next = updater(prev)
      schedulePersist(sessionID, next)
      setActiveIds(new Set(next.filter((ctx) => ctx.active).map((ctx) => ctx.id)))
      return next
    })
  }

  const addContext = (input: { name: string; content: string }) => {
    const newId = `ctx_${Date.now()}`
    updateContexts((prev) => [
      ...prev,
      {
        id: newId,
        name: input.name,
        content: input.content,
        active: true,
        createdAt: Date.now(),
      },
    ])
    return newId
  }

  const updateContext = (id: string, updater: (ctx: ContextItem) => ContextItem) => {
    updateContexts((prev) => prev.map((ctx) => (ctx.id === id ? updater(ctx) : ctx)))
  }

  const toggleContext = (id: string) => {
    updateContexts((prev) =>
      prev.map((ctx) => {
        if (ctx.id !== id) return ctx
        return { ...ctx, active: !ctx.active }
      }),
    )
  }

  const value: ContextState = {
    contexts,
    selectedContexts: () => contexts().filter((ctx) => ctx.active),
    activeContextIds: activeIds,
    selectedTokenCount: () => contexts().filter((ctx) => ctx.active).reduce((sum, ctx) => sum + estimateTokens(ctx.content), 0),
    addContext,
    updateContext,
    toggleContext,
    reload: hydrate,
  }

  return <ContextManager.Provider value={value}>{props.children}</ContextManager.Provider>
}

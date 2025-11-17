import { createContext, createEffect, createSignal, onCleanup, useContext, type ParentProps } from "solid-js"
import path from "path"
import { mkdir } from "fs/promises"
import { useToast } from "../ui/toast"

export type ContextMode = "manual" | "always" | "conditional"
type ContextSource =
  | {
      type: "message"
      sessionID: string
      messageID: string
    }

export type ContextItem = {
  id: string
  name: string
  content: string
  active: boolean
  createdAt: number
  mode: ContextMode
  source?: ContextSource
  lastUsedAt?: number
  engagement?: number
}

type ContextState = {
  contexts: () => ContextItem[]
  selectedContexts: () => ContextItem[]
  activeContextIds: () => Set<string>
  selectedTokenCount: () => number
  addContext: (input: { name: string; content: string }) => string
  updateContext: (id: string, updater: (ctx: ContextItem) => ContextItem) => void
  toggleContext: (id: string) => void
  markUsed: (ids: string[]) => void
  upsertMessageContext: (input: { sessionID: string; messageID: string; name: string; content: string; mode: Exclude<ContextMode, "manual">; active?: boolean }) => void
  setMessageContextActive: (input: { sessionID: string; messageID: string; active: boolean }) => void
  removeMessageContext: (input: { sessionID: string; messageID: string }) => void
  reload: () => Promise<void>
}

const ContextManager = createContext<ContextState | undefined>()

export function useContextManager(): ContextState
export function useContextManager(optional: true): ContextState | undefined
export function useContextManager(optional = false) {
  const ctx = useContext(ContextManager)
  if (!ctx) {
    if (optional) return undefined
    throw new Error("useContextManager must be used within a ContextProvider")
  }
  return ctx
}

const estimateTokens = (value: string) => Math.ceil(value.trim().length / 4)
const persistDelay = 250

export function ContextProvider(props: ParentProps<{ sessionID: string }>) {
  const toast = useToast()
  const [contexts, setContexts] = createSignal<ContextItem[]>([])
  const [activeIds, setActiveIds] = createSignal<Set<string>>(new Set<string>())
  const collectActiveIds = (items: ContextItem[]) => new Set<string>(items.filter((ctx) => ctx.active).map((ctx) => ctx.id))
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
        setActiveIds(new Set<string>())
        return
      }
      const data = (await file.json()) as Array<
        Omit<ContextItem, "createdAt" | "active" | "mode"> & { active?: boolean; createdAt?: number; mode?: ContextMode }
      >
      const normalized = data.map((item) => ({
        id: item.id,
        name: item.name,
        content: item.content ?? "",
        active: item.active !== false,
        createdAt: item.createdAt ?? Date.now(),
        mode: item.mode ?? "manual",
        source: item.source,
        lastUsedAt: item.lastUsedAt,
      }))
      if (sessionID !== props.sessionID) return
      setContexts(normalized)
      setActiveIds(collectActiveIds(normalized))
    } catch (error) {
      console.error("[ContextProvider] Failed to load contexts", error)
      toast.show({ variant: "error", message: "Failed to load contexts" })
      setContexts([])
      setActiveIds(new Set<string>())
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
    setActiveIds(new Set<string>())
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

  const applyUpdate = (sessionID: string | undefined, updater: (prev: ContextItem[]) => ContextItem[]) => {
    if (!sessionID) return
    setContexts((prev) => {
      const next = updater(prev)
      schedulePersist(sessionID, next)
      setActiveIds(collectActiveIds(next))
      return next
    })
  }

  const addContext = (input: { name: string; content: string }) => {
    const sessionID = props.sessionID
    if (!sessionID) return ""
    const newId = `ctx_${Date.now()}`
    applyUpdate(sessionID, (prev) => [
      ...prev,
      {
        id: newId,
        name: input.name,
        content: input.content,
        active: true,
        createdAt: Date.now(),
        mode: "manual",
        engagement: 0,
      },
    ])
    return newId
  }

  const updateContext = (id: string, updater: (ctx: ContextItem) => ContextItem) => {
    applyUpdate(props.sessionID, (prev) => prev.map((ctx) => (ctx.id === id ? updater(ctx) : ctx)))
  }

  const toggleContext = (id: string) => {
    applyUpdate(props.sessionID, (prev) =>
      prev.map((ctx) => {
        if (ctx.id !== id) return ctx
        return { ...ctx, active: !ctx.active }
      }),
    )
  }

  const markUsed = (ids: string[]) => {
    if (!ids.length) return
    const selected = new Set(ids)
    applyUpdate(props.sessionID, (prev) =>
      prev.map((ctx) => {
        if (selected.has(ctx.id)) {
          const next = (ctx.engagement ?? 0) + 1
          if (ctx.mode === "conditional" && next >= 3) {
            return { ...ctx, mode: "always", active: true, engagement: next, lastUsedAt: Date.now(), promotedAt: Date.now() }
          }
          return { ...ctx, engagement: next, lastUsedAt: Date.now() }
        }
        if (ctx.mode === "conditional" && ctx.lastUsedAt !== undefined) {
          const penalty = Math.max((ctx.engagement ?? 0) - 1, 0)
          if (penalty === 0) {
            return { ...ctx, lastUsedAt: undefined, engagement: 0, active: false }
          }
          return { ...ctx, lastUsedAt: undefined, engagement: penalty }
        }
        return ctx
      }),
    )
  }

  const upsertMessageContext = (input: {
    sessionID: string
    messageID: string
    name: string
    content: string
    mode: Exclude<ContextMode, "manual">
    active?: boolean
  }) => {
    if (props.sessionID !== input.sessionID) return
    const newId = `ctx_msg_${input.messageID}`
    applyUpdate(input.sessionID, (prev) => {
      const next = [...prev]
      const index = next.findIndex(
        (ctx) => ctx.source?.type === "message" && ctx.source.messageID === input.messageID && ctx.source.sessionID === input.sessionID,
      )
      const base = index >= 0 ? next[index] : undefined
      const nextActive =
        input.active ??
        (input.mode === "conditional" ? true : base?.active ?? true)
      const item: ContextItem = {
        id: base?.id ?? newId,
        name: input.name,
        content: input.content,
        active: nextActive,
        createdAt: base?.createdAt ?? Date.now(),
        mode: input.mode,
        source: { type: "message", sessionID: input.sessionID, messageID: input.messageID },
        lastUsedAt: base?.lastUsedAt,
        engagement: base?.engagement ?? 0,
      }
      if (index >= 0) next[index] = item
      else next.push(item)
      return next
    })
  }

  const setMessageContextActive = (input: { sessionID: string; messageID: string; active: boolean }) => {
    if (props.sessionID !== input.sessionID) return
    applyUpdate(input.sessionID, (prev) =>
      prev.map((ctx) => {
        if (ctx.source?.type === "message" && ctx.source.messageID === input.messageID && ctx.source.sessionID === input.sessionID) {
          return { ...ctx, active: input.active }
        }
        return ctx
      }),
    )
  }

  const removeMessageContext = (input: { sessionID: string; messageID: string }) => {
    if (props.sessionID !== input.sessionID) return
    applyUpdate(input.sessionID, (prev) =>
      prev.filter((ctx) => !(ctx.source?.type === "message" && ctx.source.messageID === input.messageID && ctx.source.sessionID === input.sessionID)),
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
    markUsed,
    upsertMessageContext,
    setMessageContextActive,
    removeMessageContext,
    reload: () => (props.sessionID ? hydrate(props.sessionID) : Promise.resolve()),
  }

  return <ContextManager.Provider value={value}>{props.children}</ContextManager.Provider>
}

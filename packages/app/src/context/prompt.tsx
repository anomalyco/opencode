import { createStore, type SetStoreFunction } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { batch, createEffect, createMemo, createRoot, onCleanup } from "solid-js"
import { useParams } from "@solidjs/router"
import type { FileSelection } from "@/context/file"
import { Persist, persisted } from "@/utils/persist"
import { checksum } from "@opencode-ai/util/encode"

interface PartBase {
  content: string
  start: number
  end: number
}

export interface TextPart extends PartBase {
  type: "text"
}

export interface FileAttachmentPart extends PartBase {
  type: "file"
  path: string
  selection?: FileSelection
}

export interface AgentPart extends PartBase {
  type: "agent"
  name: string
}

export interface ImageAttachmentPart {
  type: "image"
  id: string
  filename: string
  mime: string
  dataUrl: string
}

export type ContentPart = TextPart | FileAttachmentPart | AgentPart | ImageAttachmentPart
export type Prompt = ContentPart[]

export type FileContextItem = {
  type: "file"
  path: string
  selection?: FileSelection
  comment?: string
  commentID?: string
  commentOrigin?: "review" | "file"
  preview?: string
}

export type ContextItem = FileContextItem

export const DEFAULT_PROMPT: Prompt = [{ type: "text", content: "", start: 0, end: 0 }]

function isSelectionEqual(a?: FileSelection, b?: FileSelection) {
  if (!a && !b) return true
  if (!a || !b) return false
  return (
    a.startLine === b.startLine && a.startChar === b.startChar && a.endLine === b.endLine && a.endChar === b.endChar
  )
}

function isPartEqual(partA: ContentPart, partB: ContentPart) {
  switch (partA.type) {
    case "text":
      return partB.type === "text" && partA.content === partB.content
    case "file":
      return partB.type === "file" && partA.path === partB.path && isSelectionEqual(partA.selection, partB.selection)
    case "agent":
      return partB.type === "agent" && partA.name === partB.name
    case "image":
      return partB.type === "image" && partA.id === partB.id
  }
}

export function isPromptEqual(promptA: Prompt, promptB: Prompt): boolean {
  if (promptA.length !== promptB.length) return false
  for (let i = 0; i < promptA.length; i++) {
    if (!isPartEqual(promptA[i], promptB[i])) return false
  }
  return true
}

function cloneSelection(selection?: FileSelection) {
  if (!selection) return undefined
  return { ...selection }
}

function clonePart(part: ContentPart): ContentPart {
  if (part.type === "text") return { ...part }
  if (part.type === "image") return { ...part }
  if (part.type === "agent") return { ...part }
  return {
    ...part,
    selection: cloneSelection(part.selection),
  }
}

function clonePrompt(prompt: Prompt): Prompt {
  return prompt.map(clonePart)
}

function contextItemKey(item: ContextItem) {
  if (item.type !== "file") return item.type
  const start = item.selection?.startLine
  const end = item.selection?.endLine
  const key = `${item.type}:${item.path}:${start}:${end}`

  if (item.commentID) {
    return `${key}:c=${item.commentID}`
  }

  const comment = item.comment?.trim()
  if (!comment) return key
  const digest = checksum(comment) ?? comment
  return `${key}:c=${digest.slice(0, 8)}`
}

function createPromptActions(input: {
  draft: {
    prompt: Prompt
    cursor?: number
  }
  setDraft: SetStoreFunction<{
    prompt: Prompt
    cursor?: number
  }>
  schedule: VoidFunction
}) {
  return {
    set(prompt: Prompt, cursorPosition?: number) {
      const samePrompt = isPromptEqual(input.draft.prompt, prompt)
      const sameCursor = cursorPosition === undefined || input.draft.cursor === cursorPosition
      if (samePrompt && sameCursor) return

      const next = samePrompt ? input.draft.prompt : clonePrompt(prompt)
      batch(() => {
        if (!samePrompt) input.setDraft("prompt", next)
        if (cursorPosition !== undefined && input.draft.cursor !== cursorPosition)
          input.setDraft("cursor", cursorPosition)
      })
      input.schedule()
    },
    reset() {
      const samePrompt = isPromptEqual(input.draft.prompt, DEFAULT_PROMPT)
      const sameCursor = input.draft.cursor === 0
      if (samePrompt && sameCursor) return

      batch(() => {
        input.setDraft("prompt", clonePrompt(DEFAULT_PROMPT))
        input.setDraft("cursor", 0)
      })
      input.schedule()
    },
  }
}

const PERSIST_DEBOUNCE_MS = 250

const WORKSPACE_KEY = "__workspace__"
const MAX_PROMPT_SESSIONS = 20

type PromptSession = ReturnType<typeof createPromptSession>

type PromptCacheEntry = {
  value: PromptSession
  dispose: VoidFunction
}

function createPromptSession(dir: string, id: string | undefined) {
  const legacy = `${dir}/prompt${id ? "/" + id : ""}.v2`

  const [store, setStore, _, ready] = persisted(
    Persist.scoped(dir, id, "prompt", [legacy]),
    createStore<{
      prompt: Prompt
      cursor?: number
      context: {
        items: (ContextItem & { key: string })[]
      }
    }>({
      prompt: clonePrompt(DEFAULT_PROMPT),
      cursor: undefined,
      context: {
        items: [],
      },
    }),
  )

  const [draft, setDraft] = createStore<{
    prompt: Prompt
    cursor?: number
  }>({
    prompt: clonePrompt(store.prompt),
    cursor: store.cursor,
  })

  const persistState = {
    dirty: false,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    idle: undefined as number | undefined,
  }

  const flush = () => {
    const timer = persistState.timer
    if (timer) {
      clearTimeout(timer)
      persistState.timer = undefined
    }

    const idle = persistState.idle
    if (idle !== undefined) {
      if (typeof globalThis.cancelIdleCallback === "function") {
        globalThis.cancelIdleCallback(idle)
      }
      persistState.idle = undefined
    }

    if (!persistState.dirty) return
    persistState.dirty = false

    if (isPromptEqual(store.prompt, draft.prompt) && store.cursor === draft.cursor) return
    const next = clonePrompt(draft.prompt)
    batch(() => {
      setStore("prompt", next)
      setStore("cursor", draft.cursor)
    })
  }

  const schedule = () => {
    persistState.dirty = true
    if (persistState.timer || persistState.idle !== undefined) return

    persistState.timer = setTimeout(() => {
      persistState.timer = undefined

      if (typeof globalThis.requestIdleCallback !== "function") {
        flush()
        return
      }

      persistState.idle = globalThis.requestIdleCallback(
        () => {
          persistState.idle = undefined
          flush()
        },
        { timeout: PERSIST_DEBOUNCE_MS },
      )
    }, PERSIST_DEBOUNCE_MS)
  }

  createEffect(() => {
    if (!ready()) return
    if (persistState.dirty) return
    if (isPromptEqual(draft.prompt, store.prompt) && draft.cursor === store.cursor) return

    batch(() => {
      setDraft("prompt", clonePrompt(store.prompt))
      setDraft("cursor", store.cursor)
    })
  })

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    const handlePagehide = () => flush()
    const handleVisibility = () => {
      if (document.visibilityState !== "hidden") return
      flush()
    }

    window.addEventListener("pagehide", handlePagehide)
    document.addEventListener("visibilitychange", handleVisibility)

    onCleanup(() => {
      window.removeEventListener("pagehide", handlePagehide)
      document.removeEventListener("visibilitychange", handleVisibility)
    })
  }

  onCleanup(() => flush())

  const actions = createPromptActions({
    draft,
    setDraft,
    schedule,
  })

  return {
    ready,
    current: createMemo(() => draft.prompt),
    cursor: createMemo(() => draft.cursor),
    dirty: createMemo(() => !isPromptEqual(draft.prompt, DEFAULT_PROMPT)),
    context: {
      items: createMemo(() => store.context.items),
      add(item: ContextItem) {
        const key = contextItemKey(item)
        if (store.context.items.find((x) => x.key === key)) return
        setStore("context", "items", (items) => [...items, { key, ...item }])
      },
      remove(key: string) {
        setStore("context", "items", (items) => items.filter((x) => x.key !== key))
      },
    },
    set: actions.set,
    reset: actions.reset,
  }
}

export const { use: usePrompt, provider: PromptProvider } = createSimpleContext({
  name: "Prompt",
  gate: false,
  init: () => {
    const params = useParams()
    const cache = new Map<string, PromptCacheEntry>()

    const disposeAll = () => {
      for (const entry of cache.values()) {
        entry.dispose()
      }
      cache.clear()
    }

    onCleanup(disposeAll)

    const prune = () => {
      while (cache.size > MAX_PROMPT_SESSIONS) {
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
        value: createPromptSession(dir, id),
        dispose,
      }))

      cache.set(key, entry)
      prune()
      return entry.value
    }

    const session = createMemo(() => load(params.dir!, params.id))

    return {
      ready: () => session().ready(),
      current: () => session().current(),
      cursor: () => session().cursor(),
      dirty: () => session().dirty(),
      context: {
        items: () => session().context.items(),
        add: (item: ContextItem) => session().context.add(item),
        remove: (key: string) => session().context.remove(key),
      },
      set: (prompt: Prompt, cursorPosition?: number) => session().set(prompt, cursorPosition),
      reset: () => session().reset(),
    }
  },
})

import { createStore, type SetStoreFunction } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { batch, createEffect, createMemo, createRoot, createSignal, onCleanup, untrack } from "solid-js"
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

type State = {
  prompt: Prompt
  cursor?: number
  context: {
    items: (ContextItem & { key: string })[]
  }
}

type Pics = {
  synced: boolean
  items: ImageAttachmentPart[]
}

export const DEFAULT_PROMPT: Prompt = [{ type: "text", content: "", start: 0, end: 0 }]

const PROMPT_SYNC_MS = 250

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

function cloneContextItem(item: ContextItem & { key: string }) {
  return {
    ...item,
    selection: cloneSelection(item.selection),
  }
}

function cloneContextItems(items: (ContextItem & { key: string })[]) {
  return items.map(cloneContextItem)
}

function cloneImages(items: ImageAttachmentPart[]) {
  return items.map((item) => ({ ...item }))
}

function sameImages(a: ImageAttachmentPart[], b: ImageAttachmentPart[]) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x.id !== y.id) return false
    if (x.filename !== y.filename) return false
    if (x.mime !== y.mime) return false
    if (x.dataUrl !== y.dataUrl) return false
  }
  return true
}

function sameContext(a: (ContextItem & { key: string })[], b: (ContextItem & { key: string })[]) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x.key !== y.key) return false
    if (x.type !== y.type) return false
    if (x.path !== y.path) return false
    if (x.comment !== y.comment) return false
    if (x.commentID !== y.commentID) return false
    if (x.commentOrigin !== y.commentOrigin) return false
    if (x.preview !== y.preview) return false
    if (!isSelectionEqual(x.selection, y.selection)) return false
  }
  return true
}

function stripImages(prompt: Prompt): Prompt {
  return prompt.filter((part) => part.type !== "image")
}

function pickImages(prompt: Prompt): ImageAttachmentPart[] {
  return prompt.filter((part): part is ImageAttachmentPart => part.type === "image")
}

function state(): State {
  return {
    prompt: clonePrompt(DEFAULT_PROMPT),
    cursor: undefined,
    context: {
      items: [],
    },
  }
}

function images(): Pics {
  return {
    synced: false,
    items: [],
  }
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

function isCommentItem(item: ContextItem | (ContextItem & { key: string })) {
  return item.type === "file" && !!item.comment?.trim()
}

function createPromptActions(setStore: SetStoreFunction<State>) {
  return {
    set(prompt: Prompt, cursorPosition?: number) {
      const next = clonePrompt(prompt)
      batch(() => {
        setStore("prompt", next)
        if (cursorPosition !== undefined) setStore("cursor", cursorPosition)
      })
    },
    reset() {
      batch(() => {
        setStore("prompt", clonePrompt(DEFAULT_PROMPT))
        setStore("cursor", 0)
      })
    },
  }
}

const WORKSPACE_KEY = "__workspace__"
const MAX_PROMPT_SESSIONS = 20

type PromptSession = ReturnType<typeof createPromptSession>

type PromptCacheEntry = {
  value: PromptSession
  dispose: VoidFunction
}

function createPromptSession(dir: string, id: string | undefined) {
  const legacy = `${dir}/prompt${id ? "/" + id : ""}.v2`

  const [draft, setDraft, , draftReady] = persisted(Persist.scoped(dir, id, "prompt", [legacy]), createStore(state()))

  const [pics, setPics, , picsReady] = persisted(Persist.scoped(dir, id, "prompt-image"), createStore(images()))

  const [store, setStore] = createStore(state())
  const [hydrated, setHydrated] = createSignal(false)

  const prompt = createMemo(() => stripImages(store.prompt), clonePrompt(DEFAULT_PROMPT), {
    equals: isPromptEqual,
  })
  const picsList = createMemo(() => pickImages(store.prompt), [] as ImageAttachmentPart[], {
    equals: sameImages,
  })
  const ready = createMemo(() => hydrated() && draftReady() && picsReady())

  let promptt: ReturnType<typeof setTimeout> | undefined
  let pict: ReturnType<typeof setTimeout> | undefined

  const clear = () => {
    if (promptt !== undefined) clearTimeout(promptt)
    if (pict !== undefined) clearTimeout(pict)
  }

  onCleanup(clear)

  createEffect(() => {
    if (!draftReady() || !picsReady()) return
    if (hydrated()) return

    const base = stripImages(draft.prompt)
    const legacyPics = pickImages(draft.prompt)
    const nextPics = pics.synced || pics.items.length > 0 ? pics.items : legacyPics

    batch(() => {
      setStore({
        prompt: clonePrompt([...base, ...nextPics]),
        cursor: draft.cursor,
        context: {
          items: cloneContextItems(draft.context.items),
        },
      })
      setHydrated(true)
    })

    if (!pics.synced && legacyPics.length > 0) {
      setPics({ synced: true, items: cloneImages(legacyPics) })
    }
  })

  createEffect(() => {
    if (!hydrated()) return
    prompt()
    store.cursor
    store.context.items
    if (promptt !== undefined) clearTimeout(promptt)

    promptt = setTimeout(() => {
      promptt = undefined
      const next = clonePrompt(prompt())
      const items = cloneContextItems(store.context.items)
      const samePrompt = isPromptEqual(stripImages(untrack(() => draft.prompt)), next)
      const sameCursor = untrack(() => draft.cursor) === store.cursor
      const sameItems = sameContext(
        untrack(() => draft.context.items),
        items,
      )
      if (samePrompt && sameCursor && sameItems) return

      batch(() => {
        setDraft("prompt", next)
        setDraft("cursor", store.cursor)
        setDraft("context", "items", items)
      })
    }, PROMPT_SYNC_MS)
  })

  createEffect(() => {
    if (!hydrated()) return
    picsList()
    if (pict !== undefined) clearTimeout(pict)

    pict = setTimeout(() => {
      pict = undefined
      const next = cloneImages(picsList())
      if (
        sameImages(
          untrack(() => pics.items),
          next,
        )
      )
        if (untrack(() => pics.synced)) return
      setPics({ synced: true, items: next })
    }, PROMPT_SYNC_MS)
  })

  const actions = createPromptActions(setStore)

  return {
    ready,
    current: createMemo(() => store.prompt),
    cursor: createMemo(() => store.cursor),
    dirty: createMemo(() => !isPromptEqual(store.prompt, DEFAULT_PROMPT)),
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
      removeComment(path: string, commentID: string) {
        setStore("context", "items", (items) =>
          items.filter((item) => !(item.type === "file" && item.path === path && item.commentID === commentID)),
        )
      },
      updateComment(path: string, commentID: string, next: Partial<FileContextItem> & { comment?: string }) {
        setStore("context", "items", (items) =>
          items.map((item) => {
            if (item.type !== "file" || item.path !== path || item.commentID !== commentID) return item
            const value = { ...item, ...next }
            return { ...value, key: contextItemKey(value) }
          }),
        )
      },
      replaceComments(items: FileContextItem[]) {
        setStore("context", "items", (current) => [
          ...current.filter((item) => !isCommentItem(item)),
          ...items.map((item) => ({ ...item, key: contextItemKey(item) })),
        ])
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
        removeComment: (path: string, commentID: string) => session().context.removeComment(path, commentID),
        updateComment: (path: string, commentID: string, next: Partial<FileContextItem> & { comment?: string }) =>
          session().context.updateComment(path, commentID, next),
        replaceComments: (items: FileContextItem[]) => session().context.replaceComments(items),
      },
      set: (prompt: Prompt, cursorPosition?: number) => session().set(prompt, cursorPosition),
      reset: () => session().reset(),
    }
  },
})

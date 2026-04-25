import { createSimpleContext } from "@opencode-ai/ui/context"
import { checksum } from "@opencode-ai/util/encode"
import { useParams } from "@solidjs/router"
import { batch, createMemo, createRoot, getOwner, onCleanup } from "solid-js"
import { createStore, type SetStoreFunction, type Store } from "solid-js/store"
import type { Message } from "@opencode-ai/sdk/v2/client"
import type { FileSelection } from "@/context/file"
import { Persist, persisted } from "@/utils/persist"

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

type ContextBase = {
  comment?: string
  preview?: string
}

export type FileContextItem = ContextBase & {
  type: "file"
  path: string
  selection?: FileSelection
  commentID?: string
  commentOrigin?: "review" | "file"
}

export type MessageContextItem = ContextBase & {
  type: "message"
  annotationID: string
  messageID: string
  role: Message["role"]
  quote: string
}

type MessageValue = MessageContextItem & {
  path: never
  selection?: never
  commentID?: never
  commentOrigin?: never
}

export type ContextItem =
  | (FileContextItem & {
      annotationID?: never
      messageID?: never
      role?: never
      quote?: never
    })
  | MessageValue

type ContextInput = FileContextItem | MessageContextItem
type ContextEntry = ContextItem & { key: string }
type PromptStore = {
  prompt: Prompt
  cursor?: number
  context: {
    items: ContextEntry[]
  }
}

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

function asContext(item: ContextInput): ContextItem {
  return item as ContextItem
}

function withKey(item: ContextInput): ContextEntry {
  const value = asContext(item)
  return { ...value, key: contextItemKey(value) }
}

function isFileItem(item: ContextInput | ContextEntry): item is FileContextItem | (FileContextItem & { key: string }) {
  return item.type === "file"
}

function isMessageItem(
  item: ContextInput | ContextEntry,
): item is MessageContextItem | (MessageContextItem & { key: string }) {
  return item.type === "message"
}

function contextItemKey(item: ContextInput | ContextEntry) {
  if (isMessageItem(item)) return `message:${item.annotationID}`
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
  return !!item.comment?.trim()
}

function isFileCommentItem(item: ContextInput | ContextEntry) {
  return isFileItem(item) && isCommentItem(item)
}

function createPromptActions(setStore: SetStoreFunction<PromptStore>) {
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

function createPromptSessionState(store: Store<PromptStore>, setStore: SetStoreFunction<PromptStore>) {
  const actions = createPromptActions(setStore)

  return {
    current: () => store.prompt,
    cursor: () => store.cursor,
    dirty: () => !isPromptEqual(store.prompt, DEFAULT_PROMPT),
    context: {
      items: () => store.context.items,
      add(item: ContextInput) {
        const key = contextItemKey(item)
        if (store.context.items.find((x) => x.key === key)) return
        setStore("context", "items", (items) => [...items, withKey(item)])
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
      removeMessage(annotationID: string) {
        setStore("context", "items", (items) =>
          items.filter((item) => !(item.type === "message" && item.annotationID === annotationID)),
        )
      },
      updateMessage(annotationID: string, next: Omit<Partial<MessageContextItem>, "annotationID" | "type">) {
        setStore("context", "items", (items) =>
          items.map((item) => {
            if (item.type !== "message" || item.annotationID !== annotationID) return item
            const value = { ...item, ...next }
            return { ...value, key: contextItemKey(value) }
          }),
        )
      },
      replaceComments(items: FileContextItem[]) {
        setStore("context", "items", (current) => [
          ...current.filter((item) => !isFileCommentItem(item)),
          ...items.map(withKey),
        ])
      },
      replaceMessages(items: MessageContextItem[]) {
        setStore("context", "items", (current) => [
          ...current.filter((item) => !isMessageItem(item)),
          ...items.map(withKey),
        ])
      },
    },
    set: actions.set,
    reset: actions.reset,
  }
}

export function createPromptSessionForTest(
  input: {
    prompt?: Prompt
    cursor?: number
    items?: (FileContextItem | MessageContextItem)[]
  } = {},
) {
  const [store, setStore] = createStore<PromptStore>({
    prompt: clonePrompt(input.prompt ?? DEFAULT_PROMPT),
    cursor: input.cursor,
    context: {
      items: (input.items ?? []).map(withKey),
    },
  })

  return createPromptSessionState(store, setStore)
}

const WORKSPACE_KEY = "__workspace__"
const MAX_PROMPT_SESSIONS = 20

type PromptSession = ReturnType<typeof createPromptSession>

type Scope = {
  dir: string
  id?: string
}

type PromptCacheEntry = {
  value: PromptSession
  dispose: VoidFunction
}

function createPromptSession(dir: string, id: string | undefined) {
  const legacy = `${dir}/prompt${id ? "/" + id : ""}.v2`

  const [store, setStore, _, ready] = persisted(
    Persist.scoped(dir, id, "prompt", [legacy]),
    createStore<PromptStore>({
      prompt: clonePrompt(DEFAULT_PROMPT),
      cursor: undefined,
      context: {
        items: [],
      },
    }),
  )
  const session = createPromptSessionState(store, setStore)

  return {
    ready,
    current: session.current,
    cursor: session.cursor,
    dirty: session.dirty,
    context: session.context,
    set: session.set,
    reset: session.reset,
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

    const owner = getOwner()
    const load = (dir: string, id: string | undefined) => {
      const key = `${dir}:${id ?? WORKSPACE_KEY}`
      const existing = cache.get(key)
      if (existing) {
        cache.delete(key)
        cache.set(key, existing)
        return existing.value
      }

      const entry = createRoot(
        (dispose) => ({
          value: createPromptSession(dir, id),
          dispose,
        }),
        owner,
      )

      cache.set(key, entry)
      prune()
      return entry.value
    }

    const session = createMemo(() => load(params.dir!, params.id))
    const pick = (scope?: Scope) => (scope ? load(scope.dir, scope.id) : session())

    return {
      ready: () => session().ready(),
      current: () => session().current(),
      cursor: () => session().cursor(),
      dirty: () => session().dirty(),
      context: {
        items: () => session().context.items(),
        add: (item: ContextInput) => session().context.add(item),
        remove: (key: string) => session().context.remove(key),
        removeComment: (path: string, commentID: string) => session().context.removeComment(path, commentID),
        updateComment: (path: string, commentID: string, next: Partial<FileContextItem> & { comment?: string }) =>
          session().context.updateComment(path, commentID, next),
        removeMessage: (annotationID: string) => session().context.removeMessage(annotationID),
        updateMessage: (annotationID: string, next: Omit<Partial<MessageContextItem>, "annotationID" | "type">) =>
          session().context.updateMessage(annotationID, next),
        replaceComments: (items: FileContextItem[]) => session().context.replaceComments(items),
        replaceMessages: (items: MessageContextItem[]) => session().context.replaceMessages(items),
      },
      set: (prompt: Prompt, cursorPosition?: number, scope?: Scope) => pick(scope).set(prompt, cursorPosition),
      reset: (scope?: Scope) => pick(scope).reset(),
    }
  },
})

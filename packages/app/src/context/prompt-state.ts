import { checksum } from "@opencode-ai/core/util/encode"
import type { FilePartSource } from "@opencode-ai/sdk/v2/client"
import { batch, createMemo, type Accessor } from "solid-js"
import { createStore, type SetStoreFunction } from "solid-js/store"
import type { FileSelection } from "@/context/file"
import { Persist, persisted } from "@/utils/persist"
import type { ServerScope } from "@/utils/server-scope"

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
  mime?: string
  filename?: string
  url?: string
  source?: FilePartSource
}

export interface AgentPart extends PartBase {
  type: "agent"
  name: string
}

export interface ImageAttachmentPart {
  type: "image"
  id: string
  filename: string
  sourcePath?: string
  mime: string
  dataUrl: string
}

export type ContentPart = TextPart | FileAttachmentPart | AgentPart | ImageAttachmentPart
export type Prompt = ContentPart[]

export type PromptModel = {
  providerID: string
  modelID: string
  variant?: string | null
}

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
export type PromptScope = { draftID: string } | { dir: string; id?: string }

export const DEFAULT_PROMPT: Prompt = [{ type: "text", content: "", start: 0, end: 0 }]

type PromptStore = {
  prompt: Prompt
  cursor?: number
  model?: PromptModel
  context: {
    items: (ContextItem & { key: string })[]
  }
}

type InitialPrompt = {
  prompt?: string
  model?: PromptModel
}

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
      return (
        partB.type === "file" &&
        partA.path === partB.path &&
        partA.mime === partB.mime &&
        partA.filename === partB.filename &&
        isSelectionEqual(partA.selection, partB.selection)
      )
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

  if (item.commentID) return `${key}:c=${item.commentID}`
  const comment = item.comment?.trim()
  if (!comment) return key
  const digest = checksum(comment) ?? comment
  return `${key}:c=${digest.slice(0, 8)}`
}

export function isCommentItem(item: ContextItem | (ContextItem & { key: string })) {
  return item.type === "file" && !!item.comment?.trim()
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

function promptTarget(serverScope: ServerScope, scope: PromptScope) {
  if ("draftID" in scope) return Persist.draft(scope.draftID, "prompt")
  const legacy = `${scope.dir}/prompt${scope.id ? "/" + scope.id : ""}.v2`
  return Persist.serverScoped(serverScope, scope.dir, scope.id, "prompt", [legacy])
}

function promptStore(initial?: InitialPrompt): PromptStore {
  const text = initial?.prompt
  return {
    prompt:
      text === undefined ? clonePrompt(DEFAULT_PROMPT) : [{ type: "text", content: text, start: 0, end: text.length }],
    cursor: text === undefined ? undefined : text.length,
    model: initial?.model ? { ...initial.model } : undefined,
    context: {
      items: [],
    },
  }
}

function createPromptStateValue(store: PromptStore, setStore: SetStoreFunction<PromptStore>) {
  const actions = createPromptActions(setStore)
  const value = {
    current: () => store.prompt,
    cursor: createMemo(() => store.cursor),
    dirty: () => !isPromptEqual(store.prompt, DEFAULT_PROMPT),
    model: {
      current: () => store.model,
      set: (model: PromptModel | undefined) => setStore("model", model),
    },
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
    capture: () => value,
  }
  return value
}

function createPersistedPrompt(target: ReturnType<typeof promptTarget>, initial?: InitialPrompt) {
  const [store, setStore, _, ready] = persisted(target, createStore<PromptStore>(promptStore(initial)))
  return { ready, ...createPromptStateValue(store, setStore) }
}

export function createPromptSession(serverScope: ServerScope, scope: PromptScope, initial?: InitialPrompt) {
  return createPersistedPrompt(promptTarget(serverScope, scope), initial)
}

export function createDraftPromptSession(draftID: string, initial?: InitialPrompt) {
  return createPersistedPrompt(Persist.draft(draftID, "prompt"), initial)
}

export type PromptSession = ReturnType<typeof createPromptSession>

export function createPromptReady(session: Accessor<PromptSession>) {
  return Object.defineProperty(() => session().ready(), "promise", {
    get: () => session().ready.promise,
  }) as (() => boolean) & { readonly promise: Promise<unknown> | undefined }
}

export function createPromptState(initial?: InitialPrompt) {
  const [store, setStore] = createStore<PromptStore>(promptStore(initial))
  const ready = Object.assign(() => true, { promise: Promise.resolve(true) })
  return {
    ready,
    ...createPromptStateValue(store, setStore),
  }
}

import { checksum } from "@opencode-ai/util/encode"
import { batch, type Accessor } from "solid-js"
import { createStore, type SetStoreFunction } from "solid-js/store"
import type { FileSelection } from "@/workspaces/files/model"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { ServerScope } from "@/runtime/server/scope"
import type { BlobReference } from "@/runtime/persistence/drafts"
import type { Platform } from "@/runtime/platform/platform"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { Skill } from "@opencode-ai/schema/skill"

interface PartBase {
  content: string
  start: number
  end: number
}

type FilePartSourceText = { value: string; start: number; end: number }
type FilePartSource =
  | { text: FilePartSourceText; type: "file"; path: string }
  | {
      text: FilePartSourceText
      type: "symbol"
      path: string
      range: { start: { line: number; character: number }; end: { line: number; character: number } }
      name: string
      kind: number
    }
  | { text: FilePartSourceText; type: "resource"; clientName: string; uri: string }

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

export interface SkillPart extends PartBase {
  type: "skill"
  id: Skill.ID
  name: Skill.Name
}

export interface ImageAttachmentPart {
  type: "image"
  id: string
  filename: string
  sourcePath?: string
  mime: string
  blob: BlobReference
}

export type ContentPart = TextPart | FileAttachmentPart | AgentPart | SkillPart | ImageAttachmentPart
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

export type ComposerStore = {
  prompt: Prompt
  cursor?: number
  model?: PromptModel
  mode?: "normal" | "shell"
  retry?: {
    id: SessionMessage.ID
    agent: string
    providerID: string
    modelID: string
    variant?: string
  }
  context: {
    items: (ContextItem & { key: string })[]
  }
}

type InitialPrompt = {
  prompt?: string
  model?: PromptModel
}

function cloneSelection(selection?: FileSelection) {
  if (!selection) return undefined
  return { ...selection }
}

function clonePart(part: ContentPart): ContentPart {
  if (part.type === "text") return { ...part }
  if (part.type === "image") return { ...part }
  if (part.type === "agent") return { ...part }
  if (part.type === "skill") return { ...part }
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

function createComposerActions(setStore: SetStoreFunction<ComposerStore>) {
  return {
    set(prompt: Prompt, cursorPosition?: number) {
      const next = clonePrompt(prompt)
      batch(() => {
        setStore("prompt", next)
        if (cursorPosition !== undefined) setStore("cursor", cursorPosition)
        setStore("retry", undefined)
      })
    },
    reset() {
      batch(() => {
        setStore("prompt", clonePrompt(DEFAULT_PROMPT))
        setStore("cursor", 0)
        setStore("retry", undefined)
      })
    },
  }
}

function composerTarget(serverScope: ServerScope, scope: PromptScope) {
  const target =
    "draftID" in scope
      ? Persist.prompt(Persist.draft(scope.draftID, "prompt"))
      : Persist.prompt({
          ...Persist.serverScoped(serverScope, scope.dir, scope.id, "prompt"),
          ...(serverScope === ServerScope.local
            ? { previousKey: `${scope.dir}/prompt${scope.id ? "/" + scope.id : ""}.v2` }
            : {}),
        })
  return { ...target, migrate: parseComposerStore }
}

function initialComposerStore(initial?: InitialPrompt): ComposerStore {
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

export function parseComposerStore(value: unknown): ComposerStore | undefined {
  if (!record(value)) return
  const prompt = Array.isArray(value.prompt) ? value.prompt.flatMap(parsePart) : []
  const context = record(value.context) && Array.isArray(value.context.items) ? value.context.items : []
  const model = parseModel(value.model)
  const retry = parseRetry(value.retry)
  return {
    prompt: prompt.length ? prompt : clonePrompt(DEFAULT_PROMPT),
    ...(typeof value.cursor === "number" && Number.isFinite(value.cursor) ? { cursor: Math.max(0, value.cursor) } : {}),
    ...(model ? { model } : {}),
    ...(value.mode === "normal" || value.mode === "shell" ? { mode: value.mode } : {}),
    ...(retry ? { retry } : {}),
    context: {
      items: context.flatMap((item) => {
        const parsed = parseContextItem(item)
        return parsed ? [{ ...parsed, key: contextItemKey(parsed) }] : []
      }),
    },
  }
}

function parseRetry(value: unknown): ComposerStore["retry"] {
  if (
    !record(value) ||
    typeof value.id !== "string" ||
    !value.id.startsWith("msg_") ||
    typeof value.agent !== "string" ||
    typeof value.providerID !== "string" ||
    typeof value.modelID !== "string"
  ) {
    return
  }
  return {
    id: SessionMessage.ID.make(value.id),
    agent: value.agent,
    providerID: value.providerID,
    modelID: value.modelID,
    ...(typeof value.variant === "string" ? { variant: value.variant } : {}),
  }
}

function parsePart(value: unknown): ContentPart[] {
  if (!record(value) || typeof value.type !== "string") return []
  if (value.type === "image") {
    const legacy = typeof value.dataUrl === "string" ? value.dataUrl : undefined
    const blobID = record(value.blob) && typeof value.blob.id === "string" ? value.blob.id : legacy
    const hydrated = record(value.blob) && typeof value.blob.url === "string" ? value.blob.url : undefined
    const blobURL =
      hydrated?.startsWith("blob:") || hydrated?.startsWith("data:")
        ? hydrated
        : blobID?.startsWith("data:")
          ? blobID
          : undefined
    if (
      typeof value.id !== "string" ||
      typeof value.filename !== "string" ||
      typeof value.mime !== "string" ||
      !blobID ||
      !blobURL
    ) {
      return []
    }
    return [
      {
        type: "image",
        id: value.id,
        filename: value.filename,
        mime: value.mime,
        blob: { id: blobID, url: blobURL },
        ...(typeof value.sourcePath === "string" ? { sourcePath: value.sourcePath } : {}),
      },
    ]
  }
  if (typeof value.content !== "string" || typeof value.start !== "number" || typeof value.end !== "number") return []
  if (value.type === "text") return [{ type: "text", content: value.content, start: value.start, end: value.end }]
  if (value.type === "agent" && typeof value.name === "string") {
    return [{ type: "agent", name: value.name, content: value.content, start: value.start, end: value.end }]
  }
  if (value.type === "skill" && typeof value.id === "string" && typeof value.name === "string") {
    return [
      {
        type: "skill",
        id: Skill.ID.make(value.id),
        name: Skill.Name.make(value.name),
        content: value.content,
        start: value.start,
        end: value.end,
      },
    ]
  }
  if (value.type !== "file" || typeof value.path !== "string") return []
  const selection = parseSelection(value.selection)
  const source = parseSource(value.source)
  return [
    {
      type: "file",
      path: value.path,
      content: value.content,
      start: value.start,
      end: value.end,
      ...(typeof value.mime === "string" ? { mime: value.mime } : {}),
      ...(typeof value.filename === "string" ? { filename: value.filename } : {}),
      ...(typeof value.url === "string" ? { url: value.url } : {}),
      ...(selection ? { selection } : {}),
      ...(source ? { source } : {}),
    },
  ]
}

function parseContextItem(value: unknown): ContextItem | undefined {
  if (!record(value) || value.type !== "file" || typeof value.path !== "string") return
  const selection = parseSelection(value.selection)
  const origin = value.commentOrigin === "review" || value.commentOrigin === "file" ? value.commentOrigin : undefined
  return {
    type: "file",
    path: value.path,
    ...(selection ? { selection } : {}),
    ...(typeof value.comment === "string" ? { comment: value.comment } : {}),
    ...(typeof value.commentID === "string" ? { commentID: value.commentID } : {}),
    ...(origin ? { commentOrigin: origin } : {}),
    ...(typeof value.preview === "string" ? { preview: value.preview } : {}),
  }
}

function parseModel(value: unknown): PromptModel | undefined {
  if (!record(value) || typeof value.providerID !== "string" || typeof value.modelID !== "string") return
  return {
    providerID: value.providerID,
    modelID: value.modelID,
    ...(typeof value.variant === "string" || value.variant === null ? { variant: value.variant } : {}),
  }
}

function parseSelection(value: unknown): FileSelection | undefined {
  if (!record(value)) return
  if (
    typeof value.startLine !== "number" ||
    typeof value.startChar !== "number" ||
    typeof value.endLine !== "number" ||
    typeof value.endChar !== "number"
  ) {
    return
  }
  return {
    startLine: value.startLine,
    startChar: value.startChar,
    endLine: value.endLine,
    endChar: value.endChar,
  }
}

function parseSource(value: unknown): FilePartSource | undefined {
  if (!record(value) || !record(value.text)) return
  if (
    typeof value.text.value !== "string" ||
    typeof value.text.start !== "number" ||
    typeof value.text.end !== "number"
  ) {
    return
  }
  const text = { value: value.text.value, start: value.text.start, end: value.text.end }
  if (value.type === "file" && typeof value.path === "string") return { type: "file", path: value.path, text }
  if (value.type === "resource" && typeof value.clientName === "string" && typeof value.uri === "string") {
    return { type: "resource", clientName: value.clientName, uri: value.uri, text }
  }
  if (
    value.type !== "symbol" ||
    typeof value.path !== "string" ||
    typeof value.name !== "string" ||
    typeof value.kind !== "number" ||
    !record(value.range) ||
    !record(value.range.start) ||
    !record(value.range.end) ||
    typeof value.range.start.line !== "number" ||
    typeof value.range.start.character !== "number" ||
    typeof value.range.end.line !== "number" ||
    typeof value.range.end.character !== "number"
  ) {
    return
  }
  return {
    type: "symbol",
    path: value.path,
    name: value.name,
    kind: value.kind,
    text,
    range: {
      start: { line: value.range.start.line, character: value.range.start.character },
      end: { line: value.range.end.line, character: value.range.end.character },
    },
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function createComposerStateValue(store: ComposerStore, setStore: SetStoreFunction<ComposerStore>) {
  const actions = createComposerActions(setStore)
  const clearRetry = () => setStore("retry", undefined)
  const value = {
    store: [() => store, setStore] as [Accessor<ComposerStore>, SetStoreFunction<ComposerStore>],
    current: () => store.prompt,
    cursor: () => store.cursor,
    model: {
      current: () => store.model,
      set: (model: PromptModel | undefined) => {
        setStore("model", model)
        clearRetry()
      },
    },
    mode: {
      current: () => store.mode ?? "normal",
      set: (mode: "normal" | "shell") => {
        setStore("mode", mode)
        clearRetry()
      },
    },
    retry: {
      current: () => store.retry,
      set: (retry: NonNullable<ComposerStore["retry"]>) => setStore("retry", retry),
    },
    context: {
      items: () => store.context.items,
      add(item: ContextItem) {
        const key = contextItemKey(item)
        if (store.context.items.find((x) => x.key === key)) return
        setStore("context", "items", (items) => [...items, { key, ...item }])
        clearRetry()
      },
      remove(key: string) {
        setStore("context", "items", (items) => items.filter((x) => x.key !== key))
        clearRetry()
      },
      removeComment(path: string, commentID: string) {
        setStore("context", "items", (items) =>
          items.filter((item) => !(item.type === "file" && item.path === path && item.commentID === commentID)),
        )
        clearRetry()
      },
      updateComment(path: string, commentID: string, next: Partial<FileContextItem> & { comment?: string }) {
        setStore("context", "items", (items) =>
          items.map((item) => {
            if (item.type !== "file" || item.path !== path || item.commentID !== commentID) return item
            const value = { ...item, ...next }
            return { ...value, key: contextItemKey(value) }
          }),
        )
        clearRetry()
      },
      replaceComments(items: FileContextItem[]) {
        setStore("context", "items", (current) => [
          ...current.filter((item) => !isCommentItem(item)),
          ...items.map((item) => ({ ...item, key: contextItemKey(item) })),
        ])
        clearRetry()
      },
    },
    set: (prompt: Prompt, cursorPosition?: number) => actions.set(prompt, cursorPosition),
    reset: () => actions.reset(),
    capture: () => value,
  }
  return value
}

function createPersistedComposer(
  target: ReturnType<typeof composerTarget>,
  initial?: InitialPrompt,
  platform?: Platform,
) {
  const [store, setStore, _, ready] = persisted(
    target,
    createStore<ComposerStore>(initialComposerStore(initial)),
    platform,
  )
  return { ready, ...createComposerStateValue(store, setStore) }
}

export function createComposerState(
  serverScope: ServerScope,
  scope: PromptScope,
  initial?: InitialPrompt,
  platform?: Platform,
) {
  return createPersistedComposer(composerTarget(serverScope, scope), initial, platform)
}

export function createDraftComposerState(draftID: string, initial?: InitialPrompt) {
  return createPersistedComposer(
    {
      ...Persist.prompt(Persist.draft(draftID, "prompt")),
      migrate: parseComposerStore,
    },
    initial,
  )
}

export type ComposerState = ReturnType<typeof createComposerState>

export function createComposerReady(session: Accessor<ComposerState>) {
  return Object.defineProperty(() => session().ready(), "promise", {
    get: () => session().ready.promise,
  }) as (() => boolean) & { readonly promise: Promise<unknown> | undefined }
}

export function createMemoryComposerState(initial?: InitialPrompt) {
  const [store, setStore] = createStore<ComposerStore>(initialComposerStore(initial))
  const ready = Object.assign(() => true, { promise: Promise.resolve(true) })
  return {
    ready,
    ...createComposerStateValue(store, setStore),
  }
}

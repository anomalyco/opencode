import { batch, untrack, type Accessor } from "solid-js"
import { createStore, type SetStoreFunction } from "solid-js/store"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { ServerScope } from "@/runtime/server/scope"
import type { Platform } from "@/runtime/platform/platform"
import { clonePrompt } from "./prompt-parts"
import {
  ComposerStore,
  DEFAULT_PROMPT,
  contextItemKey,
  type ContextItem,
  type FileContextItem,
  type Prompt,
  type PromptModel,
} from "./schema"

export { DEFAULT_PROMPT } from "./schema"
export type {
  AgentPart,
  ComposerStore,
  ContentPart,
  ContextItem,
  FileAttachmentPart,
  FileContextItem,
  ImageAttachmentPart,
  Prompt,
  PromptModel,
  SkillPart,
  TextPart,
} from "./schema"

export type PromptScope = { draftID: string } | { dir: string; id?: string }

type InitialPrompt = {
  prompt?: string
  model?: PromptModel
}

export function isCommentItem(item: ContextItem | (ContextItem & { key: string })) {
  return item.type === "file" && !!item.comment?.trim()
}

function createComposerActions(setStore: SetStoreFunction<ComposerStore>) {
  return {
    set(prompt: Prompt, cursorPosition?: number) {
      batch(() =>
        setStore({
          prompt: clonePrompt(prompt),
          ...(cursorPosition !== undefined ? { cursor: cursorPosition } : {}),
          retry: undefined,
        }),
      )
    },
    reset() {
      batch(() => setStore({ prompt: clonePrompt(DEFAULT_PROMPT), cursor: 0, retry: undefined }))
    },
  }
}

function composerTarget(serverScope: ServerScope, scope: PromptScope) {
  return "draftID" in scope
    ? Persist.prompt(Persist.draft(scope.draftID, "prompt"))
    : Persist.prompt({
        ...Persist.serverScoped(serverScope, scope.dir, scope.id, "prompt"),
        ...(serverScope === ServerScope.local
          ? { previousKey: `${scope.dir}/prompt${scope.id ? "/" + scope.id : ""}.v2` }
          : {}),
      })
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

function createComposerStateValue(store: ComposerStore, setStore: SetStoreFunction<ComposerStore>) {
  const actions = createComposerActions(setStore)
  const clearRetry = () => {
    if (untrack(() => store.retry) !== undefined) setStore("retry", undefined)
  }
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
        if (untrack(() => store.mode === mode && store.retry === undefined)) return
        setStore({ mode, retry: undefined })
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
  const [store, setStore, _, ready] = persisted(target, ComposerStore, initialComposerStore(initial), platform)
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
  return createPersistedComposer(Persist.prompt(Persist.draft(draftID, "prompt")), initial)
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

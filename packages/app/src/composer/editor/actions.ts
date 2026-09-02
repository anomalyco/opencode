import { batch, untrack, type Accessor } from "solid-js"
import type { SetStoreFunction, Store } from "solid-js/store"
import type {
  ComposerAgentPart,
  ComposerFilePart,
  ComposerSkillPart,
  ComposerPersistedState,
  ComposerPrompt,
} from "../types"
import { promptLength } from "../prompt-parts"

export type ComposerStateStore = [
  Store<ComposerPersistedState> | Accessor<Store<ComposerPersistedState>>,
  SetStoreFunction<ComposerPersistedState>,
]

export type ComposerStateStoreInput = ComposerStateStore | Accessor<ComposerStateStore>

export function createComposerEditorActions(input: ComposerStateStoreInput) {
  const tuple = () => (typeof input === "function" ? input() : input)
  const store = () => {
    const value = tuple()[0]
    return typeof value === "function" ? value() : value
  }
  const setStore = () => tuple()[1]
  const clearRetry = () => {
    if (untrack(() => store().retry) !== undefined) setStore()("retry", undefined)
  }

  return {
    get state() {
      return store()
    },
    setPrompt(prompt: ComposerPrompt, cursor?: number) {
      // Persisted setters encode on every call, even inside a reactive batch.
      batch(() => setStore()({ prompt, ...(cursor !== undefined ? { cursor } : {}), retry: undefined }))
    },
    setCursor(cursor: number) {
      if (untrack(() => store().cursor) === cursor) return
      setStore()("cursor", cursor)
    },
    setMode(mode: "normal" | "shell") {
      if (untrack(() => store().mode === mode && store().retry === undefined)) return
      setStore()({ mode, retry: undefined })
    },
    setText(content: string) {
      batch(() =>
        setStore()((state) => ({
          prompt: [
            { type: "text", content, start: 0, end: content.length },
            ...state.prompt.filter((part) => part.type === "image"),
          ],
          cursor: content.length,
          retry: undefined,
        })),
      )
    },
    addText(content: string) {
      const cursor = store().cursor ?? promptLength(store().prompt)
      batch(() =>
        setStore()((state) => ({
          prompt: insertText(state.prompt, cursor, content),
          cursor: cursor + content.length,
          retry: undefined,
        })),
      )
    },
    removeContext(key: string) {
      setStore()("context", "items", (items) => items.filter((item) => item.key !== key))
      clearRetry()
    },
    addMention(mention: ComposerFilePart | ComposerAgentPart | ComposerSkillPart) {
      const text = store()
        .prompt.map((part) => ("content" in part ? part.content : ""))
        .join("")
      const end = store().cursor ?? text.length
      const start = text.slice(0, end).lastIndexOf("@")
      setStore()("prompt", insertMention(store().prompt, start < 0 ? end : start, end, mention))
      setStore()("cursor", (start < 0 ? end : start) + mention.content.length + 1)
      clearRetry()
    },
    removeAttachment(id: string) {
      setStore()("prompt", (parts) => parts.filter((part) => part.type !== "image" || part.id !== id))
      clearRetry()
    },
  }
}

function insertText(prompt: ComposerPrompt, cursor: number, content: string): ComposerPrompt {
  let position = 0
  let inserted = false
  const parts = prompt.flatMap<ComposerPrompt[number]>((part) => {
    if (part.type === "image") return [part]
    const start = position
    position += part.content.length
    if (inserted) return [part]
    if (part.type === "text" && cursor >= start && cursor <= position) {
      inserted = true
      const offset = cursor - start
      return [{ ...part, content: part.content.slice(0, offset) + content + part.content.slice(offset) }]
    }
    if (cursor > start) return [part]
    inserted = true
    return [{ type: "text", content, start: 0, end: 0 }, part]
  })
  if (!inserted) parts.push({ type: "text", content, start: 0, end: 0 })
  return withOffsets(parts)
}

function insertMention(
  prompt: ComposerPrompt,
  start: number,
  end: number,
  mention: ComposerFilePart | ComposerAgentPart | ComposerSkillPart,
): ComposerPrompt {
  let position = 0
  const parts = prompt.flatMap<ComposerPrompt[number]>((part) => {
    if (part.type === "image") return [part]
    const partStart = position
    position += part.content.length
    if (part.type !== "text" || start < partStart || end > position) return [part]
    const before = part.content.slice(0, start - partStart)
    const after = part.content.slice(end - partStart)
    return [
      ...(before ? [{ type: "text" as const, content: before, start: 0, end: 0 }] : []),
      mention,
      { type: "text" as const, content: ` ${after}`, start: 0, end: 0 },
    ]
  })
  return withOffsets(parts)
}

function withOffsets(prompt: ComposerPrompt): ComposerPrompt {
  let offset = 0
  return prompt.map((part) => {
    if (part.type === "image") return part
    const next = { ...part, start: offset, end: offset + part.content.length }
    offset = next.end
    return next
  })
}

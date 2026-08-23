import { batch, type Accessor } from "solid-js"
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
  const clearRetry = () => setStore()("retry", undefined)

  return {
    get state() {
      return store()
    },
    setPrompt(prompt: ComposerPrompt, cursor?: number) {
      batch(() => {
        setStore()("prompt", prompt)
        if (cursor !== undefined) setStore()("cursor", cursor)
        clearRetry()
      })
    },
    setCursor(cursor: number) {
      setStore()("cursor", cursor)
    },
    setMode(mode: "normal" | "shell") {
      setStore()("mode", mode)
      clearRetry()
    },
    setText(content: string) {
      batch(() => {
        setStore()("prompt", (prompt) => [
          { type: "text", content, start: 0, end: content.length },
          ...prompt.filter((part) => part.type === "image"),
        ])
        setStore()("cursor", content.length)
        clearRetry()
      })
    },
    addText(content: string) {
      const cursor = store().cursor ?? promptLength(store().prompt)
      batch(() => {
        setStore()("prompt", (prompt) => insertText(prompt, cursor, content))
        setStore()("cursor", cursor + content.length)
        clearRetry()
      })
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

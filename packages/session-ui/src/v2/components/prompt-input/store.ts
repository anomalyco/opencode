import { batch, type Accessor } from "solid-js"
import type { SetStoreFunction, Store } from "solid-js/store"
import type {
  PromptInputV2AgentPart,
  PromptInputV2Attachment,
  PromptInputV2Comment,
  PromptInputV2FilePart,
  PromptInputV2Model,
  PromptInputV2PersistedState,
  PromptInputV2Prompt,
} from "./types"

export type PromptInputV2StoreTuple = [
  Store<PromptInputV2PersistedState> | Accessor<Store<PromptInputV2PersistedState>>,
  SetStoreFunction<PromptInputV2PersistedState>,
]

export type PromptInputV2StoreInput = PromptInputV2StoreTuple | Accessor<PromptInputV2StoreTuple>

export function createPromptInputV2Store(input: PromptInputV2StoreInput) {
  const tuple = () => (typeof input === "function" ? input() : input)
  const store = () => {
    const value = tuple()[0]
    return typeof value === "function" ? value() : value
  }
  const setStore = () => tuple()[1]
  const replace = (start: number, end: number, content: string) => {
    batch(() => {
      setStore()("prompt", (prompt) => replaceRange(prompt, start, end, content))
      setStore()("cursor", Math.min(start, end) + content.length)
    })
  }

  return {
    get state() {
      return store()
    },
    setPrompt(prompt: PromptInputV2Prompt, cursor?: number) {
      batch(() => {
        setStore()("prompt", prompt)
        if (cursor !== undefined) setStore()("cursor", cursor)
      })
    },
    setCursor(cursor: number) {
      setStore()("cursor", cursor)
    },
    setText(content: string) {
      batch(() => {
        setStore()("prompt", (prompt) => [
          { type: "text", content, start: 0, end: content.length },
          ...prompt.filter((part) => part.type !== "text"),
        ])
        setStore()("cursor", content.length)
      })
    },
    addText(content: string) {
      const cursor = store().cursor ?? promptLength(store().prompt)
      replace(cursor, cursor, content)
    },
    // Replaces the selected range in a single transaction. Large pastes go through here
    // instead of the DOM, so the editor re-renders from the model as one text node.
    replaceText: replace,
    reset() {
      batch(() => {
        setStore()("prompt", [{ type: "text", content: "", start: 0, end: 0 }])
        setStore()("cursor", 0)
      })
    },
    setModel(model: PromptInputV2Model | undefined) {
      setStore()("model", model)
    },
    setVariant(variant: string | null) {
      if (store().model) setStore()("model", "variant", variant)
    },
    addContext(item: PromptInputV2Comment) {
      if (store().context.items.some((entry) => entry.key === item.key)) return
      setStore()("context", "items", (items) => [...items, item])
    },
    removeContext(key: string) {
      setStore()("context", "items", (items) => items.filter((item) => item.key !== key))
    },
    addMention(mention: PromptInputV2FilePart | PromptInputV2AgentPart) {
      const end = store().cursor ?? promptLength(store().prompt)
      const trigger = mentionStart(store().prompt, end)
      const start = trigger < 0 ? end : trigger
      setStore()("prompt", insertMention(store().prompt, start, end, mention))
      setStore()("cursor", start + mention.content.length + 1)
    },
    addAttachment(attachment: PromptInputV2Attachment) {
      setStore()("prompt", (prompt) => [...prompt, attachment])
    },
    removeAttachment(id: string) {
      setStore()("prompt", (parts) => parts.filter((part) => part.type !== "image" || part.id !== id))
    },
  }
}

export type PromptInputV2Store = ReturnType<typeof createPromptInputV2Store>

function replaceRange(prompt: PromptInputV2Prompt, start: number, end: number, content: string): PromptInputV2Prompt {
  const from = Math.max(0, Math.min(start, end))
  const to = Math.max(0, Math.max(start, end))
  let position = 0
  let inserted = false
  const parts = prompt.flatMap<PromptInputV2Prompt[number]>((part) => {
    if (part.type === "image") return [part]
    const partStart = position
    const partEnd = partStart + part.content.length
    position = partEnd
    if (part.type !== "text") {
      // Mentions are atomic, so a selection that reaches into one removes all of it. The
      // first one removed takes the replacement's place, or a selection that starts inside a
      // mention would push the pasted text behind the parts that follow it.
      if (partStart < to && partEnd > from) {
        if (inserted) return []
        inserted = true
        return [{ type: "text", content, start: 0, end: 0 }]
      }
      if (inserted || from > partStart) return [part]
      inserted = true
      return [{ type: "text", content, start: 0, end: 0 }, part]
    }
    const head = part.content.slice(0, Math.max(0, Math.min(part.content.length, from - partStart)))
    const tail = part.content.slice(Math.max(0, Math.min(part.content.length, to - partStart)))
    if (inserted) return [{ ...part, content: head + tail }]
    if (partEnd < from || partStart > to) return [part]
    inserted = true
    return [{ ...part, content: head + content + tail }]
  })
  if (!inserted) parts.push({ type: "text", content, start: 0, end: 0 })
  return withOffsets(parts)
}

// Finds the "@" that opened the current mention without joining the prompt into one
// string, which would copy the whole draft on every suggestion.
function mentionStart(prompt: PromptInputV2Prompt, end: number) {
  let position = 0
  let found = -1
  for (const part of prompt) {
    if (!("content" in part)) continue
    const start = position
    position += part.content.length
    if (start >= end) break
    const index = part.content.lastIndexOf("@", end - start - 1)
    if (index >= 0) found = start + index
  }
  return found
}

function insertMention(
  prompt: PromptInputV2Prompt,
  start: number,
  end: number,
  mention: PromptInputV2FilePart | PromptInputV2AgentPart,
): PromptInputV2Prompt {
  let position = 0
  const parts = prompt.flatMap<PromptInputV2Prompt[number]>((part) => {
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

function withOffsets(prompt: PromptInputV2Prompt): PromptInputV2Prompt {
  let offset = 0
  return prompt.map((part) => {
    if (part.type === "image") return part
    const next = { ...part, start: offset, end: offset + part.content.length }
    offset = next.end
    return next
  })
}

function promptLength(prompt: PromptInputV2Prompt) {
  return prompt.reduce((length, part) => length + ("content" in part ? part.content.length : 0), 0)
}

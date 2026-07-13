import { createStore } from "solid-js/store"

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

type ContextItem = {
  key: string
  type: "file"
  path: string
  selection?: { startLine: number; startChar: number; endLine: number; endChar: number }
  comment?: string
  commentID?: string
  commentOrigin?: "review" | "file"
  preview?: string
}

export const DEFAULT_PROMPT: Prompt = [{ type: "text", content: "", start: 0, end: 0 }]

function clonePart(part: ContentPart): ContentPart {
  if (part.type === "image") return { ...part }
  if (part.type === "agent") return { ...part }
  if (part.type === "file") return { ...part }
  return { ...part }
}

function clonePrompt(prompt: Prompt) {
  return prompt.map(clonePart)
}

export function isPromptEqual(a: Prompt, b: Prompt) {
  if (a.length !== b.length) return false
  return a.every((part, i) => JSON.stringify(part) === JSON.stringify(b[i]))
}

export function isCommentItem(item: ContextItem) {
  return !!item.comment?.trim()
}

export function createPromptState() {
  const [store, setStore] = createStore({
    prompt: clonePrompt(DEFAULT_PROMPT),
    cursor: 0,
    items: [] as ContextItem[],
  })
  let index = 0
  const ready = Object.assign(() => true, { promise: Promise.resolve(true) })
  const withKey = (item: Omit<ContextItem, "key"> & { key?: string }): ContextItem => ({
    ...item,
    key: item.key ?? `ctx:${++index}`,
  })

  const value = {
    ready,
    current: () => store.prompt,
    cursor: () => store.cursor,
    dirty: () => !isPromptEqual(store.prompt, DEFAULT_PROMPT),
    set(next: Prompt, cursorPosition?: number) {
      setStore("prompt", clonePrompt(next))
      if (cursorPosition !== undefined) setStore("cursor", cursorPosition)
    },
    reset() {
      setStore("prompt", clonePrompt(DEFAULT_PROMPT))
      setStore("cursor", 0)
      setStore("items", (current) => current.filter((item) => !!item.comment?.trim()))
    },
    capture: () => value,
    context: {
      items: () => store.items,
      add(item: Omit<ContextItem, "key"> & { key?: string }) {
        const next = withKey(item)
        if (store.items.some((current) => current.key === next.key)) return
        setStore("items", (current) => [...current, next])
      },
      remove(key: string) {
        setStore("items", (current) => current.filter((item) => item.key !== key))
      },
      removeComment(path: string, commentID: string) {
        setStore("items", (current) =>
          current.filter((item) => !(item.type === "file" && item.path === path && item.commentID === commentID)),
        )
      },
      updateComment(path: string, commentID: string, next: Partial<ContextItem>) {
        setStore("items", (current) =>
          current.map((item) => {
            if (item.type !== "file" || item.path !== path || item.commentID !== commentID) return item
            return withKey({ ...item, ...next })
          }),
        )
      },
      replaceComments(next: Array<Omit<ContextItem, "key"> & { key?: string }>) {
        const nonComment = store.items.filter((item) => !item.comment?.trim())
        setStore("items", [...nonComment, ...next.map(withKey)])
      },
    },
  }
  return value
}

const prompt = createPromptState()

export function usePrompt() {
  return prompt
}

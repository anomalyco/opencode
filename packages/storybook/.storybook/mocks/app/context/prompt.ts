import { createSignal } from "solid-js"

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

let index = 0
const [prompt, setPrompt] = createSignal<Prompt>(clonePrompt(DEFAULT_PROMPT))
const [cursor, setCursor] = createSignal<number>(0)
const [items, setItems] = createSignal<ContextItem[]>([])

const withKey = (item: Omit<ContextItem, "key"> & { key?: string }): ContextItem => ({
  ...item,
  key: item.key ?? `ctx:${++index}`,
})

export function usePrompt() {
  return {
    ready: () => true,
    current: prompt,
    cursor,
    dirty: () => !isPromptEqual(prompt(), DEFAULT_PROMPT),
    set(next: Prompt, cursorPosition?: number) {
      setPrompt(clonePrompt(next))
      if (cursorPosition !== undefined) setCursor(cursorPosition)
    },
    reset() {
      setPrompt(clonePrompt(DEFAULT_PROMPT))
      setCursor(0)
      setItems((current) => current.filter((item) => !!item.comment?.trim()))
    },
    context: {
      items,
      add(item: Omit<ContextItem, "key"> & { key?: string }) {
        const next = withKey(item)
        if (items().some((current) => current.key === next.key)) return
        setItems((current) => [...current, next])
      },
      remove(key: string) {
        setItems((current) => current.filter((item) => item.key !== key))
      },
      removeComment(path: string, commentID: string) {
        setItems((current) =>
          current.filter((item) => !(item.type === "file" && item.path === path && item.commentID === commentID)),
        )
      },
      updateComment(path: string, commentID: string, next: Partial<ContextItem>) {
        setItems((current) =>
          current.map((item) => {
            if (item.type !== "file" || item.path !== path || item.commentID !== commentID) return item
            return withKey({ ...item, ...next })
          }),
        )
      },
      replaceComments(next: Array<Omit<ContextItem, "key"> & { key?: string }>) {
        const nonComment = items().filter((item) => !item.comment?.trim())
        setItems([...nonComment, ...next.map(withKey)])
      },
    },
  }
}

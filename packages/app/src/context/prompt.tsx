import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { batch, createMemo } from "solid-js"
import { useParams } from "@solidjs/router"
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

export type FileContextItem = {
  type: "file"
  path: string
  selection?: FileSelection
}

export type ContextItem = FileContextItem

export const DEFAULT_PROMPT: Prompt = [{ type: "text", content: "", start: 0, end: 0 }]

function isSelectionEqual(a?: FileSelection, b?: FileSelection) {
  if (!a && !b) return true
  if (!a || !b) return false
  return (
    a.startLine === b.startLine && a.startChar === b.startChar && a.endLine === b.endLine && a.endChar === b.endChar
  )
}

export function isPromptEqual(promptA: Prompt, promptB: Prompt): boolean {
  if (promptA.length !== promptB.length) return false
  for (let i = 0; i < promptA.length; i++) {
    const partA = promptA[i]
    const partB = promptB[i]
    if (partA.type !== partB.type) return false
    if (partA.type === "text" && partA.content !== (partB as TextPart).content) {
      return false
    }
    if (partA.type === "file") {
      const fileA = partA as FileAttachmentPart
      const fileB = partB as FileAttachmentPart
      if (fileA.path !== fileB.path) return false
      if (!isSelectionEqual(fileA.selection, fileB.selection)) return false
    }
    if (partA.type === "agent" && partA.name !== (partB as AgentPart).name) {
      return false
    }
    if (partA.type === "image" && partA.id !== (partB as ImageAttachmentPart).id) {
      return false
    }
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

export const { use: usePrompt, provider: PromptProvider } = createSimpleContext({
  name: "Prompt",
  init: () => {
    const params = useParams()
    const legacy = createMemo(() => `${params.dir}/prompt${params.id ? "/" + params.id : ""}.v2`)

    const [store, setStore, _, ready] = persisted(
      Persist.scoped(params.dir!, params.id, "prompt", [legacy()]),
      createStore<{
        prompt: Prompt
        cursor?: number
        context: {
          activeTab: boolean
          items: (ContextItem & { key: string })[]
        }
      }>({
        prompt: clonePrompt(DEFAULT_PROMPT),
        cursor: undefined,
        context: {
          activeTab: true,
          items: [],
        },
      }),
    )

    function keyForItem(item: ContextItem) {
      if (item.type !== "file") return item.type
      const start = item.selection?.startLine
      const end = item.selection?.endLine
      return `${item.type}:${item.path}:${start}:${end}`
    }

    return {
      ready,
      current: createMemo(() => store.prompt),
      cursor: createMemo(() => store.cursor),
      dirty: createMemo(() => !isPromptEqual(store.prompt, DEFAULT_PROMPT)),
      context: {
        activeTab: createMemo(() => store.context.activeTab),
        items: createMemo(() => store.context.items),
        addActive() {
          setStore("context", "activeTab", true)
        },
        removeActive() {
          setStore("context", "activeTab", false)
        },
        add(item: ContextItem) {
          const key = keyForItem(item)
          if (store.context.items.find((x) => x.key === key)) return
          setStore("context", "items", (items) => [...items, { key, ...item }])
        },
        remove(key: string) {
          setStore("context", "items", (items) => items.filter((x) => x.key !== key))
        },
      },
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
  },
})

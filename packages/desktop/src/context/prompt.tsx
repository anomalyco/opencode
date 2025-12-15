import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { batch, createMemo } from "solid-js"
import { makePersisted } from "@solid-primitives/storage"
import { useParams } from "@solidjs/router"
import { TextSelection } from "./local"

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
  selection?: TextSelection
}

export interface ImageAttachmentPart {
  type: "image"
  id: string
  filename: string
  mime: string
  dataUrl: string
}

export type ContentPart = TextPart | FileAttachmentPart | ImageAttachmentPart
export type Prompt = ContentPart[]

export const DEFAULT_PROMPT: Prompt = [{ type: "text", content: "", start: 0, end: 0 }]

export function isPromptEqual(promptA: Prompt, promptB: Prompt): boolean {
  if (promptA.length !== promptB.length) return false
  for (let i = 0; i < promptA.length; i++) {
    const partA = promptA[i]
    const partB = promptB[i]
    if (partA.type !== partB.type) return false
    if (partA.type === "text" && partA.content !== (partB as TextPart).content) {
      return false
    }
    if (partA.type === "file" && partA.path !== (partB as FileAttachmentPart).path) {
      return false
    }
    if (partA.type === "image" && partA.id !== (partB as ImageAttachmentPart).id) {
      return false
    }
  }
  return true
}

function cloneSelection(selection?: TextSelection) {
  if (!selection) return undefined
  return { ...selection }
}

function clonePart(part: ContentPart): ContentPart {
  if (part.type === "text") return { ...part }
  if (part.type === "image") return { ...part }
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
    const name = createMemo(() => `${params.dir}/prompt${params.id ? "/" + params.id : ""}.v1`)

    const [store, setStore] = makePersisted(
      createStore<{
        prompt: Prompt
        cursor?: number
      }>({
        prompt: clonePrompt(DEFAULT_PROMPT),
        cursor: undefined,
      }),
      {
        name: name(),
      },
    )

    return {
      current: createMemo(() => store.prompt),
      cursor: createMemo(() => store.cursor),
      dirty: createMemo(() => !isPromptEqual(store.prompt, DEFAULT_PROMPT)),
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

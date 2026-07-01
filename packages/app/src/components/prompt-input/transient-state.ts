import { createComputed, on, type Accessor } from "solid-js"
import { createStore, type SetStoreFunction } from "solid-js/store"
import type { PromptHistoryEntry } from "./history"

export type PromptInputTransientState = {
  popover: "at" | "slash" | null
  historyIndex: number
  savedPrompt: PromptHistoryEntry | null
  placeholder: number
  draggingType: "image" | "@mention" | null
  mode: "normal" | "shell"
  applyingHistory: boolean
  variantOpen: boolean
}

function resetPromptInputTransientState(setStore: SetStoreFunction<PromptInputTransientState>) {
  setStore({
    popover: null,
    historyIndex: -1,
    savedPrompt: null,
    draggingType: null,
    mode: "normal",
    applyingHistory: false,
    variantOpen: false,
  })
}

export function createPromptInputTransientState(identity: Accessor<unknown>, placeholder: number) {
  const [store, setStore] = createStore<PromptInputTransientState>({
    popover: null,
    historyIndex: -1,
    savedPrompt: null,
    placeholder,
    draggingType: null,
    mode: "normal",
    applyingHistory: false,
    variantOpen: false,
  })

  createComputed(on(identity, () => resetPromptInputTransientState(setStore), { defer: true }))

  return [store, setStore] as const
}

import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"

export type DesignComment = {
  id: string
  text: string
  element: {
    tag: string
    classes?: string
    path: string
    rect: { x: number; y: number; width: number; height: number }
  }
  source?: { file: string; line: number; column?: number }
  position: { x: number; y: number }
}

let seq = 0

export const { use: useDesignComments, provider: DesignCommentsProvider } = createSimpleContext({
  name: "DesignComments",
  gate: false,
  init: () => {
    const [store, setStore] = createStore({
      items: [] as DesignComment[],
    })

    const add = (input: Omit<DesignComment, "id">) => {
      const id = `dc-${Date.now()}-${++seq}`
      const comment: DesignComment = { ...input, id }
      setStore("items", (prev) => [...prev, comment])
      return comment
    }

    const remove = (id: string) => {
      setStore("items", (prev) => prev.filter((c) => c.id !== id))
    }

    const update = (id: string, text: string) => {
      setStore("items", (prev) =>
        prev.map((c) => (c.id === id ? { ...c, text } : c)),
      )
    }

    const clear = () => {
      setStore("items", [])
    }

    const list = () => store.items

    return { add, remove, update, clear, list }
  },
})

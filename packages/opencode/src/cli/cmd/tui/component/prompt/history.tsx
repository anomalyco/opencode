import path from "path"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { onMount } from "solid-js"
import { createStore, produce, unwrap } from "solid-js/store"
import { createSimpleContext } from "../../context/helper"
import { appendFile, writeFile } from "fs/promises"
import type { AgentPart, FilePart, TextPart } from "@opencode-ai/sdk/v2"

export type PromptInfo = {
  input: string
  mode?: "normal" | "shell"
  parts: (
    | Omit<FilePart, "id" | "messageID" | "sessionID">
    | Omit<AgentPart, "id" | "messageID" | "sessionID">
    | (Omit<TextPart, "id" | "messageID" | "sessionID"> & {
        source?: {
          text: {
            start: number
            end: number
            value: string
          }
        }
      })
  )[]
}

const MAX_HISTORY_ENTRIES = 50
type SearchInfo = {
  term: string
  pos: number
  value: string
}

export function search(list: PromptInfo[], input: string, last?: SearchInfo) {
  const keep = last && (input === last.value || input === last.term)
  const term = keep ? last.term : input
  const from = keep ? last.pos - 1 : list.length - 1
  for (let i = from; i >= 0; i--) {
    const item = list[i]
    if (!item) continue
    if (term && !item.input.includes(term)) continue
    return {
      item,
      next: {
        term,
        pos: i,
        value: item.input,
      } satisfies SearchInfo,
    }
  }
}

export const { use: usePromptHistory, provider: PromptHistoryProvider } = createSimpleContext({
  name: "PromptHistory",
  init: () => {
    const historyPath = path.join(Global.Path.state, "prompt-history.jsonl")
    onMount(async () => {
      const text = await Filesystem.readText(historyPath).catch(() => "")
      const lines = text
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line)
          } catch {
            return null
          }
        })
        .filter((line): line is PromptInfo => line !== null)
        .slice(-MAX_HISTORY_ENTRIES)

      setStore("history", lines)

      // Rewrite file with only valid entries to self-heal corruption
      if (lines.length > 0) {
        const content = lines.map((line) => JSON.stringify(line)).join("\n") + "\n"
        writeFile(historyPath, content).catch(() => {})
      }
    })

    const [store, setStore] = createStore({
      index: 0,
      history: [] as PromptInfo[],
      search: undefined as SearchInfo | undefined,
    })

    return {
      move(direction: 1 | -1, input: string) {
        if (!store.history.length) return undefined
        const current = store.history.at(store.index)
        if (!current) return undefined
        if (current.input !== input && input.length) return
        setStore(
          produce((draft) => {
            draft.search = undefined
            const next = store.index + direction
            if (Math.abs(next) > store.history.length) return
            if (next > 0) return
            draft.index = next
          }),
        )
        if (store.index === 0)
          return {
            input: "",
            parts: [],
        }
        return store.history.at(store.index)
      },
      search(input: string) {
        const found = search(store.history, input, store.search)
        if (!found) return
        setStore(
          produce((draft) => {
            draft.index = 0
            draft.search = found.next
          }),
        )
        return found.item
      },
      append(item: PromptInfo) {
        const entry = structuredClone(unwrap(item))
        let trimmed = false
        setStore(
          produce((draft) => {
            draft.history.push(entry)
            if (draft.history.length > MAX_HISTORY_ENTRIES) {
              draft.history = draft.history.slice(-MAX_HISTORY_ENTRIES)
              trimmed = true
            }
            draft.index = 0
            draft.search = undefined
          }),
        )

        if (trimmed) {
          const content = store.history.map((line) => JSON.stringify(line)).join("\n") + "\n"
          writeFile(historyPath, content).catch(() => {})
          return
        }

        appendFile(historyPath, JSON.stringify(entry) + "\n").catch(() => {})
      },
    }
  },
})

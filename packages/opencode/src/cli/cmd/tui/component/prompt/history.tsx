import path from "path"
import { Global } from "@/global"
import { onMount } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { clone } from "remeda"
import { createSimpleContext } from "../../context/helper"
import { appendFile, writeFile } from "fs/promises"
import { moveHistory, type PromptInfo } from "./history-core"

export type { PromptInfo }

const MAX_HISTORY_ENTRIES = 50

export const { use: usePromptHistory, provider: PromptHistoryProvider } = createSimpleContext({
  name: "PromptHistory",
  init: () => {
    const historyFile = Bun.file(path.join(Global.Path.state, "prompt-history.jsonl"))
    onMount(async () => {
      const text = await historyFile.text().catch(() => "")
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
        writeFile(historyFile.name!, content).catch(() => {})
      }
    })

    const [store, setStore] = createStore({
      index: 0,
      history: [] as PromptInfo[],
    })

    return {
      move(direction: 1 | -1, input: string): PromptInfo | undefined {
        const { nextIndex, result } = moveHistory(store.history, store.index, direction, input)
        setStore("index", nextIndex)
        return result
      },
      append(item: PromptInfo) {
        const entry = clone(item)
        let trimmed = false
        setStore(
          produce((draft) => {
            draft.history.push(entry)
            if (draft.history.length > MAX_HISTORY_ENTRIES) {
              draft.history = draft.history.slice(-MAX_HISTORY_ENTRIES)
              trimmed = true
            }
            draft.index = 0
          }),
        )

        if (trimmed) {
          const content = store.history.map((line) => JSON.stringify(line)).join("\n") + "\n"
          writeFile(historyFile.name!, content).catch(() => {})
          return
        }

        appendFile(historyFile.name!, JSON.stringify(entry) + "\n").catch(() => {})
      },
    }
  },
})

import path from "path"
import { Global } from "@/global"
import { onMount } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { clone } from "remeda"
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

export function createPromptHistoryStoreForTest(initialHistory: PromptInfo[] = []) {
  // Use a lightweight helper implementation to avoid Solid/Bun runtime imports in tests
  return require("./history-helper").createPromptHistoryStoreForTest(initialHistory)
}

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
      resetIndex() {
        setStore("index", 0)
      },
      move(direction: 1 | -1, input: string) {
        if (!store.history.length) return undefined
        // If a prefix is provided, search the next matching entry that startsWith(prefix)
        if (input && input.length) {
          let idx = store.index
          while (true) {
            const next = idx + direction
            if (Math.abs(next) > store.history.length) break
            // When going down and reaching index 0, return the prefix as the "last" item
            if (next >= 0) {
              if (direction === 1) {
                setStore(
                  produce((draft) => {
                    draft.index = 0
                  }),
                )
                return { input: input, parts: [] }
              }
              break
            }
            const candidate = store.history.at(next)
            if (!candidate) {
              idx = next
              continue
            }
            if (candidate.input.startsWith(input)) {
              // update index and return the matching candidate directly
              setStore(
                produce((draft) => {
                  draft.index = next
                }),
              )
              return candidate
            }
            idx = next
          }
          return
        }

        const current = store.history.at(store.index)
        if (!current) return undefined
        setStore(
          produce((draft) => {
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

import path from "path"
import { Global } from "@/global"
import { onMount } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { clone } from "remeda"
import { createSimpleContext } from "../../context/helper"
import { appendFile, writeFile } from "fs/promises"
import type { PromptInfo } from "./history"

export type StashEntry = {
  input: string
  parts: PromptInfo["parts"]
  timestamp: number
}

const MAX_STASH_ENTRIES = 50

export const { use: usePromptStash, provider: PromptStashProvider } = createSimpleContext({
  name: "PromptStash",
  init: () => {
    const stashFile = Bun.file(path.join(Global.Path.state, "prompt-stash.jsonl"))
    onMount(async () => {
      const text = await stashFile.text().catch(() => "")
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
        .filter((line): line is StashEntry => line !== null)
        .slice(-MAX_STASH_ENTRIES)

      setStore("entries", lines)

      // Rewrite file with only valid entries to self-heal corruption
      if (lines.length > 0) {
        const content = lines.map((line) => JSON.stringify(line)).join("\n") + "\n"
        writeFile(stashFile.name!, content).catch(() => {})
      }
    })

    const [store, setStore] = createStore({
      entries: [] as StashEntry[],
    })

    return {
      list() {
        return store.entries
      },
      push(entry: Omit<StashEntry, "timestamp">) {
        const stash = clone({ ...entry, timestamp: Date.now() })
        let trimmed = false
        setStore(
          produce((draft) => {
            draft.entries.push(stash)
            if (draft.entries.length > MAX_STASH_ENTRIES) {
              draft.entries = draft.entries.slice(-MAX_STASH_ENTRIES)
              trimmed = true
            }
          }),
        )

        if (trimmed) {
          const content = store.entries.map((line) => JSON.stringify(line)).join("\n") + "\n"
          writeFile(stashFile.name!, content).catch(() => {})
          return
        }

        appendFile(stashFile.name!, JSON.stringify(stash) + "\n").catch(() => {})
      },
      pop() {
        if (store.entries.length === 0) return undefined
        const entry = store.entries[store.entries.length - 1]
        setStore(
          produce((draft) => {
            draft.entries.pop()
          }),
        )
        const content =
          store.entries.length > 0 ? store.entries.map((line) => JSON.stringify(line)).join("\n") + "\n" : ""
        writeFile(stashFile.name!, content).catch(() => {})
        return entry
      },
      remove(index: number) {
        if (index < 0 || index >= store.entries.length) return
        setStore(
          produce((draft) => {
            draft.entries.splice(index, 1)
          }),
        )
        const content =
          store.entries.length > 0 ? store.entries.map((line) => JSON.stringify(line)).join("\n") + "\n" : ""
        writeFile(stashFile.name!, content).catch(() => {})
      },
    }
  },
})

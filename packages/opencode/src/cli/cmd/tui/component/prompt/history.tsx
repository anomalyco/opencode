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
  scope?: string
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

function scope(value?: string) {
  return value ?? "global"
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
      scope: "global",
      history: [] as PromptInfo[],
    })

    return {
      move(direction: 1 | -1, input: string, currentScope?: string) {
        const nextScope = scope(currentScope)
        const changed = store.scope !== nextScope
        const index = changed ? 0 : store.index
        if (changed) {
          setStore("scope", nextScope)
          setStore("index", 0)
        }

        const list = store.history.filter((item) => scope(item.scope) === nextScope)
        if (!list.length) return undefined
        const current = list.at(index)
        if (!current) return undefined
        if (current.input !== input && input.length) return
        const next = index + direction
        if (Math.abs(next) > list.length) return undefined
        if (next > 0) return undefined

        setStore("scope", nextScope)
        setStore("index", next)

        if (next === 0)
          return {
            input: "",
            parts: [],
          }
        return list.at(next)
      },
      append(item: PromptInfo, currentScope?: string) {
        const entry = {
          ...structuredClone(unwrap(item)),
          scope: scope(currentScope),
        } satisfies PromptInfo
        let trimmed = false
        setStore(
          produce((draft) => {
            draft.history.push(entry)
            if (draft.history.length > MAX_HISTORY_ENTRIES) {
              draft.history = draft.history.slice(-MAX_HISTORY_ENTRIES)
              trimmed = true
            }
            draft.scope = entry.scope
            draft.index = 0
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

import { ClientDatabase } from "@/storage/db"
import { ClientPromptHistoryTable } from "@/storage/client-db.schema"
import { Global } from "@/global"
import { desc, lt } from "drizzle-orm"
import { existsSync, readFileSync } from "fs"
import path from "path"
import { onMount } from "solid-js"
import { createStore, produce, unwrap } from "solid-js/store"
import { createSimpleContext } from "../../context/helper"
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

export const { use: usePromptHistory, provider: PromptHistoryProvider } = createSimpleContext({
  name: "PromptHistory",
  init: () => {
    const file = path.join(Global.Path.state, "prompt-history.jsonl")

    onMount(() => {
      seed(file)
      setStore("history", list())
    })

    const [store, setStore] = createStore({
      index: 0,
      history: [] as PromptInfo[],
    })

    return {
      move(direction: 1 | -1, input: string) {
        if (!store.history.length) return undefined
        const current = store.history.at(store.index)
        if (!current) return undefined
        if (current.input !== input && input.length) return
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
        const entry = structuredClone(unwrap(item))
        setStore(
          produce((draft) => {
            draft.history.push(entry)
            if (draft.history.length > MAX_HISTORY_ENTRIES) {
              draft.history = draft.history.slice(-MAX_HISTORY_ENTRIES)
            }
            draft.index = 0
          }),
        )
        write(entry)
      },
    }
  },
})

function seed(file: string) {
  ClientDatabase.transaction((db) => {
    const row = db.select({ id: ClientPromptHistoryTable.id }).from(ClientPromptHistoryTable).limit(1).get()
    if (row) return
    if (!existsSync(file)) return

    const now = Date.now()
    const rows = readFileSync(file, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })
      .filter((item): item is PromptInfo => item !== null)
      .slice(-MAX_HISTORY_ENTRIES)
      .map((data) => ({
        data,
        time_created: now,
      }))

    if (rows.length === 0) return
    db.insert(ClientPromptHistoryTable).values(rows).run()
  })
}

function list() {
  return ClientDatabase.use((db) =>
    db
      .select({ data: ClientPromptHistoryTable.data })
      .from(ClientPromptHistoryTable)
      .orderBy(desc(ClientPromptHistoryTable.id))
      .limit(MAX_HISTORY_ENTRIES)
      .all(),
  )
    .reverse()
    .map((row) => row.data as PromptInfo)
}

function write(data: PromptInfo) {
  ClientDatabase.transaction((db) => {
    db.insert(ClientPromptHistoryTable)
      .values({
        data,
        time_created: Date.now(),
      })
      .run()

    const row = db
      .select({ id: ClientPromptHistoryTable.id })
      .from(ClientPromptHistoryTable)
      .orderBy(desc(ClientPromptHistoryTable.id))
      .offset(MAX_HISTORY_ENTRIES - 1)
      .limit(1)
      .get()
    if (!row) return

    db.delete(ClientPromptHistoryTable).where(lt(ClientPromptHistoryTable.id, row.id)).run()
  })
}

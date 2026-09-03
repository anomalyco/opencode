import path from "path"
import { readFileSync } from "fs"
import { createSignal } from "solid-js"
import { unwrap } from "solid-js/store"
import { createSimpleContext } from "../context/helper"
import { useTuiPaths } from "../context/runtime"
import { useStorage } from "../context/storage"
import { parsePromptInfo, type PromptInfo } from "./history"

export type StashEntry = {
  id: string
  prompt: PromptInfo
  timestamp: number
}

export const MAX_STASH_ENTRIES = 50

export function parsePromptStash(text: string) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        const value = JSON.parse(line) as unknown
        if (!value || typeof value !== "object") return
        const entry = value as Record<string, unknown>
        const prompt = parsePromptInfo(entry.prompt)
        if (!prompt || typeof entry.timestamp !== "number") return
        return { prompt, timestamp: entry.timestamp }
      } catch {
        return undefined
      }
    })
    .filter((line): line is Omit<StashEntry, "id"> => line !== undefined)
    .slice(-MAX_STASH_ENTRIES)
}

export const { use: usePromptStash, provider: PromptStashProvider } = createSimpleContext({
  name: "PromptStash",
  init: () => {
    const paths = useTuiPaths()
    const storage = useStorage()
    const [store, update] = storage.store("prompt-stash", {
      scope: "global",
      initial: { migrated: false, entries: [] as StashEntry[] },
    })
    // Import under the same lock as mutations. The marker survives an empty stash,
    // so another startup cannot restore prompts that were already consumed.
    const ready = store.migrated
      ? Promise.resolve()
      : update((draft) => {
          if (draft.migrated) return
          draft.migrated = true
          try {
            const text = readFileSync(path.join(paths.state, "prompt-stash.jsonl"), "utf8")
            draft.entries = parsePromptStash(text).map((entry) => ({ ...entry, id: crypto.randomUUID() }))
          } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT") return
            throw error
          }
        })
    void ready.catch((error) => console.error("Failed to load prompt stash", error))

    const [pending, setPending] = createSignal(0)
    function mutate(mutation: Parameters<typeof update>[0]) {
      setPending((count) => count + 1)
      return ready.then(() => update(mutation)).finally(() => setPending((count) => count - 1))
    }

    return {
      pending: () => pending() > 0,
      list() {
        return store.entries
      },
      async push(entry: Pick<StashEntry, "prompt">) {
        const stash = structuredClone(unwrap({ ...entry, id: crypto.randomUUID(), timestamp: Date.now() }))
        await mutate((draft) => {
          draft.entries.push(stash)
          draft.entries = draft.entries.slice(-MAX_STASH_ENTRIES)
        })
      },
      async pop() {
        let entry: StashEntry | undefined
        await mutate((draft) => {
          entry = draft.entries.pop()
        })
        return entry
      },
      async remove(id: string) {
        let entry: StashEntry | undefined
        await mutate((draft) => {
          const index = draft.entries.findIndex((entry) => entry.id === id)
          if (index !== -1) entry = draft.entries.splice(index, 1)[0]
        })
        return entry
      },
    }
  },
})

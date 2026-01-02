import path from "path"
import { Global } from "@/global"
import { onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "../../context/helper"
import { appendFile } from "fs/promises"

function calculateFrecency(entry?: { frequency: number; lastOpen: number }): number {
  if (!entry) return 0
  const daysSince = (Date.now() - entry.lastOpen) / 86400000 // ms per day
  const weight = 1 / (1 + daysSince)
  return entry.frequency * weight
}

export const { use: useFrecency, provider: FrecencyProvider } = createSimpleContext({
  name: "Frecency",
  init: () => {
    const frecencyFile = Bun.file(path.join(Global.Path.state, "frecency.jsonl"))
    onMount(async () => {
      const text = await frecencyFile.text().catch(() => "")
      const lines = text
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line) as { path: string; frequency: number; lastOpen: number }
          } catch {
            return null
          }
        })
        .filter((line): line is { path: string; frequency: number; lastOpen: number } => line !== null)

      const latest = lines.reduce(
        (acc, entry) => {
          acc[entry.path] = entry
          return acc
        },
        {} as Record<string, { path: string; frequency: number; lastOpen: number }>,
      )

      setStore(
        "data",
        Object.fromEntries(
          Object.entries(latest).map(([k, v]) => [k, { frequency: v.frequency, lastOpen: v.lastOpen }]),
        ),
      )

      if (Object.keys(latest).length > 0) {
        const content =
          Object.values(latest)
            .map((entry) => JSON.stringify(entry))
            .join("\n") + "\n"
        Bun.write(frecencyFile, content).catch(() => {})
      }
    })

    const [store, setStore] = createStore({
      data: {} as Record<string, { frequency: number; lastOpen: number }>,
    })

    function updateFrecency(filePath: string) {
      const absolutePath = path.resolve(process.cwd(), filePath)
      const newEntry = {
        frequency: (store.data[absolutePath]?.frequency || 0) + 1,
        lastOpen: Date.now(),
      }
      setStore("data", absolutePath, newEntry)
      appendFile(frecencyFile.name!, JSON.stringify({ path: absolutePath, ...newEntry }) + "\n").catch(() => {})
    }

    return {
      getFrecency: (filePath: string) => calculateFrecency(store.data[path.resolve(process.cwd(), filePath)]),
      updateFrecency,
      data: () => store.data,
    }
  },
})

import path from "path"
import { onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "../context/helper"
import { useTuiPaths } from "../context/runtime"
import { appendText, readText, writeText } from "../util/persistence"
import { isRecord } from "../util/record"

type FrecencyEntry = { path: string; frequency: number; lastOpen: number }

export const MAX_FRECENCY_ENTRIES = 1000

export function parseFrecency(text: string) {
  const latest = text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return parseFrecencyEntry(JSON.parse(line))
      } catch {
        return undefined
      }
    })
    .filter((line): line is FrecencyEntry => line !== undefined)
    .reduce<Record<string, FrecencyEntry>>((result, entry) => {
      result[entry.path] = entry
      return result
    }, {})
  return Object.values(latest)
    .sort((a, b) => b.lastOpen - a.lastOpen)
    .slice(0, MAX_FRECENCY_ENTRIES)
}

function calculateFrecency(entry?: { frequency: number; lastOpen: number }) {
  if (!entry) return 0
  return entry.frequency / (1 + (Date.now() - entry.lastOpen) / 86400000)
}

// A parseable line can still carry no usable path or a broken counter, and the store rewrites every
// retained entry, so a bad one would survive the repair pass. Keep only whole entries.
function parseFrecencyEntry(value: unknown): FrecencyEntry | undefined {
  if (!isRecord(value)) return
  if (typeof value.path !== "string" || !value.path) return
  if (typeof value.frequency !== "number" || !Number.isFinite(value.frequency)) return
  if (typeof value.lastOpen !== "number" || !Number.isFinite(value.lastOpen)) return
  return { path: value.path, frequency: value.frequency, lastOpen: value.lastOpen }
}

export const { use: useFrecency, provider: FrecencyProvider } = createSimpleContext({
  name: "Frecency",
  init: () => {
    const paths = useTuiPaths()
    const frecencyPath = path.join(paths.state, "frecency.jsonl")
    onMount(async () => {
      const lines = parseFrecency(await readText(frecencyPath).catch(() => ""))
      setStore(
        "data",
        Object.fromEntries(
          lines.map((entry) => [entry.path, { frequency: entry.frequency, lastOpen: entry.lastOpen }]),
        ),
      )
      if (lines.length > 0)
        writeText(frecencyPath, lines.map((entry) => JSON.stringify(entry)).join("\n") + "\n").catch(() => {})
    })

    const [store, setStore] = createStore({ data: {} as Record<string, { frequency: number; lastOpen: number }> })

    function updateFrecency(filePath: string) {
      const absolutePath = path.resolve(paths.cwd, filePath)
      const newEntry = { frequency: (store.data[absolutePath]?.frequency || 0) + 1, lastOpen: Date.now() }
      setStore("data", absolutePath, newEntry)
      appendText(frecencyPath, JSON.stringify({ path: absolutePath, ...newEntry }) + "\n").catch(() => {})

      if (Object.keys(store.data).length <= MAX_FRECENCY_ENTRIES) return
      const sorted = Object.entries(store.data)
        .sort(([, a], [, b]) => b.lastOpen - a.lastOpen)
        .slice(0, MAX_FRECENCY_ENTRIES)
      setStore("data", Object.fromEntries(sorted))
      writeText(
        frecencyPath,
        sorted.map(([entryPath, entry]) => JSON.stringify({ path: entryPath, ...entry })).join("\n") + "\n",
      ).catch(() => {})
    }

    return {
      getFrecency: (filePath: string) => calculateFrecency(store.data[path.resolve(paths.cwd, filePath)]),
      updateFrecency,
      data: () => store.data,
    }
  },
})

// TUI-local per-model reliability/throughput stats, recorded from
// message.updated events and persisted to the TUI state directory.
// ponytail: client-local observations only (this TUI's own traffic), exact
// tok/s from completed messages, not a server-side aggregate — a shared
// cross-device version would need a core endpoint (possible follow-up).

import { createStore, reconcile, unwrap } from "solid-js/store"
import { Flock } from "@opencode-ai/core/util/flock"
import { readJson, writeJsonAtomic } from "./persistence"
import path from "path"

const MAX_SAMPLES = 10
const ERROR_WINDOW_MS = 15 * 60 * 1000
const LOCK = "tui-model-stats"

export type ModelStat = {
  samples: number[]
  errors: number
  lastErrorAt?: number
}

const [stats, setStats] = createStore<Record<string, ModelStat>>({})
export { stats as modelStats }

const seen = new Set<string>()
let stateDir: string | undefined
let writeTimer: ReturnType<typeof setTimeout> | undefined

function file() {
  return path.join(stateDir!, "model-stats.json")
}

function persist() {
  if (!stateDir) return
  clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    void Flock.withLock(LOCK, () => writeJsonAtomic(file(), unwrap(stats)))
  }, 300)
}

export function initModelStats(dir: string) {
  if (stateDir) return
  stateDir = dir
  void Flock.withLock(LOCK, async () => {
    const stored = await readJson<Record<string, ModelStat>>(file())
    if (stored && typeof stored === "object") setStats(reconcile(stored))
  })
}

export function summarizeModelStat(stat: ModelStat | undefined) {
  if (!stat) return undefined
  const avg = stat.samples.length
    ? Math.round(stat.samples.reduce((a, b) => a + b, 0) / stat.samples.length)
    : undefined
  const healthy = !stat.lastErrorAt || Date.now() - stat.lastErrorAt > ERROR_WINDOW_MS
  return { avg, healthy }
}

export function recordModelEvent(event: { type: string; properties?: any }) {
  try {
    if (!event || event.type !== "message.updated") return
    const info = event.properties?.info
    if (!info || info.role !== "assistant") return
    const key = `${info.providerID}/${info.modelID}`
    if (!info.providerID || !info.modelID) return

    if (info.error) {
      if (!seen.has(info.id)) {
        seen.add(info.id)
        const prev = stats[key] ?? { samples: [], errors: 0 }
        setStats(key, { samples: prev.samples, errors: prev.errors + 1, lastErrorAt: Date.now() })
        persist()
      }
      return
    }

    if (seen.has(info.id)) return
    const time = info.time ?? {}
    if (typeof time.completed !== "number" || typeof time.created !== "number") return
    seen.add(info.id)

    const output = info.tokens?.output ?? 0
    const seconds = (time.completed - time.created) / 1000
    if (output <= 0 || seconds <= 0 || info.finish === "error") return

    const prev = stats[key] ?? { samples: [], errors: 0 }
    const tps = Math.round((output / seconds) * 10) / 10
    setStats(key, { ...prev, samples: [...prev.samples, tps].slice(-MAX_SAMPLES) })
    persist()
  } catch {
    // stats must never break the event loop
  }
}

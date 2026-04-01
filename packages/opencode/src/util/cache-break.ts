const MAX_SOURCES = 10

type Snapshot = {
  system: number
  tools: number
  model: string
  calls: number
  prev: number | null
}

const sources = new Map<string, Snapshot>()

function hash(str: string): number {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0
  }
  return h >>> 0
}

export function record(id: string, system: string, tools: string, model: string, cache: number) {
  if (sources.size >= MAX_SOURCES && !sources.has(id)) {
    const oldest = sources.keys().next().value
    if (oldest) sources.delete(oldest)
  }
  const prev = sources.get(id)
  sources.set(id, {
    system: hash(system),
    tools: hash(tools),
    model,
    calls: (prev?.calls ?? 0) + 1,
    prev: cache,
  })
}

export type BreakReason = "system" | "tools" | "model" | "unknown"

export function detect(id: string, system: string, tools: string, model: string, cache: number): BreakReason | null {
  const snap = sources.get(id)
  if (!snap) return null
  if (snap.prev !== null && cache === 0 && snap.prev > 0) {
    if (hash(system) !== snap.system) return "system"
    if (hash(tools) !== snap.tools) return "tools"
    if (model !== snap.model) return "model"
    return "unknown"
  }
  return null
}

export function clear(id: string) {
  sources.delete(id)
}

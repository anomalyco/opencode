import path from "path"

type MessageWithParts = {
  parts: Array<Record<string, unknown>>
}

export type ReadFileRange = {
  path: string
  start: number
  end: number
}

export type ReadFile = {
  path: string
  ranges: Array<{ start: number; end: number }>
  autoLoaded: boolean
}

function mergeRanges(ranges: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  if (ranges.length === 0) return []

  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const merged: Array<{ start: number; end: number }> = []

  let current = sorted[0]
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]
    if (next.start <= current.end + 1) {
      current.end = Math.max(current.end, next.end)
    } else {
      merged.push(current)
      current = next
    }
  }
  merged.push(current)

  return merged
}

export function extractReadFiles(messages: MessageWithParts[]): ReadFile[] {
  const filesMap = new Map<string, { ranges: Array<{ start: number; end: number }>; autoLoaded: Set<string> }>()

  for (const msg of messages) {
    for (const part of msg.parts) {
      const p = part as {
        type: string
        tool?: string
        state: { status: string; input: Record<string, unknown>; output?: string; metadata?: { loaded?: unknown } }
      }
      if (p.type !== "tool" || p.tool !== "read" || p.state.status !== "completed") continue

      const input = p.state.input
      const filePath = path.resolve(input.filePath as string)

      const offset = (input.offset as number | undefined) ?? 1
      const limit = (input.limit as number | undefined) ?? 2000
      let end = offset + limit - 1

      if (p.state.output) {
        const lines = p.state.output.split("\n").length
        const actualEnd = offset + lines - 1
        if (actualEnd < end) end = actualEnd
      }

      const existing = filesMap.get(filePath) ?? { ranges: [], autoLoaded: new Set() }
      existing.ranges.push({ start: offset, end })
      filesMap.set(filePath, existing)

      const loaded = p.state.metadata?.loaded
      if (loaded && Array.isArray(loaded)) {
        for (const p of loaded) {
          if (typeof p === "string") {
            const absPath = path.resolve(p)
            const autoLoadedEntry = filesMap.get(absPath) ?? { ranges: [], autoLoaded: new Set() }
            autoLoadedEntry.autoLoaded.add(absPath)
            filesMap.set(absPath, autoLoadedEntry)
          }
        }
      }
    }
  }

  const result: ReadFile[] = []
  for (const [filePath, data] of filesMap) {
    result.push({
      path: filePath,
      ranges: mergeRanges(data.ranges),
      autoLoaded: data.autoLoaded.size > 0,
    })
  }

  return result.sort((a, b) => path.basename(a.path).localeCompare(path.basename(b.path)))
}

export function formatReadFile(file: ReadFile): string {
  const filename = path.basename(file.path)
  if (file.ranges.length === 0 && file.autoLoaded) {
    return `${filename} (auto-loaded)`
  }
  const rangeStr = file.ranges.map((r) => `${r.start}-${r.end}`).join(", ")
  const suffix = file.autoLoaded ? " (auto-loaded)" : ""
  return `${filename}: ${rangeStr}${suffix}`
}

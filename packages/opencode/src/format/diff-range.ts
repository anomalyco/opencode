import { diffLines } from "diff"

const ADJACENT_THRESHOLD = 6
const encoder = new TextEncoder()

export type DiffRange = {
  start: number
  end: number
  byteStart?: number
  byteEnd?: number
}

export const DiffRange = {
  create(start: number, len: number, byte: number, blen: number) {
    return { start, end: start + len, byteStart: byte, byteEnd: byte + blen }
  },

  toJSON(r: DiffRange) {
    return {
      start: r.start,
      end: r.end,
      byteOffset: r.byteStart,
      byteLength: r.byteEnd != null && r.byteStart != null ? r.byteEnd - r.byteStart : undefined,
    }
  },

  merge(a: DiffRange, b: DiffRange): DiffRange {
    const has = a.byteStart != null && a.byteEnd != null && b.byteStart != null && b.byteEnd != null
    return {
      start: Math.min(a.start, b.start),
      end: Math.max(a.end, b.end),
      byteStart: has ? Math.min(a.byteStart!, b.byteStart!) : undefined,
      byteEnd: has ? Math.max(a.byteEnd!, b.byteEnd!) : undefined,
    }
  },

  adjacent(a: DiffRange, b: DiffRange): boolean {
    return b.start - a.end <= ADJACENT_THRESHOLD
  },
}

function mapping(content: string) {
  const map: number[] = []
  const bytes: number[] = []
  let coff = 0
  let boff = 0
  const chars = Array.from(content)

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]!
    map.push(coff)
    bytes.push(boff)
    if (char === "\r" && chars[i + 1] === "\n") {
      boff += 2
      coff += 2
      i++
    } else {
      boff += encoder.encode(char).length
      coff += char.length // code units (2 for supplementary chars like emoji)
    }
  }
  map.push(coff)
  bytes.push(boff)

  return { map, bytes }
}

export function calculateRanges(oldContent: string, newContent: string): DiffRange[] {
  const m = mapping(newContent)
  const changes = diffLines(oldContent.replace(/\r\n/g, "\n"), newContent.replace(/\r\n/g, "\n"))
  const result: DiffRange[] = []
  let offset = 0

  for (const change of changes) {
    if (change.added) {
      const len = Array.from(change.value).length
      const start = m.map[offset] ?? newContent.length
      const idx = offset + len
      const end = idx < m.map.length ? m.map[idx]! : newContent.length
      result.push(
        DiffRange.create(
          start,
          end - start,
          m.bytes[offset]!,
          (idx < m.bytes.length ? m.bytes[idx]! : m.bytes[m.bytes.length - 1]!) - m.bytes[offset]!,
        ),
      )
      offset += len
    } else if (change.removed) {
      const start = m.map[offset] ?? newContent.length
      result.push(DiffRange.create(start, 0, m.bytes[offset] ?? m.bytes[m.bytes.length - 1] ?? 0, 0))
    } else {
      offset += Array.from(change.value).length
    }
  }

  return merge(result)
}

function merge(ranges: DiffRange[]): DiffRange[] {
  if (!ranges.length) return ranges
  return ranges.reduce((acc, r) => {
    const last = acc[acc.length - 1]
    if (last && DiffRange.adjacent(last, r)) acc[acc.length - 1] = DiffRange.merge(last, r)
    else acc.push(r)
    return acc
  }, [] as DiffRange[])
}

export interface TimelineNavRect {
  id: string
  top: number
  bottom: number
}

export function pickTimelineNavMessage(input: {
  line: number
  viewportTop: number
  viewportBottom: number
  items: TimelineNavRect[]
}): string | undefined {
  const shown = input.items.filter((item) => item.bottom > input.viewportTop && item.top < input.viewportBottom)
  const hit = shown.find((item) => item.top <= input.line && item.bottom >= input.line)
  if (hit) return hit.id

  const near = [...shown].sort((a, b) => {
    const da = Math.abs(a.top - input.line)
    const db = Math.abs(b.top - input.line)
    if (da !== db) return da - db
    return a.top - b.top
  })[0]
  if (near) return near.id

  return input.items.filter((item) => item.top <= input.line).at(-1)?.id ?? input.items[0]?.id
}

export function layoutTimelineNavBeads(input: {
  count: number
  height: number
  maxSize?: number
  minSize?: number
  gap?: number
  minGap?: number
}): { size: number; gap: number; overflow: boolean } {
  const maxSize = input.maxSize ?? 8
  const minSize = input.minSize ?? 4
  const gap = input.gap ?? 4
  const minGap = input.minGap ?? 2
  if (input.count <= 0 || input.height <= 0) return { size: maxSize, gap, overflow: false }

  const gaps = Math.max(0, input.count - 1)
  const total = input.count * maxSize + gaps * gap
  if (total <= input.height) return { size: maxSize, gap, overflow: false }

  const size = (input.height - gaps * gap) / input.count
  if (size >= minSize) return { size: Math.floor(size), gap, overflow: false }

  const need = input.count * minSize + gaps * minGap
  if (need <= input.height) return { size: minSize, gap: minGap, overflow: false }

  return { size: minSize, gap: minGap, overflow: true }
}

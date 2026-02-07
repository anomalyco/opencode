import type { Message } from "@opencode-ai/sdk/v2"

const text = (value: unknown) => {
  if (typeof value === "string") return value
  if (typeof value === "number") return String(value)
  if (typeof value === "boolean") return String(value)
  return undefined
}

const message = (value: unknown) => {
  if (typeof value !== "object" || value === null) return undefined
  return text((value as Record<string, unknown>).message)
}

export const windowOldest = (messages: Message[], pinned?: string) => {
  if (!pinned) return messages.at(0)?.id
  for (const msg of messages) {
    if (msg.id !== pinned) return msg.id
  }
  return undefined
}

export const windowNewest = (messages: Message[], pinned?: string) => {
  if (!pinned) return messages.at(-1)?.id
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]
    if (msg && msg.id !== pinned) return msg.id
  }
  return undefined
}

export const evictFromStart = (messages: Message[], count: number, pinned?: string) => {
  const evicted: Message[] = []
  if (count <= 0) return evicted
  let index = 0
  while (index < messages.length && evicted.length < count) {
    const msg = messages[index]
    if (!msg) break
    if (msg.id !== pinned) {
      evicted.push(msg)
      messages.splice(index, 1)
      continue
    }
    index += 1
  }
  return evicted
}

export const evictFromEnd = (messages: Message[], count: number, pinned?: string) => {
  const evicted: Message[] = []
  if (count <= 0) return evicted
  let index = messages.length - 1
  while (index >= 0 && evicted.length < count) {
    const msg = messages[index]
    if (!msg) break
    if (msg.id !== pinned) {
      evicted.push(msg)
      messages.splice(index, 1)
    }
    index -= 1
  }
  return evicted
}

export const paginationError = (error: unknown) => {
  if (error instanceof Error) return error.message
  const plain = text(error)
  if (plain) return plain
  const direct = message(error)
  if (direct) return direct
  if (typeof error === "object" && error !== null) {
    const nested = message((error as Record<string, unknown>).error)
    if (nested) return nested
    return Bun.inspect(error)
  }
  return "Unknown error"
}

export const queueBoundaryLoad = (
  delta: number,
  older: () => void,
  newer: () => void,
  queue: (run: () => void) => void = (run) => {
    setTimeout(run, 0)
  },
) => {
  if (delta < 0) {
    queue(older)
    return
  }
  if (delta > 0) queue(newer)
}

type Edges = {
  nearTop: boolean
  nearBottom: boolean
}

export const edgeHints = (
  scrollTop: number,
  scrollHeight: number,
  viewportHeight: number,
  threshold: number,
): Edges => {
  return {
    nearTop: scrollTop <= threshold,
    nearBottom: scrollHeight - scrollTop - viewportHeight <= threshold,
  }
}

type Anchor = {
  id: string
  offset: number
}

type Child = {
  id?: string
  y: number
  height: number
}

export const olderScrollTarget = (
  children: Child[],
  nextHeight: number,
  prevHeight: number,
  prevTop: number,
  anchor?: Anchor,
) => {
  if (anchor) {
    const child = children.find((item) => item.id === anchor.id)
    if (child) return child.y + anchor.offset
  }
  const delta = nextHeight - prevHeight
  if (delta > 0) return prevTop + delta
  return undefined
}

import type { Message } from "@opencode-ai/sdk/v2"

type Timed = {
  id: string
  time: {
    created: number
  }
}

const compare = (a: Timed, b: Timed) => {
  if (a.time.created !== b.time.created) return a.time.created - b.time.created
  if (a.id < b.id) return -1
  if (a.id > b.id) return 1
  return 0
}

export const messageInsert = <T extends Timed>(messages: T[], message: T) => {
  let left = 0
  let right = messages.length
  while (left < right) {
    const mid = (left + right) >>> 1
    const current = messages[mid]
    if (!current) break
    if (compare(current, message) < 0) left = mid + 1
    else right = mid
  }
  const found = left < messages.length && compare(messages[left]!, message) === 0
  return { found, index: left }
}

export const messageBefore = (a: Timed, b: Timed) => compare(a, b) < 0

export const revertMessageState = (message: Timed, boundaryID?: string, boundary?: Timed, boundaryPartID?: string) => {
  if (boundaryID && !boundary) return { showBanner: false, showMessage: false }
  const atBoundary = message.id === boundary?.id
  return {
    showBanner: atBoundary,
    showMessage: !boundary || messageBefore(message, boundary) || (atBoundary && !!boundaryPartID),
  }
}

export const hasBeforeBoundary = <T extends Timed>(messages: T[], boundary?: Timed) => {
  if (!boundary) return true
  return messages.some((message) => messageBefore(message, boundary))
}

export const hasUserBeforeBoundary = <T extends Timed & { role: string }>(messages: T[], boundary?: Timed) => {
  if (!boundary) return true
  return messages.some((message) => message.role === "user" && messageBefore(message, boundary))
}

export const visibleBeforeBoundary = <T extends { info: Timed }>(
  messages: T[],
  boundaryID?: string,
  boundary?: Timed,
  options?: { includeBoundary?: boolean },
) => {
  if (!boundaryID) return messages
  const resolved = boundary ?? messages.find((message) => message.info.id === boundaryID)?.info
  if (!resolved) return []
  return messages.filter(
    (message) =>
      messageBefore(message.info, resolved) || (options?.includeBoundary === true && message.info.id === resolved.id),
  )
}

export const visiblePartsBeforeBoundary = <T extends { id: string }>(parts: T[], boundaryPartID?: string) => {
  if (!boundaryPartID) return parts
  const index = parts.findIndex((part) => part.id === boundaryPartID)
  if (index === -1) return []
  return parts.slice(0, index)
}

type ValidatablePart = { type: string; synthetic?: boolean; ignored?: boolean }

// The newest user message a human actually typed: a user message carrying at least one
// real text part (not synthetic, not ignored). Scans newest-first and returns the match.
export const lastValidUser = <T extends { id: string; role: string }>(
  messages: T[],
  partsFor: (id: string) => readonly ValidatablePart[] | undefined,
) => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (!message || message.role !== "user") continue
    const parts = partsFor(message.id)
    if (!parts) continue
    if (parts.some((part) => part.type === "text" && !part.synthetic && !part.ignored)) return message
  }
  return undefined
}

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

type Pinned = string | ReadonlySet<string>

const isPinned = (id: string, pinned?: Pinned) =>
  typeof pinned === "string" ? id === pinned : (pinned?.has(id) ?? false)

export const evictFromStart = (messages: Message[], count: number, pinned?: Pinned) => {
  const evicted: Message[] = []
  if (count <= 0) return evicted
  let index = 0
  while (index < messages.length && evicted.length < count) {
    const msg = messages[index]
    if (!msg) break
    if (!isPinned(msg.id, pinned)) {
      evicted.push(msg)
      messages.splice(index, 1)
      continue
    }
    index += 1
  }
  return evicted
}

export const evictFromEnd = (messages: Message[], count: number, pinned?: Pinned) => {
  const evicted: Message[] = []
  if (count <= 0) return evicted
  let index = messages.length - 1
  while (index >= 0 && evicted.length < count) {
    const msg = messages[index]
    if (!msg) break
    if (!isPinned(msg.id, pinned)) {
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

export const olderSearchCanContinue = (
  previousCursor: string | undefined,
  page: { hasOlder: boolean; loading: boolean; olderCursor?: string } | undefined,
) => !!page?.hasOlder && !page.loading && !!page.olderCursor && page.olderCursor !== previousCursor

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

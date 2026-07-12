export type SearchableMessage = {
  id: string
  role: string
}

export type SearchablePart = {
  id: string
  type: string
  text?: string
  synthetic?: boolean
}

export type SearchUnit = {
  /** Scrollbox child id to jump to: message id for user messages, part id for assistant parts. */
  anchorID: string
  messageID: string
  role: "user" | "assistant"
  kind: "text" | "reasoning"
  /** Exactly the text the TUI renders for this unit, so hit offsets line up with what is on screen. */
  text: string
}

export type SearchHit = SearchUnit & {
  start: number
  end: number
  /** 0-based line index of the match start within the unit text. */
  line: number
}

export type SearchDirection = "next" | "previous"

const MAX_HITS = 1000
const MAX_SEGMENTS = 200

export function collectSearchUnits(
  messages: readonly SearchableMessage[],
  parts: Record<string, readonly SearchablePart[] | undefined>,
  revertMessageID?: string,
): SearchUnit[] {
  return messages.flatMap((message) => {
    // Messages at or past the revert point render nothing (see the revert branch in routes/session).
    if (revertMessageID && message.id >= revertMessageID) return []
    const list = parts[message.id] ?? []
    if (message.role === "user") {
      // Mirrors UserMessage's text() memo: non-synthetic text parts joined with blank lines.
      const text = list
        .filter((part) => part.type === "text" && !part.synthetic && part.text)
        .map((part) => part.text)
        .join("\n\n")
      if (!text) return []
      return [{ anchorID: message.id, messageID: message.id, role: "user" as const, kind: "text" as const, text }]
    }
    if (message.role !== "assistant") return []
    return list.flatMap((part): SearchUnit[] => {
      if (part.type === "text") {
        // Mirrors TextPart: trimmed text, skipped when blank.
        const text = part.text?.trim()
        if (!text) return []
        return [{ anchorID: part.id, messageID: message.id, role: "assistant" as const, kind: "text" as const, text }]
      }
      if (part.type === "reasoning") {
        // Mirrors ReasoningPart's content() memo.
        const text = part.text?.replace("[REDACTED]", "").trim()
        if (!text) return []
        return [
          { anchorID: part.id, messageID: message.id, role: "assistant" as const, kind: "reasoning" as const, text },
        ]
      }
      return []
    })
  })
}

function searchPattern(query: string) {
  const trimmed = query.trim()
  if (!trimmed) return
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  // Smartcase: any uppercase letter in the query makes the search case-sensitive.
  const flags = /\p{Lu}/u.test(query) ? "gu" : "giu"
  return new RegExp(escaped, flags)
}

export function findSearchHits(units: readonly SearchUnit[], query: string): SearchHit[] {
  const pattern = searchPattern(query)
  if (!pattern) return []

  const hits: SearchHit[] = []
  for (const unit of units) {
    pattern.lastIndex = 0
    let match = pattern.exec(unit.text)
    while (match && hits.length < MAX_HITS) {
      hits.push({
        ...unit,
        start: match.index,
        end: match.index + match[0].length,
        line: countLines(unit.text, match.index),
      })
      match = pattern.exec(unit.text)
    }
    if (hits.length >= MAX_HITS) break
  }
  return hits
}

function countLines(text: string, end: number) {
  let count = 0
  for (let index = text.indexOf("\n"); index !== -1 && index < end; index = text.indexOf("\n", index + 1)) {
    count += 1
  }
  return count
}

export function moveSearchIndex(total: number, current: number, direction: SearchDirection) {
  if (total <= 0) return -1
  const offset = direction === "next" ? 1 : -1
  return (current + offset + total) % total
}

/**
 * Picks the starting hit relative to the current viewport.
 * "previous" (reverse search) prefers the last hit at or above the viewport bottom;
 * "next" prefers the first hit at or below the viewport top. Both wrap.
 */
export function initialSearchIndex(
  ys: readonly (number | undefined)[],
  viewportTop: number,
  viewportBottom: number,
  direction: SearchDirection,
) {
  const positioned = ys.flatMap((y, index) => (y === undefined ? [] : [{ index, y }]))
  if (!positioned.length) return -1
  if (direction === "previous") {
    const above = positioned.filter((entry) => entry.y <= viewportBottom)
    return (above.at(-1) ?? positioned.at(-1))!.index
  }
  const below = positioned.find((entry) => entry.y >= viewportTop)
  return (below ?? positioned[0]).index
}

export type HighlightSegment = {
  text: string
  start: number
  match: boolean
}

export function highlightSegments(text: string, query: string): HighlightSegment[] {
  const pattern = searchPattern(query)
  if (!pattern) return [{ text, start: 0, match: false }]

  const segments: HighlightSegment[] = []
  let cursor = 0
  let match = pattern.exec(text)
  while (match && segments.length < MAX_SEGMENTS) {
    if (match.index > cursor) segments.push({ text: text.slice(cursor, match.index), start: cursor, match: false })
    segments.push({ text: match[0], start: match.index, match: true })
    cursor = match.index + match[0].length
    match = pattern.exec(text)
  }
  if (!segments.length) return [{ text, start: 0, match: false }]
  if (cursor < text.length) segments.push({ text: text.slice(cursor), start: cursor, match: false })
  return segments
}

export type SearchPreview = {
  before: string
  match: string
  after: string
}

export function searchPreview(hit: SearchHit, width: number): SearchPreview {
  const lineStart = hit.text.lastIndexOf("\n", hit.start - 1) + 1
  const lineEndIndex = hit.text.indexOf("\n", hit.start)
  const lineEnd = lineEndIndex === -1 ? hit.text.length : lineEndIndex
  const match = hit.text.slice(hit.start, Math.min(hit.end, lineEnd))
  const before = hit.text.slice(lineStart, hit.start)
  const after = hit.text.slice(Math.min(hit.end, lineEnd), lineEnd)

  const budget = Math.max(8, width) - match.length
  if (budget <= 0) return { before: "", match: match.slice(0, Math.max(8, width)), after: "" }
  if (before.length + after.length <= budget) return { before, match, after }

  const beforeBudget = Math.min(before.length, Math.max(Math.floor(budget * 0.4), budget - after.length))
  const afterBudget = budget - beforeBudget
  return {
    before: before.length > beforeBudget ? "…" + before.slice(before.length - beforeBudget + 1) : before,
    match,
    after: after.length > afterBudget ? after.slice(0, Math.max(0, afterBudget - 1)) + "…" : after,
  }
}

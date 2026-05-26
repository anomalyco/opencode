import type { Part as PartType } from "@opencode-ai/sdk/v2"

type PartRef = {
  messageID: string
  partID: string
}

export type PartGroup =
  | {
      key: string
      type: "part"
      ref: PartRef
    }
  | {
      key: string
      type: "context"
      refs: PartRef[]
    }

export function orderTextReasoningSegments<T>(
  items: readonly T[],
  partOf: (item: T) => PartType,
  boundaryOf?: (item: T) => string,
) {
  const result: T[] = []
  let segment: T[] = []
  let boundary: string | undefined

  const flush = () => {
    if (segment.length === 0) return
    result.push(
      ...segment.filter((item) => partOf(item).type === "reasoning"),
      ...segment.filter((item) => partOf(item).type !== "reasoning"),
    )
    segment = []
    boundary = undefined
  }

  for (const item of items) {
    const part = partOf(item)
    const nextBoundary = boundaryOf?.(item)
    if (part.type === "reasoning" || part.type === "text") {
      if (segment.length > 0 && nextBoundary !== boundary) flush()
      boundary = nextBoundary
      segment.push(item)
      continue
    }

    flush()
    result.push(item)
  }

  flush()
  return result
}

export function groupParts(
  parts: { messageID: string; part: PartType }[],
  isContextGroupTool: (part: PartType) => boolean,
) {
  const ordered = orderTextReasoningSegments(
    parts,
    (item) => item.part,
    (item) => item.messageID,
  )
  const result: PartGroup[] = []
  let start = -1

  const flush = (end: number) => {
    if (start < 0) return
    const first = ordered[start]
    const last = ordered[end]
    if (!first || !last) {
      start = -1
      return
    }
    result.push({
      key: `context:${first.part.id}`,
      type: "context",
      refs: ordered.slice(start, end + 1).map((item) => ({
        messageID: item.messageID,
        partID: item.part.id,
      })),
    })
    start = -1
  }

  ordered.forEach((item, index) => {
    if (isContextGroupTool(item.part)) {
      if (start < 0) start = index
      return
    }

    flush(index - 1)
    result.push({
      key: `part:${item.messageID}:${item.part.id}`,
      type: "part",
      ref: {
        messageID: item.messageID,
        partID: item.part.id,
      },
    })
  })

  flush(ordered.length - 1)
  return result
}

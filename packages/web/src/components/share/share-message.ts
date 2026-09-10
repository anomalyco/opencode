import { isCompleteClosurePair, type ClosureRecordCandidate } from "./closure-record"

type SharePart = ClosureRecordCandidate["parts"][number] & {
  readonly id: string
  readonly state?: { readonly status?: string }
}

type ShareMessage<T extends SharePart = SharePart> = ClosureRecordCandidate["info"] & {
  readonly parts: T[]
}

export function isLegacyShareMessage(value: unknown): value is { metadata: unknown } {
  return typeof value === "object" && value !== null && "metadata" in value
}

export function visibleShareParts<T extends SharePart>(message: ShareMessage<T>): T[] {
  const closure = isCompleteClosurePair({ info: message, parts: message.parts })
  return message.parts.filter((part, index) => {
    if (part.type === "step-start" && index > 0) return false
    if (part.type === "snapshot") return false
    if (part.type === "patch") return false
    if (part.type === "step-finish") return false
    if (part.type === "text" && part.synthetic === true && !closure) return false
    if (part.type === "text" && !part.text) return false
    if (part.type === "tool" && (part.state?.status === "pending" || part.state?.status === "running")) return false
    return true
  })
}

export function isClosureShareMessage(message: ShareMessage) {
  return isCompleteClosurePair({ info: message, parts: message.parts })
}

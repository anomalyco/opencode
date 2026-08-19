import type { PromptMention } from "@opencode-ai/schema"
import { displaySlice, promptOffsetWidth } from "./display"

export type UserMessageMention = {
  key: string
  type: "file" | "agent" | "skill"
  mention?: PromptMention
}

export type UserMessageMentionSegment = {
  text: string
  type?: UserMessageMention["type"]
}

export function renderUserMessageMentions(text: string, mentions: readonly UserMessageMention[]) {
  const candidates = mentions.flatMap((item) => {
    const mention = item.mention
    if (!mention?.text || mention.start < 0 || mention.end <= mention.start) return []
    if (mention.end > promptOffsetWidth(text)) return []
    if (!isDisplayRange(text, mention.start, mention.end)) return []
    if (displaySlice(text, mention.start, mention.end) !== mention.text) return []
    return [{ ...item, start: mention.start, end: mention.end }]
  })

  const valid = candidates
    .filter((item) => !candidates.some((other) => other.key !== item.key && overlaps(item, other)))
    .sort((left, right) => left.start - right.start || left.end - right.end || left.key.localeCompare(right.key))

  const segments: UserMessageMentionSegment[] = []
  const inline = new Set<string>()
  let cursor = 0

  for (const item of valid) {
    if (item.start < cursor) continue
    const before = displaySlice(text, cursor, item.start)
    if (before) segments.push({ text: before })
    segments.push({ text: item.mention!.text, type: item.type })
    inline.add(item.key)
    cursor = item.end
  }

  const remainder = displaySlice(text, cursor)
  if (remainder) segments.push({ text: remainder })
  if (segments.length === 0 && text) segments.push({ text })

  return { segments, inline }
}

function overlaps(left: { start: number; end: number }, right: { start: number; end: number }) {
  return left.start < right.end && left.end > right.start
}

function isDisplayRange(text: string, start: number, end: number) {
  return (
    promptOffsetWidth(displaySlice(text, 0, start)) === start && promptOffsetWidth(displaySlice(text, 0, end)) === end
  )
}

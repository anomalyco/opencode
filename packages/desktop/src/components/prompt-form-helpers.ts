import type { TextSelection } from "@/context/local"
import { getFilename } from "@/utils"

export interface PromptTextPart {
  kind: "text"
  value: string
}

export interface PromptAttachmentPart {
  kind: "attachment"
  token: string
  display: string
  path: string
  selection?: TextSelection
  origin: "context" | "active"
}

export interface PromptInterimPart {
  kind: "interim"
  value: string
  leadingSpace: boolean
}

export type PromptContentPart = PromptTextPart | PromptAttachmentPart

export type PromptDisplaySegment =
  | { kind: "text"; value: string }
  | { kind: "attachment"; part: PromptAttachmentPart; source: string }
  | PromptInterimPart

export interface AttachmentCandidate {
  origin: "context" | "active"
  path: string
  selection?: TextSelection
  display: string
}

export interface PromptSubmitValue {
  text: string
  parts: PromptContentPart[]
}

export const mentionPattern = /@([A-Za-z0-9_\-./]+)/g
export const mentionTriggerPattern = /(^|\s)@([A-Za-z0-9_\-./]*)$/

export type PromptSegment = (PromptTextPart | PromptAttachmentPart) & {
  start: number
  end: number
}

export type PromptAttachmentSegment = PromptAttachmentPart & {
  start: number
  end: number
}

function pushTextPart(parts: PromptContentPart[], value: string) {
  if (!value) return
  const last = parts[parts.length - 1]
  if (last && last.kind === "text") {
    last.value += value
    return
  }
  parts.push({ kind: "text", value })
}

function addTextSegment(segments: PromptSegment[], start: number, value: string) {
  if (!value) return
  segments.push({ kind: "text", value, start, end: start + value.length })
}

export function createAttachmentDisplay(path: string, selection?: TextSelection) {
  const base = getFilename(path)
  if (!selection) return base
  return `${base} (${selection.startLine}-${selection.endLine})`
}

export function registerCandidate(
  map: Map<string, AttachmentCandidate>,
  candidate: AttachmentCandidate,
  tokens: (string | undefined)[],
) {
  for (const token of tokens) {
    if (!token) continue
    const normalized = token.toLowerCase()
    if (map.has(normalized)) continue
    map.set(normalized, candidate)
  }
}

export function parsePrompt(value: string, lookup: Map<string, AttachmentCandidate>) {
  const segments: PromptSegment[] = []
  if (!value) return { parts: [] as PromptContentPart[], segments }

  const pushTextRange = (rangeStart: number, rangeEnd: number) => {
    if (rangeEnd <= rangeStart) return
    const text = value.slice(rangeStart, rangeEnd)
    let cursor = 0
    for (const match of text.matchAll(mentionPattern)) {
      const localIndex = match.index ?? 0
      if (localIndex > cursor) {
        addTextSegment(segments, rangeStart + cursor, text.slice(cursor, localIndex))
      }
      const token = match[1]
      const candidate = lookup.get(token.toLowerCase())
      if (candidate) {
        const start = rangeStart + localIndex
        const end = start + match[0].length
        segments.push({
          kind: "attachment",
          token,
          display: candidate.display,
          path: candidate.path,
          selection: candidate.selection,
          origin: candidate.origin,
          start,
          end,
        })
      } else {
        addTextSegment(segments, rangeStart + localIndex, match[0])
      }
      cursor = localIndex + match[0].length
    }
    if (cursor < text.length) {
      addTextSegment(segments, rangeStart + cursor, text.slice(cursor))
    }
  }

  pushTextRange(0, value.length)

  const parts: PromptContentPart[] = []
  for (const segment of segments) {
    if (segment.kind === "text") {
      pushTextPart(parts, segment.value)
    } else {
      const { start, end, ...attachment } = segment
      parts.push(attachment as PromptAttachmentPart)
    }
  }
  return { parts, segments }
}

export function composeDisplaySegments(
  segments: PromptSegment[],
  inputValue: string,
  interim: string,
): PromptDisplaySegment[] {
  if (segments.length === 0 && !interim) return []

  const display: PromptDisplaySegment[] = segments.map((segment) => {
    if (segment.kind === "text") {
      return { kind: "text", value: segment.value }
    }
    const { start, end, ...part } = segment
    const placeholder = inputValue.slice(start, end)
    return { kind: "attachment", part: part as PromptAttachmentPart, source: placeholder }
  })

  if (interim) {
    const leadingSpace = !!(inputValue && !inputValue.endsWith(" ") && !interim.startsWith(" "))
    display.push({ kind: "interim", value: interim, leadingSpace })
  }

  return display
}

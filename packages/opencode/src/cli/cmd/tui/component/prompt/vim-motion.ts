import type { VimFindType } from "./vim-types"

export type TextRange = {
  start: number
  end: number
}

export type OperatorMotion = "b" | "e" | "w" | "0" | "$"

export function clampOffset(text: string, offset: number) {
  return Math.max(0, Math.min(offset, text.length))
}

export function lineBounds(text: string, offset: number) {
  const clamped = clampOffset(text, offset)
  const start = text.lastIndexOf("\n", Math.max(0, clamped - 1)) + 1
  const endIndex = text.indexOf("\n", clamped)
  const end = endIndex === -1 ? text.length : endIndex
  return { start, end }
}

export function lineOffset(text: string, cursor: number, delta: number) {
  const current = lineBounds(text, cursor)
  const column = cursor - current.start
  const lines = text.split("\n")
  let lineIndex = 0
  let total = 0

  for (let i = 0; i < lines.length; i++) {
    const lineLength = lines[i].length
    if (cursor <= total + lineLength) {
      lineIndex = i
      break
    }
    total += lineLength + 1
    lineIndex = i + 1
  }

  const nextIndex = Math.max(0, Math.min(lineIndex + delta, lines.length - 1))
  let nextStart = 0
  for (let i = 0; i < nextIndex; i++) {
    nextStart += lines[i].length + 1
  }
  return nextStart + Math.min(column, lines[nextIndex].length)
}

export function firstNonBlankInLine(text: string, cursor: number) {
  const bounds = lineBounds(text, cursor)
  let index = bounds.start
  while (index < bounds.end && /\s/.test(text[index]!)) index += 1
  return index
}

export function nextWordStart(text: string, cursor: number) {
  let index = Math.min(cursor + 1, text.length)
  while (index < text.length && !/\s/.test(text[index]!)) index += 1
  while (index < text.length && /\s/.test(text[index]!)) index += 1
  return index
}

export function prevWordStart(text: string, cursor: number) {
  let index = Math.max(0, cursor - 1)
  while (index > 0 && /\s/.test(text[index]!)) index -= 1
  while (index > 0 && !/\s/.test(text[index - 1]!)) index -= 1
  return index
}

export function wordEnd(text: string, cursor: number) {
  let index = Math.min(cursor, Math.max(0, text.length - 1))
  while (index < text.length && /\s/.test(text[index]!)) index += 1
  while (index < text.length - 1 && !/\s/.test(text[index + 1]!)) index += 1
  return index
}

export function findCharacter(text: string, cursor: number, char: string, find: VimFindType) {
  const forward = find === "f" || find === "t"
  const till = find === "t" || find === "T"

  if (forward) {
    let index = clampOffset(text, cursor) + 1
    while (index < text.length) {
      if (text[index] === char) return till ? Math.max(cursor, index - 1) : index
      index += 1
    }
    return
  }

  let index = clampOffset(text, cursor) - 1
  while (index >= 0) {
    if (text[index] === char) return till ? Math.min(cursor, index + 1) : index
    index -= 1
  }
}

function isWordChar(char: string) {
  return /[A-Za-z0-9_]/.test(char)
}

function charGroup(text: string, index: number) {
  const char = text[index]
  if (!char) return "none"
  if (isWordChar(char)) return "word"
  if (/\s/.test(char)) return "space"
  return "punctuation"
}

export function innerWordRange(text: string, cursor: number): TextRange | undefined {
  if (!text) return
  const index = clampOffset(text, cursor === text.length ? cursor - 1 : cursor)
  const group = charGroup(text, index)
  if (group === "none") return

  let start = index
  let end = index + 1
  while (start > 0 && charGroup(text, start - 1) === group) start -= 1
  while (end < text.length && charGroup(text, end) === group) end += 1
  return { start, end }
}

export function aroundWordRange(text: string, cursor: number): TextRange | undefined {
  const range = innerWordRange(text, cursor)
  if (!range) return

  let start = range.start
  let end = range.end
  while (end < text.length && /\s/.test(text[end]!)) end += 1
  if (end !== range.end) return { start, end }

  while (start > 0 && /\s/.test(text[start - 1]!)) start -= 1
  return { start, end }
}

export function operatorMotionRange(text: string, cursor: number, motion: OperatorMotion): TextRange | undefined {
  const clampedCursor = clampOffset(text, cursor)
  if (motion === "0") {
    const start = lineBounds(text, clampedCursor).start
    if (start >= clampedCursor) return
    return { start, end: clampedCursor }
  }
  if (motion === "$") {
    const end = lineBounds(text, clampedCursor).end
    if (end < clampedCursor) return
    return { start: clampedCursor, end }
  }

  const target = motion === "b" ? prevWordStart(text, clampedCursor) : motion === "w" ? nextWordStart(text, clampedCursor) : wordEnd(text, clampedCursor)
  if (motion === "w") {
    if (target <= clampedCursor) return
    return { start: clampedCursor, end: target }
  }
  if (motion === "e") {
    const end = Math.min(text.length, target + 1)
    if (end <= clampedCursor) return
    return { start: clampedCursor, end }
  }
  if (target >= clampedCursor) return
  return { start: target, end: clampedCursor }
}

export function operatorFindRange(text: string, cursor: number, char: string, find: VimFindType): TextRange | undefined {
  const target = findCharacter(text, cursor, char, find)
  if (target === undefined) return
  return { start: Math.min(cursor, target), end: Math.min(text.length, Math.max(cursor, target) + 1) }
}

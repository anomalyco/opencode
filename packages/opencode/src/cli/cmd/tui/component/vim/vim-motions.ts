import type { TextareaRenderable } from "@opentui/core"

function lineStart(text: string, offset: number) {
  const index = text.lastIndexOf("\n", Math.max(0, offset - 1))
  if (index === -1) return 0
  return index + 1
}

function lineEnd(text: string, offset: number) {
  const index = text.indexOf("\n", offset)
  if (index === -1) return text.length
  return index
}

function lineLast(text: string, offset: number) {
  const start = lineStart(text, offset)
  const end = lineEnd(text, offset)
  if (end > start) return end - 1
  return start
}

function prevLineStart(text: string, offset: number) {
  const start = lineStart(text, offset)
  if (start === 0) return undefined
  return lineStart(text, start - 1)
}

function nextLineStart(text: string, offset: number) {
  const end = lineEnd(text, offset)
  if (end >= text.length) return undefined
  return end + 1
}

function moveUp(text: string, offset: number) {
  const currentStart = lineStart(text, offset)
  const targetStart = prevLineStart(text, offset)
  if (targetStart === undefined) return offset
  const targetLast = lineLast(text, targetStart)
  const col = offset - currentStart
  return Math.min(targetStart + col, targetLast)
}

function moveDown(text: string, offset: number) {
  const currentStart = lineStart(text, offset)
  const targetStart = nextLineStart(text, offset)
  if (targetStart === undefined) return offset
  const targetLast = lineLast(text, targetStart)
  const col = offset - currentStart
  return Math.min(targetStart + col, targetLast)
}

export function moveLeft(textarea: TextareaRenderable) {
  const text = textarea.plainText
  const start = lineStart(text, textarea.cursorOffset)
  textarea.cursorOffset = Math.max(start, textarea.cursorOffset - 1)
}

export function moveRight(textarea: TextareaRenderable) {
  const text = textarea.plainText
  const last = lineLast(text, textarea.cursorOffset)
  textarea.cursorOffset = Math.min(last, textarea.cursorOffset + 1)
}

export function moveLineUp(textarea: TextareaRenderable) {
  const text = textarea.plainText
  textarea.cursorOffset = moveUp(text, textarea.cursorOffset)
}

export function moveLineDown(textarea: TextareaRenderable) {
  const text = textarea.plainText
  textarea.cursorOffset = moveDown(text, textarea.cursorOffset)
}

function isWord(char: string) {
  return /[A-Za-z0-9_]/.test(char)
}

function isBigWord(char: string) {
  return !/\s/.test(char)
}

function nextWordStart(text: string, offset: number, big: boolean) {
  const match = big ? isBigWord : isWord
  let pos = offset
  if (pos < text.length && match(text[pos])) {
    while (pos < text.length && match(text[pos])) pos++
  }
  while (pos < text.length && !match(text[pos])) pos++
  return pos
}

function prevWordStart(text: string, offset: number, big: boolean) {
  const match = big ? isBigWord : isWord
  let pos = offset
  while (pos > 0 && !match(text[pos - 1])) pos--
  while (pos > 0 && match(text[pos - 1])) pos--
  return pos
}

function wordEnd(text: string, offset: number, big: boolean) {
  const match = big ? isBigWord : isWord
  let pos = offset
  if (pos < text.length) pos++
  while (pos < text.length && !match(text[pos])) pos++
  while (pos < text.length && match(text[pos])) pos++
  if (pos > offset + 1) pos--
  return pos
}

function deleteOffsets(textarea: TextareaRenderable, startOffset: number, endOffset: number) {
  if (endOffset <= startOffset) return
  textarea.cursorOffset = startOffset
  const start = textarea.logicalCursor
  textarea.cursorOffset = endOffset
  const end = textarea.logicalCursor
  textarea.deleteRange(start.row, start.col, end.row, end.col)
  textarea.cursorOffset = startOffset
}

export function moveWordNext(textarea: TextareaRenderable) {
  const text = textarea.plainText
  textarea.cursorOffset = nextWordStart(text, textarea.cursorOffset, false)
}

export function moveWordPrev(textarea: TextareaRenderable) {
  const text = textarea.plainText
  textarea.cursorOffset = prevWordStart(text, textarea.cursorOffset, false)
}

export function moveWordEnd(textarea: TextareaRenderable) {
  const text = textarea.plainText
  textarea.cursorOffset = wordEnd(text, textarea.cursorOffset, false)
}

export function moveBigWordNext(textarea: TextareaRenderable) {
  const text = textarea.plainText
  textarea.cursorOffset = nextWordStart(text, textarea.cursorOffset, true)
}

export function moveBigWordPrev(textarea: TextareaRenderable) {
  const text = textarea.plainText
  textarea.cursorOffset = prevWordStart(text, textarea.cursorOffset, true)
}

export function moveBigWordEnd(textarea: TextareaRenderable) {
  const text = textarea.plainText
  textarea.cursorOffset = wordEnd(text, textarea.cursorOffset, true)
}

function firstNonWhitespace(text: string, offset: number) {
  const start = lineStart(text, offset)
  const end = lineEnd(text, offset)
  let pos = start
  while (pos < end && /\s/.test(text[pos])) pos++
  return pos
}

export function appendAfterCursor(textarea: TextareaRenderable) {
  const text = textarea.plainText
  const end = lineEnd(text, textarea.cursorOffset)
  textarea.cursorOffset = Math.min(textarea.cursorOffset + 1, end)
}

export function appendLineEnd(textarea: TextareaRenderable) {
  const text = textarea.plainText
  textarea.cursorOffset = lineEnd(text, textarea.cursorOffset)
}

export function insertLineStart(textarea: TextareaRenderable) {
  const text = textarea.plainText
  textarea.cursorOffset = firstNonWhitespace(text, textarea.cursorOffset)
}

export function openLineBelow(textarea: TextareaRenderable) {
  const text = textarea.plainText
  const end = lineEnd(text, textarea.cursorOffset)
  textarea.cursorOffset = end
  textarea.insertText("\n")
}

export function openLineAbove(textarea: TextareaRenderable) {
  const text = textarea.plainText
  const start = lineStart(text, textarea.cursorOffset)
  textarea.cursorOffset = start
  textarea.insertText("\n")
  textarea.cursorOffset = start
}

export function deleteUnderCursor(textarea: TextareaRenderable) {
  const text = textarea.plainText
  const startOffset = textarea.cursorOffset
  const end = lineEnd(text, startOffset)
  if (startOffset >= end) return
  deleteOffsets(textarea, startOffset, startOffset + 1)
}

export function deleteWord(textarea: TextareaRenderable) {
  const text = textarea.plainText
  const startOffset = textarea.cursorOffset
  const endOffset = nextWordStart(text, startOffset, false)
  deleteOffsets(textarea, startOffset, endOffset)
}

export function deleteLine(textarea: TextareaRenderable) {
  const text = textarea.plainText
  if (!text.length) return

  const offset = textarea.cursorOffset
  const start = lineStart(text, offset)
  const end = lineEnd(text, offset)

  if (end < text.length) {
    deleteOffsets(textarea, start, end + 1)
    return
  }

  if (start > 0) {
    deleteOffsets(textarea, start - 1, end)
    textarea.cursorOffset = lineStart(textarea.plainText, textarea.cursorOffset)
    return
  }

  deleteOffsets(textarea, start, end)
}

export function substituteLine(textarea: TextareaRenderable) {
  const text = textarea.plainText
  const start = lineStart(text, textarea.cursorOffset)
  const end = lineEnd(text, textarea.cursorOffset)
  deleteOffsets(textarea, start, end)
}

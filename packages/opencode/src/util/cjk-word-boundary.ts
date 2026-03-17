import type { TextareaRenderable } from "@opentui/core"

// Intl.Segmenter with granularity:'word' treats each CJK ideograph as its own
// word segment, which gives us macOS-like Option+Arrow behavior out of the box.
const segmenter = new Intl.Segmenter(undefined, { granularity: "word" })

interface Segment {
  start: number
  end: number
  isWordLike: boolean
}

function getSegments(text: string): Segment[] {
  const result: Segment[] = []
  for (const seg of segmenter.segment(text)) {
    result.push({
      start: seg.index,
      end: seg.index + seg.segment.length,
      isWordLike: seg.isWordLike ?? false,
    })
  }
  return result
}

/**
 * Find the offset to jump to when pressing Option+Right (forward word).
 *
 * Behavior (matches macOS):
 * - If cursor is inside or at the start of a word, jump to the end of that word.
 * - If cursor is on whitespace/punctuation, jump to the end of the next word.
 * - If no next word exists, jump to text end.
 */
function findNextWordEnd(text: string, offset: number): number {
  if (offset >= text.length) return text.length
  const segments = getSegments(text)

  for (const seg of segments) {
    // Find first word-like segment whose end is past our current offset
    if (seg.isWordLike && seg.end > offset) {
      return seg.end
    }
  }
  return text.length
}

/**
 * Find the offset to jump to when pressing Option+Left (backward word).
 *
 * Behavior (matches macOS):
 * - If cursor is inside or at the end of a word, jump to the start of that word.
 * - If cursor is on whitespace/punctuation, jump to the start of the previous word.
 * - If no previous word exists, jump to text start.
 */
function findPrevWordStart(text: string, offset: number): number {
  if (offset <= 0) return 0
  const segments = getSegments(text)

  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]!
    // Find last word-like segment whose start is before our current offset
    if (seg.isWordLike && seg.start < offset) {
      return seg.start
    }
  }
  return 0
}

/**
 * Monkey-patch a TextareaRenderable instance to use CJK-aware word boundaries
 * powered by Intl.Segmenter. This replaces the native Zig word boundary logic
 * (which treats contiguous non-whitespace as a single word) with Unicode-aware
 * segmentation where each CJK character is its own word.
 *
 * The patched methods replicate the exact behavior of the original methods
 * (selection handling, event emission, render requests) but substitute the
 * boundary calculation.
 */
export function patchCJKWordBoundary(textarea: TextareaRenderable): void {
  // We need access to protected/private members at runtime via (textarea as any).
  // TypeScript visibility modifiers are compile-time only; the properties exist
  // on the JS object at runtime.
  const ta = textarea as any

  // Store originals so we can call them if needed, and for the "input" emit pattern
  // that the Input subclass (which TextareaRenderable actually is) adds.

  ta.moveWordForward = function (options?: { select?: boolean }): boolean {
    const select = options?.select ?? false
    ta.updateSelectionForMovement(select, true)

    const text = ta.editBuffer.getText()
    const currentOffset = ta.editBuffer.getCursorPosition().offset
    const targetOffset = findNextWordEnd(text, currentOffset)
    ta.editBuffer.setCursorByOffset(targetOffset)

    ta.updateSelectionForMovement(select, false)
    ta.requestRender()
    return true
  }

  ta.moveWordBackward = function (options?: { select?: boolean }): boolean {
    const select = options?.select ?? false
    ta.updateSelectionForMovement(select, true)

    const text = ta.editBuffer.getText()
    const currentOffset = ta.editBuffer.getCursorPosition().offset
    const targetOffset = findPrevWordStart(text, currentOffset)
    ta.editBuffer.setCursorByOffset(targetOffset)

    ta.updateSelectionForMovement(select, false)
    ta.requestRender()
    return true
  }

  ta.deleteWordForward = function (): boolean {
    if (ta.hasSelection()) {
      ta.deleteSelectedText()
      ta.emit("input", ta.plainText)
      return true
    }

    const text = ta.editBuffer.getText()
    const currentCursor = ta.editBuffer.getCursorPosition()
    const targetOffset = findNextWordEnd(text, currentCursor.offset)

    if (targetOffset > currentCursor.offset) {
      const targetPos = ta.editBuffer.offsetToPosition(targetOffset)
      if (targetPos) {
        ta.editBuffer.deleteRange(currentCursor.row, currentCursor.col, targetPos.row, targetPos.col)
      }
    }

    ta._ctx.clearSelection()
    ta.requestRender()
    ta.emit("input", ta.plainText)
    return true
  }

  ta.deleteWordBackward = function (): boolean {
    if (ta.hasSelection()) {
      ta.deleteSelectedText()
      ta.emit("input", ta.plainText)
      return true
    }

    const text = ta.editBuffer.getText()
    const currentCursor = ta.editBuffer.getCursorPosition()
    const targetOffset = findPrevWordStart(text, currentCursor.offset)

    if (targetOffset < currentCursor.offset) {
      const targetPos = ta.editBuffer.offsetToPosition(targetOffset)
      if (targetPos) {
        ta.editBuffer.deleteRange(targetPos.row, targetPos.col, currentCursor.row, currentCursor.col)
      }
    }

    ta._ctx.clearSelection()
    ta.requestRender()
    ta.emit("input", ta.plainText)
    return true
  }
}

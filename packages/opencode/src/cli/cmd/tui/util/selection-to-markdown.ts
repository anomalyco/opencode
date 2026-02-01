import type { MessageV2 } from "@/session/message-v2"

type Part = MessageV2.Part

/**
 * Normalize text for comparison by:
 * - Trimming whitespace
 * - Collapsing multiple spaces/newlines
 * - Removing common markdown syntax that disappears in rendering
 */
function normalizeText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, " ") // Collapse whitespace
    .toLowerCase()
}

/**
 * Strip markdown syntax from text to simulate what the rendered output looks like.
 * This helps match selected terminal text against markdown source.
 */
function stripMarkdownSyntax(markdown: string): string {
  return markdown
    .replace(/\*\*([^*]+)\*\*/g, "$1") // **bold** -> bold
    .replace(/\*([^*]+)\*/g, "$1") // *italic* -> italic
    .replace(/`([^`]+)`/g, "$1") // `code` -> code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // [text](url) -> text
    .replace(/^#{1,6}\s+/gm, "") // # Header -> Header
    .replace(/^[>-]\s+/gm, "") // > quote or - item -> quote/item
    .replace(/^\d+\.\s+/gm, "") // 1. item -> item
}

/**
 * Find the best matching Part for a selected text string.
 * Returns the original markdown if a good match is found.
 *
 * Strategy:
 * 1. Check for exact substring matches first (fast path)
 * 2. Try normalized comparison (handles whitespace differences)
 * 3. Try comparing against stripped markdown (handles markdown syntax)
 */
export function findMarkdownForSelection(selectedText: string, parts: Record<string, Part[]>): string | null {
  if (!selectedText || selectedText.trim().length === 0) return null

  const normalized = normalizeText(selectedText)
  const minMatchLength = 10 // Only try to match if selection is meaningful

  if (normalized.length < minMatchLength) return null

  // Collect all text parts
  const textParts: Array<{ markdown: string; messageID: string }> = []
  for (const [messageID, messageParts] of Object.entries(parts)) {
    for (const part of messageParts) {
      if (part.type === "text" && part.text) {
        textParts.push({ markdown: part.text, messageID })
      }
    }
  }

  // Sort by most recent messages first (higher messageID = more recent)
  textParts.sort((a, b) => b.messageID.localeCompare(a.messageID))

  for (const { markdown } of textParts) {
    // Strategy 1: Exact substring match in markdown
    if (markdown.includes(selectedText)) {
      return markdown
    }

    // Strategy 2: Normalized text match
    const normalizedMarkdown = normalizeText(markdown)
    if (normalizedMarkdown.includes(normalized)) {
      return markdown
    }

    // Strategy 3: Match against stripped markdown (selected text is rendered, markdown has syntax)
    const stripped = normalizeText(stripMarkdownSyntax(markdown))
    if (stripped.includes(normalized)) {
      return markdown
    }

    // Strategy 4: Partial match - selection might be a subset of the part
    // Check if the selection is a significant portion of the markdown
    const matchRatio = normalized.length / normalizedMarkdown.length
    if (matchRatio > 0.3 && normalizedMarkdown.includes(normalized)) {
      return markdown
    }
  }

  return null
}

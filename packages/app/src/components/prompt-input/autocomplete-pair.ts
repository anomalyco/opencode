import { getCursorPosition, setCursorPosition } from "./editor-dom"

const PAIRS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  '"': '"',
  "'": "'",
  "`": "`",
  $: "$",
}

const CLOSERS = new Set(Object.values(PAIRS))

type PromptPairInput = {
  editor: () => HTMLDivElement
  addPart: (part: { type: "text"; content: string; start: 0; end: 0 }) => void
}

export function createPromptPair(input: PromptPairInput) {
  /**
   * Get the raw text around the cursor from the contenteditable.
   * Returns { before, after } relative to collapsed cursor position.
   */
  const getSurroundingText = () => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return null

    const range = selection.getRangeAt(0)
    const editor = input.editor()
    if (!editor.contains(range.startContainer)) return null

    // Get full text content of the editor (excluding zero-width spaces)
    const full = editor.textContent?.replace(/\u200B/g, "") ?? ""
    const pos = getCursorPosition(editor)
    return { before: full.slice(0, pos), after: full.slice(pos), pos, full }
  }

  const getSelectionText = () => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return null
    const editor = input.editor()
    if (!editor.contains(selection.anchorNode)) return null
    return selection.toString()
  }

  const skipRight = () => {
    const editor = input.editor()
    const pos = getCursorPosition(editor)
    setCursorPosition(editor, pos + 1)
  }

  /**
   * Delete the character immediately before the cursor (the opening bracket).
   * Then trigger a synthetic backspace for the char after cursor (the closing bracket).
   * We do this by using execCommand or direct DOM manipulation.
   */
  const deletePair = () => {
    // Use execCommand to delete char before cursor (the opener)
    document.execCommand("delete", false)
    // Now delete char after cursor (the closer) using "forwardDelete"
    document.execCommand("forwardDelete", false)
  }

  /**
   * Main key handler for auto-pair. Returns true if the event was handled.
   */
  const handlePairKeyDown = (event: KeyboardEvent): boolean => {
    // Skip if modifier keys held (except shift for typed chars like {)
    if (event.metaKey || event.ctrlKey || event.altKey) return false

    // Skip IME composition
    if (event.isComposing || event.keyCode === 229) return false

    const key = event.key

    // --- Backspace between a pair (only when cursor is collapsed) ---
    if (key === "Backspace") {
      const selection = window.getSelection()
      if (!selection?.isCollapsed) return false
      const ctx = getSurroundingText()
      if (!ctx) return false
      const charBefore = ctx.before.slice(-1)
      const charAfter = ctx.after.slice(0, 1)
      if (charBefore && charAfter && PAIRS[charBefore] === charAfter) {
        event.preventDefault()
        deletePair()
        return true
      }
      return false
    }

    // --- Handle openers (and symmetric pairs) ---
    if (key in PAIRS) {
      const closer = PAIRS[key]!

      // --- Skip-over for symmetric pairs (quotes, backtick) ---
      // Only skip-over when cursor is collapsed (no selection)
      // For symmetric pairs (opener === closer), if next char is the closer, skip over
      if (key === closer) {
        const selection = window.getSelection()
        if (selection?.isCollapsed) {
          const ctx = getSurroundingText()
          if (ctx && ctx.after.slice(0, 1) === closer) {
            event.preventDefault()
            skipRight()
            return true
          }
        }
      }

      // --- Selection wrapping ---
      const selected = getSelectionText()
      if (selected) {
        event.preventDefault()
        input.addPart({ type: "text", content: key + selected + closer, start: 0, end: 0 })
        return true
      }

      // --- Insert pair and place cursor between ---
      event.preventDefault()
      const editor = input.editor()
      const pos = getCursorPosition(editor)
      input.addPart({ type: "text", content: key + closer, start: 0, end: 0 })
      // addPart places cursor at end of inserted text; move it back one to sit between the pair
      setCursorPosition(editor, pos + 1)
      return true
    }

    // --- Skip-over: pure closers (not openers) like ), ], } ---
    if (CLOSERS.has(key)) {
      const selection = window.getSelection()
      if (selection?.isCollapsed) {
        const ctx = getSurroundingText()
        if (ctx && ctx.after.slice(0, 1) === key) {
          event.preventDefault()
          skipRight()
          return true
        }
      }
    }

    return false
  }

  return { handlePairKeyDown }
}

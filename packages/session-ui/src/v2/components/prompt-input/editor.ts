// Offsets between the editor DOM and the prompt model. The rules here mirror
// parsePromptInputV2Editor: a <br> counts as one newline, mentions count as their own
// text, and a block sibling of the editor ends a line. Everything walks the live tree
// and stops at the caret, so no part of the document is ever materialised as a string.

export function promptInputV2Offset(editor: HTMLElement, container: Node | null | undefined, offset: number) {
  if (!container || !editor.contains(container)) return -1
  let total = 0

  const visit = (node: Node): boolean => {
    if (node === container && node.nodeType === Node.TEXT_NODE) {
      total += Math.min(offset, (node.nodeValue ?? "").length)
      return true
    }
    if (node.nodeType === Node.TEXT_NODE) {
      total += (node.nodeValue ?? "").length
      return false
    }
    if (!(node instanceof HTMLElement)) return false
    if (node.tagName === "BR") {
      total += 1
      return false
    }
    if (node.dataset.mention) {
      total += (node.textContent ?? "").length
      return false
    }
    const children = Array.from(node.childNodes)
    const limit = node === container ? Math.min(offset, children.length) : children.length
    for (let index = 0; index < limit; index += 1) {
      if (visit(children[index]!)) return true
      const child = children[index]
      if (node !== editor || index === children.length - 1) continue
      if (child instanceof HTMLElement && (child.tagName === "DIV" || child.tagName === "P")) total += 1
    }
    return node === container
  }

  visit(editor)
  return total
}

export function promptInputV2Cursor(editor: HTMLElement) {
  const selection = window.getSelection()
  if (!selection?.rangeCount) return promptInputV2Length(editor)
  const offset = promptInputV2Offset(editor, selection.anchorNode, selection.anchorOffset)
  return offset < 0 ? promptInputV2Length(editor) : offset
}

export function promptInputV2SelectionRange(editor: HTMLElement) {
  const selection = window.getSelection()
  if (!selection?.rangeCount) return undefined
  const range = selection.getRangeAt(0)
  const start = promptInputV2Offset(editor, range.startContainer, range.startOffset)
  if (start < 0) return undefined
  if (range.collapsed) return { start, end: start }
  const end = promptInputV2Offset(editor, range.endContainer, range.endOffset)
  return { start, end: end < 0 ? start : end }
}

function promptInputV2Length(editor: HTMLElement) {
  return promptInputV2Offset(editor, editor, editor.childNodes.length)
}

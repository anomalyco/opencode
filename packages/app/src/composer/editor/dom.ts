function getNodeLength(node: Node): number {
  if (node instanceof Element && node.tagName === "BR") return 1

  return textLength(node)
}

// The node's text without zero-width spaces, like `textContent` but without building the string.
function textLength(node: Node): number {
  if (node instanceof Text) return countText(node.data, node.length)
  let length = 0

  for (let child = node.firstChild; child; child = child.nextSibling) length += textLength(child)

  return length
}

/**
 * The collapsed caret's position in `parent`, counted the way `setCursorPosition` places it, or `undefined` when
 * the selection is a range or lies outside `parent`. Runs on every `selectionchange`, so it allocates nothing.
 */
export function getCursorPosition(parent: HTMLElement) {
  const selection = window.getSelection()
  const anchor = selection?.anchorNode

  if (!selection?.isCollapsed || !anchor || !parent.contains(anchor)) return
  const offset = selection.anchorOffset
  let position = 0
  let index = 0

  for (let node = parent.firstChild; node; node = node.nextSibling) {
    if (anchor === parent && index === offset) return position

    if (node === anchor && node instanceof Text) return position + countText(node.data, offset)

    // Mentions and breaks are atomic: a caret on or inside one sits before or after it.
    if (node.contains(anchor)) return offset === 0 ? position : position + getNodeLength(node)
    position += getNodeLength(node)
    index++
  }

  return position
}

function countText(text: string, end: number) {
  let count = 0

  for (let index = 0; index < end; index++) if (text.charCodeAt(index) !== 0x200b) count++

  return count
}

export function setCursorPosition(parent: HTMLElement, position: number) {
  let remaining = position
  let node = parent.firstChild

  while (node) {
    const length = getNodeLength(node)
    const isText = node.nodeType === Node.TEXT_NODE
    const isPill = node instanceof HTMLElement && !!node.dataset.mention
    const isBreak = node instanceof Element && node.tagName === "BR"

    if (isText && remaining <= length) {
      const range = document.createRange()
      const selection = window.getSelection()
      range.setStart(node, remaining)
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)

      return
    }

    if ((isPill || isBreak) && remaining <= length) {
      const range = document.createRange()
      const selection = window.getSelection()

      if (remaining === 0) {
        range.setStartBefore(node)
      }

      if (remaining > 0 && isPill) {
        range.setStartAfter(node)
      }

      if (remaining > 0 && isBreak) {
        const next = node.nextSibling

        if (next && next.nodeType === Node.TEXT_NODE) {
          range.setStart(next, 0)
        }

        if (!next || next.nodeType !== Node.TEXT_NODE) {
          range.setStartAfter(node)
        }
      }

      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)

      return
    }

    remaining -= length
    node = node.nextSibling
  }

  const fallbackRange = document.createRange()
  const fallbackSelection = window.getSelection()
  const last = parent.lastChild

  if (last && last.nodeType === Node.TEXT_NODE) {
    const len = last.textContent ? last.textContent.length : 0
    fallbackRange.setStart(last, len)
  }

  if (!last || last.nodeType !== Node.TEXT_NODE) {
    fallbackRange.selectNodeContents(parent)
  }

  fallbackRange.collapse(false)
  fallbackSelection?.removeAllRanges()
  fallbackSelection?.addRange(fallbackRange)
}

export function createTextFragment(content: string): DocumentFragment {
  const fragment = document.createDocumentFragment()
  let start = 0

  for (;;) {
    const end = content.indexOf("\n", start)
    if (end === -1) break

    if (end > start) {
      fragment.appendChild(document.createTextNode(content.slice(start, end)))
    }

    fragment.appendChild(document.createElement("br"))
    start = end + 1
  }

  if (start < content.length) {
    fragment.appendChild(document.createTextNode(content.slice(start)))
  }

  return fragment
}

function textLength(content: string): number {
  if (!content.includes("\u200B")) return content.length
  return content.replace(/\u200B/g, "").length
}

export function getNodeLength(node: Node): number {
  if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR") return 1
  return textLength(node.textContent ?? "")
}

export function getTextLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return textLength(node.textContent ?? "")
  if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR") return 1
  let length = 0
  let child = node.firstChild
  while (child) {
    length += getTextLength(child)
    child = child.nextSibling
  }
  return length
}

function measureUntil(node: Node, target: Node, offset: number): { found: boolean; length: number } {
  if (node === target) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ""
      const max = Math.max(0, Math.min(offset, text.length))
      return { found: true, length: textLength(text.slice(0, max)) }
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement
      if (element.tagName === "BR") return { found: true, length: offset > 0 ? 1 : 0 }

      const max = Math.max(0, Math.min(offset, node.childNodes.length))
      let length = 0
      for (let index = 0; index < max; index++) {
        const child = node.childNodes[index]
        if (!child) continue
        length += getTextLength(child)
      }
      return { found: true, length }
    }

    return { found: true, length: 0 }
  }

  if (node.nodeType === Node.TEXT_NODE) {
    return { found: false, length: textLength(node.textContent ?? "") }
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as HTMLElement
    if (element.tagName === "BR") return { found: false, length: 1 }

    let length = 0
    let child = node.firstChild
    while (child) {
      const next = measureUntil(child, target, offset)
      length += next.length
      if (next.found) return { found: true, length }
      child = child.nextSibling
    }

    return { found: false, length }
  }

  return { found: false, length: 0 }
}

export function getCursorPosition(parent: HTMLElement): number {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return 0
  const range = selection.getRangeAt(0)
  if (!parent.contains(range.startContainer)) return 0
  return measureUntil(parent, range.startContainer, range.startOffset).length
}

export function getSelectionOffsets(parent: HTMLElement) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return

  const range = selection.getRangeAt(0)
  if (!parent.contains(range.startContainer)) return
  if (!parent.contains(range.endContainer)) return

  return {
    start: measureUntil(parent, range.startContainer, range.startOffset).length,
    end: measureUntil(parent, range.endContainer, range.endOffset).length,
  }
}

export function setCursorPosition(parent: HTMLElement, position: number) {
  let remaining = position
  let node = parent.firstChild
  while (node) {
    const length = getNodeLength(node)
    const isText = node.nodeType === Node.TEXT_NODE
    const isPill =
      node.nodeType === Node.ELEMENT_NODE &&
      ((node as HTMLElement).dataset.type === "file" || (node as HTMLElement).dataset.type === "agent")
    const isBreak = node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR"

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

export function setRangeEdge(parent: HTMLElement, range: Range, edge: "start" | "end", offset: number) {
  let remaining = offset
  const nodes = Array.from(parent.childNodes)

  for (const node of nodes) {
    const length = getNodeLength(node)
    const isText = node.nodeType === Node.TEXT_NODE
    const isPill =
      node.nodeType === Node.ELEMENT_NODE &&
      ((node as HTMLElement).dataset.type === "file" || (node as HTMLElement).dataset.type === "agent")
    const isBreak = node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR"

    if (isText && remaining <= length) {
      if (edge === "start") range.setStart(node, remaining)
      if (edge === "end") range.setEnd(node, remaining)
      return
    }

    if ((isPill || isBreak) && remaining <= length) {
      if (edge === "start" && remaining === 0) range.setStartBefore(node)
      if (edge === "start" && remaining > 0) range.setStartAfter(node)
      if (edge === "end" && remaining === 0) range.setEndBefore(node)
      if (edge === "end" && remaining > 0) range.setEndAfter(node)
      return
    }

    remaining -= length
  }
}
